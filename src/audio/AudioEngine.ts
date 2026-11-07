export type AudioMode = "demo" | "mic" | "file" | "bilibili";

export interface AudioEngineState {
  mode: AudioMode;
  playing: boolean;
  trackName: string;
  duration: number | null;
  message: string;
}

export interface RemoteAudioSource {
  streamUrls: string[];
  trackName: string;
  duration: number | null;
}

type Listener = (state: AudioEngineState) => void;

export class AudioEngine {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;

  private buffer: AudioBuffer | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;

  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;

  private remoteAudio: HTMLAudioElement | null = null;
  private remoteSource: MediaElementAudioSourceNode | null = null;
  private remoteStreamUrls: string[] = [];
  private remoteStreamIndex = 0;
  private remoteResumeAt = 0;
  private remoteResumeAfterFallback = false;

  private demoSources: AudioScheduledSourceNode[] = [];
  private listeners = new Set<Listener>();

  private startedAt = 0;
  private offset = 0;
  private volumePercent = 40;

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

  get sampleRate() {
    return this.context?.sampleRate ?? 48_000;
  }

  get fftSize() {
    return this.analyser?.fftSize ?? 2048;
  }

  get currentSeconds() {
    if (this.state.mode === "bilibili" && this.remoteAudio) {
      return Number.isFinite(this.remoteAudio.currentTime)
        ? this.remoteAudio.currentTime
        : 0;
    }

    if (!this.state.playing || !this.context) return this.offset;
    return this.offset + (this.context.currentTime - this.startedAt);
  }

  get durationSeconds() {
    if (this.state.mode === "bilibili" && this.remoteAudio) {
      const duration = this.remoteAudio.duration;
      if (Number.isFinite(duration) && duration > 0) return duration;
      return this.state.duration;
    }

    return this.buffer?.duration ?? this.state.duration;
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
    this.volumePercent = Math.min(100, Math.max(0, percent));
    if (!this.master || !this.context || this.state.mode === "mic") return;

    this.master.gain.setTargetAtTime(
      this.volumePercent / 100,
      this.context.currentTime,
      0.03,
    );
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

  selectBilibiliIdle() {
    this.stopAll(false);
    this.buffer = null;
    this.offset = 0;
    this.patch({
      mode: "bilibili",
      trackName: "BILIBILI / 等待解析",
      duration: null,
      message: "先由浏览器本地解析 B 站公开 API；失败时再使用 Worker fallback。",
    });
  }

  async loadBilibili(source: RemoteAudioSource) {
    this.stopAll(false);
    this.buffer = null;
    this.offset = 0;

    const urls = [...new Set(source.streamUrls.filter(Boolean))];
    if (urls.length === 0) {
      this.patch({
        mode: "bilibili",
        playing: false,
        message: "没有可用的 B 站音频地址。",
      });
      return;
    }

    try {
      await this.ensureAudio();

      const media = new Audio();
      media.crossOrigin = "anonymous";
      media.preload = "metadata";

      this.remoteAudio = media;
      this.remoteStreamUrls = urls;
      this.remoteStreamIndex = 0;
      this.remoteResumeAt = 0;
      this.remoteResumeAfterFallback = false;

      this.remoteSource = this.context!.createMediaElementSource(media);
      this.remoteSource.connect(this.analyser!);
      this.master!.gain.value = this.volumePercent / 100;

      media.onended = () => {
        if (this.state.mode === "bilibili") {
          this.patch({ playing: false });
        }
      };

      media.onloadedmetadata = () => {
        if (this.state.mode !== "bilibili") return;

        const duration = Number.isFinite(media.duration)
          ? media.duration
          : source.duration;
        this.patch({ duration: duration ?? null });

        if (this.remoteResumeAt > 0) {
          try {
            media.currentTime = Math.min(
              this.remoteResumeAt,
              Number.isFinite(media.duration)
                ? Math.max(0, media.duration - 0.05)
                : this.remoteResumeAt,
            );
          } catch {
            // Range metadata may not be fully ready yet.
          }
        }

        const shouldResume = this.remoteResumeAfterFallback;
        this.remoteResumeAt = 0;
        this.remoteResumeAfterFallback = false;

        if (shouldResume) {
          void media.play().then(
            () => {
              if (this.state.mode === "bilibili") {
                this.patch({
                  playing: true,
                  message: "备用音频链路已接管，继续播放并分析。",
                });
              }
            },
            () => {
              this.patch({
                playing: false,
                message: "备用音频链路已载入，但浏览器拒绝自动恢复播放；请再点一次播放。",
              });
            },
          );
        }
      };

      media.onerror = () => {
        if (this.state.mode !== "bilibili") return;

        const nextIndex = this.remoteStreamIndex + 1;
        if (nextIndex < this.remoteStreamUrls.length) {
          this.remoteResumeAt = Number.isFinite(media.currentTime)
            ? media.currentTime
            : 0;
          this.remoteResumeAfterFallback = this.state.playing;
          this.remoteStreamIndex = nextIndex;

          this.patch({
            message:
              nextIndex === 1
                ? "B 站 CDN 直连失败，正在切换 Worker /stream fallback…"
                : "当前音频链路失败，正在尝试下一备用地址…",
          });

          media.src = this.remoteStreamUrls[nextIndex];
          media.load();
          return;
        }

        this.patch({
          playing: false,
          message:
            "B 站音频所有链路均加载失败。可重新解析，或配置/检查 Worker fallback。",
        });
      };

      media.src = this.remoteStreamUrls[0];
      media.load();

      this.patch({
        mode: "bilibili",
        playing: false,
        trackName: source.trackName,
        duration: source.duration,
        message:
          urls.length > 1
            ? "B 站音频已解析：先尝试 CDN 直连，失败会自动切 Worker 代理。"
            : "B 站音频已解析：当前只有一条可用链路。",
      });
    } catch {
      this.cleanupRemoteAudio();
      this.patch({
        mode: "bilibili",
        playing: false,
        message: "无法建立 B 站音频源，请重新解析或检查 fallback 配置。",
      });
    }
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
    const normalized = Math.min(100, Math.max(0, percent)) / 100;

    if (this.state.mode === "bilibili" && this.remoteAudio) {
      const duration = this.durationSeconds;
      if (!duration || !Number.isFinite(duration)) return;

      try {
        this.remoteAudio.currentTime = normalized * duration;
      } catch {
        // Metadata/range may not be ready yet.
      }
      this.emit();
      return;
    }

    if (this.state.mode !== "file" || !this.buffer) return;

    const wasPlaying = this.state.playing;
    this.pause();
    this.offset = Math.min(
      this.buffer.duration,
      Math.max(0, normalized * this.buffer.duration),
    );
    this.emit();
    if (wasPlaying) await this.start();
  }

  pause() {
    if (!this.state.playing) return;

    if (this.state.mode === "bilibili" && this.remoteAudio) {
      this.remoteAudio.pause();
      this.patch({ playing: false });
      return;
    }

    if (this.context && this.state.mode === "file") {
      this.offset = Math.min(
        this.buffer?.duration ?? Number.POSITIVE_INFINITY,
        this.offset + (this.context.currentTime - this.startedAt),
      );
    }

    this.stopTransientNodes();
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
      this.master.gain.value = this.volumePercent / 100;
      this.analyser.connect(this.master);
      this.master.connect(this.context.destination);
    }

    await this.context.resume();
  }

