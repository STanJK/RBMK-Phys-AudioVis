import { useState } from "react";
import type { AudioEngine } from "../audio/AudioEngine";
import {
  buildBilibiliEmbedUrl,
  parseBilibiliInput,
  type BilibiliVideoRef,
} from "./parse";

interface BilibiliSourceProps {
  engine: AudioEngine;
  capturing: boolean;
}

export function BilibiliSource({
  engine,
  capturing,
}: BilibiliSourceProps) {
  const [input, setInput] = useState("");
  const [video, setVideo] = useState<BilibiliVideoRef | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    try {
      const parsed = parseBilibiliInput(input);
      setVideo(parsed);
      setError(null);
      engine.selectTabSource(`BILIBILI / ${parsed.bvid} / P${parsed.page}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法解析 B 站链接");
    }
  };

  return (
    <div className="bilibili-source">
      <div className="bili-input-row">
        <input
          className="bili-input"
          type="text"
          value={input}
          spellCheck={false}
          placeholder="https://www.bilibili.com/video/BV... 或 BV..."
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") load();
          }}
        />
        <button type="button" onClick={load}>
          载入
        </button>
      </div>

      {error && <p className="bili-error">{error}</p>}

      {video && (
        <>
          <div className="bili-player">
            <iframe
              title={`Bilibili ${video.bvid}`}
              src={buildBilibiliEmbedUrl(video)}
              allow="autoplay; fullscreen"
              allowFullScreen
              scrolling="no"
            />
          </div>

          <button
            type="button"
            className={capturing ? "capture-tab active" : "capture-tab"}
            onClick={() =>
              capturing ? engine.pause() : void engine.captureTabAudio()
            }
          >
            {capturing ? "停止捕获标签页音频" : "捕获本标签页音频"}
          </button>

          <p className="bili-help">
            在弹出的共享窗口里选择“此标签页/当前标签页”，并勾选“共享标签页音频”。
            捕获后浏览器会尽量抑制 B 站播放器的原始本地声音，再由本站通过 Web Audio 回放；
            下方“播放音量”滑条控制实际输出音量。
          </p>
        </>
      )}
    </div>
  );
}
