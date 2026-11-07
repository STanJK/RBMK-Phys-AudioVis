export type AudioMode = "demo" | "mic" | "file";

export interface AudioEngineState {
  mode: AudioMode;
  playing: boolean;
  trackName: string;
  duration: number | null;
  message: string;
}

type Listener = (state: AudioEngineState) => void;

export class AudioEngine {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private mediaSource: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private demoSources: AudioScheduledSourceNode[] = [];
  private listeners = new Set<Listener>();
  private startedAt = 0;
  private offset = 0;
  private state: AudioEngineState = {
    mode: "demo",
    playing: false,
    trackName: "REACTOR / 内置信号",
    duration: null,
    message: "音频仅在本机处理，不会上传。",
  };

  readonly bins = new Uint8Array(1024);
  readonly wave = new Float32Array(2048);

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): AudioEngineState {
    return { ...this.state };
  }

  get ready() {
    return this.context !== null;
  }

  get sampleRate() {
    return this.context?.sampleRate ?? 48_000;
  }

  get fftSize() {
    return this.analyser?.fftSize ?? 2048;
  }

  get currentSeconds() {
    if (!this.state.playing || !this.context) return this.offset;
    return this.offset + (this.context.currentTime - this.startedAt);
  }

  get durationSeconds() {
    return this.buffer?.duration ?? null;
  }

  readFrequencyData() {
    if (this.analyser && this.state.playing) {
      this.analyser.getByteFrequencyData(this.bins);
    } else {
      this.bins.fill(0);
    }
    return this.bins;
  }

  readWaveform() {
    if (this.analyser && this.state.playing) {
      this.analyser.getFloatTimeDomainData(this.wave);
    } else {
      this.wave.fill(0);
    }
    return this.wave;
  }

  setVolume(percent: number) {
    if (!this.master || !this.context || this.state.mode === "mic") return;
    const value = Math.min(1, Math.max(0, percent / 100));
    this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.03);
  }

  async selectDemo() {
    this.stopAll(false);
    this.buffer = null;
    this.offset = 0;
    this.patch({
      mode: "demo",
      trackName: "REACTOR / 内置信号",
      duration: null,
      message: "音频仅在本机处理，不会上传。",
    });
    await this.start();
  }

  async selectMic() {
    this.stopAll(false);
    this.buffer = null;
    this.offset = 0;
    this.patch({
      mode: "mic",
      trackName: "MIC / 麦克风输入",
      duration: null,
      message: "等待麦克风授权…",
    });
    await this.start();
  }

  async loadFile(file: File) {
    this.stopAll(false);
    await this.ensureAudio();

    try {
      const decoded = await this.context!.decodeAudioData(await file.arrayBuffer());
      this.buffer = decoded;
      this.offset = 0;
      this.patch({
        mode: "file",
        trackName: file.name,
        duration: decoded.duration,
        message: "音频仅在本机处理，不会上传。",
      });
      await this.start();
    } catch {
      this.patch({ message: "无法读取该文件，请尝试 MP3、WAV、M4A 或 FLAC。" });
    }
  }

  async toggle() {
    if (this.state.playing) {
      this.pause();
    } else {
      await this.start();
    }
  }

  async seek(percent: number) {
    if (this.state.mode !== "file" || !this.buffer) return;
    const wasPlaying = this.state.playing;
    this.pause();
    this.offset = Math.min(
      this.buffer.duration,
      Math.max(0, (percent / 100) * this.buffer.duration),
    );
    this.emit();
    if (wasPlaying) await this.start();
  }

  pause() {
    if (!this.state.playing) return;

    if (this.context && this.state.mode === "file") {
      this.offset = Math.min(
        this.buffer?.duration ?? Number.POSITIVE_INFINITY,
        this.offset + (this.context.currentTime - this.startedAt),
      );
    }

    this.stopPlaybackNodes();
    this.patch({ playing: false });
  }

  dispose() {
    this.stopAll(false);
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.master = null;
    this.listeners.clear();
  }

  private async ensureAudio() {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.75;
      this.master = this.context.createGain();
      this.master.gain.value = 0.4;
      this.analyser.connect(this.master);
      this.master.connect(this.context.destination);
    }

    await this.context.resume();
  }

  private async start() {
    if (this.state.playing) return;

    try {
      await this.ensureAudio();

      if (this.state.mode === "mic") {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.stream = stream;
        this.mediaSource = this.context!.createMediaStreamSource(stream);
        this.mediaSource.connect(this.analyser!);
        this.master!.gain.value = 0;
        this.patch({ message: "正在监听麦克风；切换输入或暂停即可关闭。" });
      } else if (this.state.mode === "file" && this.buffer) {
        if (this.offset >= this.buffer.duration) this.offset = 0;

        this.master!.gain.value = 0.4;
        const source = this.context!.createBufferSource();
        source.buffer = this.buffer;
        source.connect(this.analyser!);
        source.onended = () => {
          if (this.state.playing && this.state.mode === "file") {
            this.offset = 0;
            this.stopPlaybackNodes();
            this.patch({ playing: false });
          }
        };
        source.start(0, this.offset);
        this.bufferSource = source;
      } else {
        this.master!.gain.value = 0.4;
        const frequencies = [55, 82.41, 110, 164.81, 220, 329.63, 440, 659.25];

        frequencies.forEach((frequency, index) => {
          const oscillator = this.context!.createOscillator();
          const voiceGain = this.context!.createGain();
          const lfo = this.context!.createOscillator();
          const lfoGain = this.context!.createGain();

          oscillator.type = index < 3 ? "triangle" : "sine";
          oscillator.frequency.value = frequency;
          voiceGain.gain.value = 0.025;
          lfo.frequency.value = 0.22 + index * 0.087;
          lfoGain.gain.value = 0.023;

          lfo.connect(lfoGain);
          lfoGain.connect(voiceGain.gain);
          oscillator.connect(voiceGain);
          voiceGain.connect(this.analyser!);

          oscillator.start();
          lfo.start();
          this.demoSources.push(oscillator, lfo);
        });

        this.patch({ message: "音频仅在本机处理，不会上传。" });
      }

      this.startedAt = this.context!.currentTime;
      this.patch({ playing: true });
    } catch {
      this.stopPlaybackNodes();
      this.patch({
        playing: false,
        message:
          this.state.mode === "mic"
            ? "无法访问麦克风，请检查浏览器权限，或导入音频。"
            : "无法播放此音频，请尝试其他文件。",
      });
    }
  }

  private stopAll(resetOffset: boolean) {
    this.stopPlaybackNodes();
    if (resetOffset) this.offset = 0;
    this.patch({ playing: false });
  }

  private stopPlaybackNodes() {
    if (this.bufferSource) {
      this.bufferSource.onended = null;
      try {
        this.bufferSource.stop();
      } catch {
        // Already stopped.
      }
      this.bufferSource.disconnect();
      this.bufferSource = null;
    }

    this.mediaSource?.disconnect();
    this.mediaSource = null;

    for (const source of this.demoSources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.demoSources = [];

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  private patch(next: Partial<AudioEngineState>) {
    this.state = { ...this.state, ...next };
    this.emit();
  }

  private emit() {
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