  private async start() {
    if (this.state.playing) return;

    try {
      await this.ensureAudio();

      if (this.state.mode === "bilibili") {
        if (!this.remoteAudio) {
          this.patch({ message: "请先载入一个 B 站视频链接。" });
          return;
        }

        this.master!.gain.value = this.volumePercent / 100;
        await this.remoteAudio.play();
        this.patch({
          playing: true,
          message:
            this.remoteStreamIndex === 0
              ? "正在通过首选 B 站音频链路播放并分析。"
              : "正在通过 fallback 音频链路播放并分析。",
        });
        return;
      }

      if (this.state.mode === "mic") {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.micStream = stream;
        this.micSource = this.context!.createMediaStreamSource(stream);
        this.micSource.connect(this.analyser!);
        this.master!.gain.value = 0;
        this.patch({ message: "正在监听麦克风；切换输入或暂停即可关闭。" });
      } else if (this.state.mode === "file" && this.buffer) {
        if (this.offset >= this.buffer.duration) this.offset = 0;

        this.master!.gain.value = this.volumePercent / 100;
        const source = this.context!.createBufferSource();
        source.buffer = this.buffer;
        source.connect(this.analyser!);
        source.onended = () => {
          if (this.state.playing && this.state.mode === "file") {
            this.offset = 0;
            this.stopTransientNodes();
            this.patch({ playing: false });
          }
        };
        source.start(0, this.offset);
        this.bufferSource = source;
      } else {
        this.master!.gain.value = this.volumePercent / 100;
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
      this.stopTransientNodes();
      this.patch({
        playing: false,
        message:
          this.state.mode === "mic"
            ? "无法访问麦克风，请检查浏览器权限，或导入音频。"
            : this.state.mode === "bilibili"
              ? "B 站音频播放失败；如果首选链路失败，播放器会自动尝试 fallback。"
              : "无法播放此音频，请尝试其他文件。",
      });
    }
  }

  private stopAll(resetOffset: boolean) {
    this.stopTransientNodes();
    this.cleanupRemoteAudio();
    if (resetOffset) this.offset = 0;
    this.patch({ playing: false });
  }

  private stopTransientNodes() {
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

    this.micSource?.disconnect();
    this.micSource = null;

    for (const source of this.demoSources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.demoSources = [];

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
  }

  private cleanupRemoteAudio() {
    if (this.remoteAudio) {
      this.remoteAudio.onended = null;
      this.remoteAudio.onloadedmetadata = null;
      this.remoteAudio.onerror = null;
      this.remoteAudio.pause();
      this.remoteAudio.removeAttribute("src");
      this.remoteAudio.load();
      this.remoteAudio = null;
    }

    this.remoteSource?.disconnect();
    this.remoteSource = null;
    this.remoteStreamUrls = [];
    this.remoteStreamIndex = 0;
    this.remoteResumeAt = 0;
    this.remoteResumeAfterFallback = false;
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
