import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine, type AudioEngineState } from "./audio/AudioEngine";
import {
  REACTOR_CHANNEL_COUNT,
  ReactorVisualizer,
} from "./visualizer/ReactorVisualizer";

function formatTime(seconds: number) {
  return (
    Math.floor(seconds / 60).toString().padStart(2, "0") +
    ":" +
    Math.floor(seconds % 60).toString().padStart(2, "0")
  );
}

export default function App() {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;

  const [audio, setAudio] = useState<AudioEngineState>(engine.getState());
  const [sensitivity, setSensitivity] = useState(1.4);
  const [smoothing, setSmoothing] = useState(75);
  const [volume, setVolume] = useState(40);
  const [levelDb, setLevelDb] = useState<number | null>(null);
  const [peakHz, setPeakHz] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [resetViewToken, setResetViewToken] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => engine.subscribe(setAudio), [engine]);

  useEffect(() => {
    engine.setVolume(volume);
  }, [engine, volume]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(engine.currentSeconds);
    }, 125);
    return () => window.clearInterval(timer);
  }, [engine]);

  useEffect(() => () => engine.dispose(), [engine]);

  const updateMetrics = useCallback((level: number | null, peak: number | null) => {
    setLevelDb(level);
    setPeakHz(peak);
  }, []);

  const selectDemo = () => {
    void engine.selectDemo();
  };

  const selectMic = () => {
    void engine.selectMic();
  };

  const togglePlay = () => {
    void engine.toggle();
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    void engine.loadFile(file);
  };

  const duration = audio.duration ?? engine.durationSeconds;
  const seekValue =
    audio.mode === "file" && duration && duration > 0
      ? Math.min(100, (elapsed / duration) * 100)
      : 0;

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Browser denied fullscreen.
    }
  };

  return (
    <>
      <header>
        <a className="brand" href="./">
          <span className="brand-icon">▦</span>
          REACTOR
          <span className="edition">AUDIO LAB / 01</span>
        </a>
        <span className="top-note">声音，进入堆芯。</span>
        <button className="plain" type="button" onClick={() => void fullscreen()}>
          全屏 ↗
        </button>
      </header>

      <main>
        <section className="stage">
          <div className="stage-title">
            <div className="eyebrow">REAL-TIME AUDIO VISUALIZER</div>
            <h1>
              声场反应堆<span> / CORE 01</span>
            </h1>
          </div>

          <div className="live">
            <i />
            <span>{audio.playing ? "运行中" : "待机 · 演示预览"}</span>
          </div>

          <ReactorVisualizer
            engine={engine}
            sensitivity={sensitivity}
            smoothing={smoothing}
            resetViewToken={resetViewToken}
            onMetrics={updateMetrics}
          />

          <div className="axis top">
            CONTROL ROD ARRAY · {REACTOR_CHANNEL_COUNT} CHANNELS
          </div>

          <div className="stage-bottom">
            <span>
              ↔ 拖动旋转视角 <span className="desktop">/ 滚轮缩放</span>
            </span>
            <button
              type="button"
              className="plain"
              onClick={() => setResetViewToken((value) => value + 1)}
            >
              重置视角 ⤾
            </button>
          </div>

          <div className="scale">
            <span>振幅</span>
            <div />
            <span>高</span>
            <span>低</span>
          </div>
        </section>

        <aside>
          <div className="panel-title">
            <span>控制台</span>
            <span className="eyebrow">CONTROL PANEL</span>
          </div>

          <section className="source">
            <label className="caption">01 / 音频输入</label>

            <div className="source-tabs">
              <button
                type="button"
                className={audio.mode === "demo" ? "selected" : ""}
                onClick={selectDemo}
              >
                演示信号
              </button>
              <button
                type="button"
                className={audio.mode === "mic" ? "selected" : ""}
                onClick={selectMic}
              >
                麦克风
              </button>
            </div>

            <button
              type="button"
              className="upload"
              onClick={() => fileRef.current?.click()}
            >
              <span>＋</span>
              <strong>导入音频文件</strong>
              <small>MP3 / WAV / M4A / FLAC</small>
            </button>

            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(event) => {
                handleFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />

            <div className="track">
              <span className="track-icon">≋</span>
              <div>
                <strong>{audio.trackName}</strong>
                <small>
                  {audio.playing ? "控制棒随频谱实时响应" : "点击播放，启动声场"}
                </small>
              </div>
              <button
                type="button"
                className="play"
                aria-label={audio.playing ? "暂停" : "播放"}
                onClick={togglePlay}
              >
                {audio.playing ? "Ⅱ" : "▶"}
              </button>
            </div>

            <div className="timeline">
              <input
                aria-label="播放进度"
                type="range"
                min="0"
                max="100"
                value={seekValue}
                step="0.1"
                disabled={audio.mode !== "file"}
                onChange={(event) => void engine.seek(Number(event.target.value))}
              />
              <div>
                <span>{formatTime(elapsed)}</span>
                <span>{duration ? formatTime(duration) : "DEMO / LOOP"}</span>
              </div>
            </div>
          </section>

          <section>
            <label className="caption">02 / 控制棒响应</label>

            <div className="slider-title">
              <label htmlFor="gain">灵敏度</label>
              <output>{sensitivity.toFixed(1)}×</output>
            </div>
            <input
              id="gain"
              type="range"
              min="0.3"
              max="3"
              value={sensitivity}
              step="0.1"
              onChange={(event) => setSensitivity(Number(event.target.value))}
            />

            <div className="slider-title">
              <label htmlFor="smooth">运动平滑度</label>
              <output>{smoothing}%</output>
            </div>
            <input
              id="smooth"
              type="range"
              min="0"
              max="95"
              value={smoothing}
              onChange={(event) => setSmoothing(Number(event.target.value))}
            />

            <div className="slider-title">
              <label htmlFor="volume">播放音量</label>
              <output>{volume}%</output>
            </div>
            <input
              id="volume"
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />

            <div className="slider-title">
              <span>频段分布</span>
              <span className="subtle">中心 → 边缘</span>
            </div>
            <div className="legend">
              <span>
                <i className="low" />
                低频
              </span>
              <span>
                <i className="mid" />
                中频
              </span>
              <span>
                <i className="high" />
                高频
              </span>
            </div>
          </section>

          <section className="readings">
            <label className="caption">03 / 实时读数</label>
            <div className="meters">
              <div>
                <span>输入电平</span>
                <strong>
                  {levelDb === null ? "—" : Math.round(levelDb)}
                  <small>dB</small>
                </strong>
              </div>
              <div>
                <span>峰值频率</span>
                <strong>
                  {peakHz === null ? "—" : Math.round(peakHz)}
                  <small>Hz</small>
                </strong>
              </div>
            </div>
            <div className="spectrum-slot" />
          </section>

          <p className="message" role="status">
            {audio.message}
          </p>
        </aside>
      </main>

      <footer>
        <span>
          <b>◈</b> REACTOR EXPERIMENT
        </span>
        <span>音乐驱动 · 非真实反应堆模拟</span>
        <span>WEB AUDIO / LIVE</span>
      </footer>
    </>
  );
}
