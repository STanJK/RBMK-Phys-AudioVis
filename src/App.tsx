import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine, type AudioEngineState } from "./audio/AudioEngine";
import { BilibiliSource } from "./bilibili/BilibiliSource";
import { PhysicsReactor } from "./physics/PhysicsReactor";
import { ROD_LAYOUT, ROD_LENGTH } from "./reactor/layout";
import { SpectrumAnalyzer } from "./visualizer/SpectrumAnalyzer";

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
  const [sensitivity, setSensitivity] = useState(0.8);
  const [smoothing, setSmoothing] = useState(67);
  const [volume, setVolume] = useState(40);
  const [levelDb, setLevelDb] = useState<number | null>(null);
  const [peakHz, setPeakHz] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [resetViewToken, setResetViewToken] = useState(0);
  const [az5TriggerToken, setAz5TriggerToken] = useState(0);
  const [randomEjectionsEnabled, setRandomEjectionsEnabled] = useState(true);
  const [randomEjectionCount, setRandomEjectionCount] = useState(0);
  const [lastRandomEjection, setLastRandomEjection] = useState<number | null>(null);
  const [physicsEpoch, setPhysicsEpoch] = useState(0);
  const [showBilibili, setShowBilibili] = useState(true);
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

  const updateMetrics = useCallback(
    (level: number | null, peak: number | null) => {
      setLevelDb(level);
      setPeakHz(peak);
    },
    [],
  );

  const duration = audio.duration ?? engine.durationSeconds;
  const seekValue =
    (audio.mode === "file" || audio.mode === "bilibili") &&
    duration &&
    duration > 0
      ? Math.min(100, (elapsed / duration) * 100)
      : 0;

  const resetPhysics = () => {
    setAz5TriggerToken(0);
    setRandomEjectionCount(0);
    setLastRandomEjection(null);
    setPhysicsEpoch((value) => value + 1);
  };

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
          <span className="edition">PHYS AUDIO LAB / 01</span>
        </a>
        <span className="top-note">声音，进入堆芯。</span>
        <button className="plain" type="button" onClick={() => void fullscreen()}>
          全屏 ↗
        </button>
      </header>

      <main>
        <section className="stage">
          <div className="stage-title">
            <div className="eyebrow">REAL-TIME PHYSICS AUDIO VISUALIZER</div>
            <h1>
              声场反应堆<span> / CORE 01</span>
            </h1>
          </div>

          <div className="live">
            <i />
            <span>
              {audio.playing
                ? "运行中 · RAPIER PHYSICS"
                : "待机 · 物理场在线"}
            </span>
          </div>

          <PhysicsReactor
            key={physicsEpoch}
            physicsEpoch={physicsEpoch}
            engine={engine}
            sensitivity={sensitivity}
            smoothing={smoothing}
            randomEjectionsEnabled={randomEjectionsEnabled}
            az5TriggerToken={az5TriggerToken}
            onRandomEjection={(channel) => {
              setRandomEjectionCount((value) => value + 1);
              setLastRandomEjection(channel);
            }}
            resetViewToken={resetViewToken}
          />

          <div className="axis top">
            FIXED-LENGTH ROD ARRAY · {ROD_LAYOUT.length} CHANNELS
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
            <span>提升量</span>
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
                className={showBilibili ? "selected" : ""}
                onClick={() => {
                  setShowBilibili(true);
                  engine.selectBilibiliIdle();
                }}
              >
                B站
              </button>
              <button
                type="button"
                className={!showBilibili && audio.mode === "demo" ? "selected" : ""}
                onClick={() => {
                  setShowBilibili(false);
                  void engine.selectDemo();
                }}
              >
                演示
              </button>
              <button
                type="button"
                className={!showBilibili && audio.mode === "mic" ? "selected" : ""}
                onClick={() => {
                  setShowBilibili(false);
                  void engine.selectMic();
                }}
              >
                麦克风
              </button>
            </div>

            {showBilibili ? (
              <BilibiliSource engine={engine} />
            ) : (
              <>
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
                    const file = event.target.files?.[0];
                    if (file) void engine.loadFile(file);
                    event.currentTarget.value = "";
                  }}
                />
              </>
            )}

            <div className="track">
              <span className="track-icon">≋</span>
              <div>
                <strong>{audio.trackName}</strong>
                <small>
                  {audio.playing
                    ? "固定长度棒阵列随频谱实时升降"
                    : audio.mode === "bilibili"
                      ? "解析完成后点击播放"
                      : "点击播放，启动声场"}
                </small>
              </div>
              <button
                type="button"
                className="play"
                aria-label={audio.playing ? "暂停" : "播放"}
                onClick={() => void engine.toggle()}
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
                disabled={
                  audio.mode !== "file" && audio.mode !== "bilibili"
                }
                onChange={(event) =>
                  void engine.seek(Number(event.target.value))
                }
              />
              <div>
                <span>{formatTime(elapsed)}</span>
                <span>
                  {duration
                    ? formatTime(duration)
                    : audio.mode === "bilibili"
                      ? "BILIBILI"
                      : "DEMO / LOOP"}
                </span>
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
              onChange={(event) =>
                setSensitivity(Number(event.target.value))
              }
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
              onChange={(event) =>
                setSmoothing(Number(event.target.value))
              }
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
              onChange={(event) =>
                setVolume(Number(event.target.value))
              }
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
            <SpectrumAnalyzer engine={engine} onMetrics={updateMetrics} />
          </section>

          <section className="physics-panel">
            <label className="caption">04 / 物理实验</label>
            <div className="physics-status">
              <span>AIR WALL</span>
              <strong>
                {az5TriggerToken > 0
                  ? "UPPER WALL BYPASSED / LOWER WALL ACTIVE"
                  : "2× ROD LENGTH / LOWER WALL ACTIVE"}
              </strong>
            </div>

            <div className="physics-status">
              <span>HEIGHT LIMIT</span>
              <strong>5× ROD LENGTH / {(ROD_LENGTH * 5).toFixed(1)} UNITS</strong>
            </div>

            <label className="accident-toggle">
              <input
                type="checkbox"
                checked={randomEjectionsEnabled}
                onChange={(event) =>
                  setRandomEjectionsEnabled(event.target.checked)
                }
              />
              <span>
                <strong>随机超调事故</strong>
                <small>
                  每 3 秒判定 · 选中后 3 秒绿→红预热 · VY ×10
                </small>
              </span>
            </label>

            <div className="physics-status">
              <span>RANDOM EJECTION</span>
              <strong>
                {randomEjectionCount === 0
                  ? "ARMED / NONE"
                  : `${randomEjectionCount} TOTAL · LAST CH-${lastRandomEjection}`}
              </strong>
            </div>

            <button
              className="az5-button"
              type="button"
              onClick={() => setAz5TriggerToken((value) => value + 1)}
            >
              AZ5
            </button>

            <button
              className="reset-physics"
              type="button"
              onClick={resetPhysics}
            >
              重置物理场
            </button>
          </section>

          <p className="message" role="status">
            {audio.message}
          </p>
        </aside>
      </main>

      <footer>
        <span>
          <b>◈</b> RBMK PHYS AUDIOVIS
        </span>
        <span>音乐驱动 · 刚体实验 · 非真实反应堆模拟</span>
        <span>WEB AUDIO / THREE / RAPIER</span>
      </footer>
    </>
  );
}
