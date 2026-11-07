import { useState } from "react";
import type { AudioEngine } from "../audio/AudioEngine";
import {
  getConfiguredWorkerUrl,
  resolveBilibiliAudio,
  saveWorkerUrl,
  type ResolvedBilibiliAudio,
} from "./api";
import { parseBilibiliInput } from "./parse";

interface BilibiliSourceProps {
  engine: AudioEngine;
}

export function BilibiliSource({ engine }: BilibiliSourceProps) {
  const [input, setInput] = useState("");
  const [workerUrl, setWorkerUrl] = useState(getConfiguredWorkerUrl);
  const [resolved, setResolved] = useState<ResolvedBilibiliAudio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      const ref = parseBilibiliInput(input);
      const savedWorkerUrl = saveWorkerUrl(workerUrl);
      setWorkerUrl(savedWorkerUrl);

      const result = await resolveBilibiliAudio(savedWorkerUrl, ref);
      setResolved(result);

      const label =
        result.part && result.part !== result.title
          ? `${result.title} / ${result.part}`
          : result.title;

      await engine.loadBilibili({
        streamUrl: result.streamUrl,
        trackName: `BILIBILI / ${label}`,
        duration: result.duration,
      });
    } catch (cause) {
      setResolved(null);
      setError(cause instanceof Error ? cause.message : "无法解析 B 站音频");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bilibili-source">
      <div className="worker-config">
        <label htmlFor="bili-worker-url">Worker URL</label>
        <input
          id="bili-worker-url"
          className="bili-input"
          type="url"
          value={workerUrl}
          spellCheck={false}
          placeholder="https://rbmk-bili-audio-proxy.<you>.workers.dev"
          onChange={(event) => setWorkerUrl(event.target.value)}
          onBlur={() => setWorkerUrl(saveWorkerUrl(workerUrl))}
        />
      </div>

      <div className="bili-input-row">
        <input
          className="bili-input"
          type="text"
          value={input}
          spellCheck={false}
          placeholder="https://www.bilibili.com/video/BV... 或 BV..."
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !loading) void load();
          }}
        />
        <button type="button" disabled={loading} onClick={() => void load()}>
          {loading ? "解析中" : "载入"}
        </button>
      </div>

      {error && <p className="bili-error">{error}</p>}

      {resolved && (
        <div className="bili-meta">
          <strong>{resolved.title}</strong>
          <span>
            P{resolved.page} · {resolved.part || "单P"} · {resolved.strategy}
          </span>
          <span>
            {resolved.owner ? `UP: ${resolved.owner}` : resolved.bvid}
            {resolved.bandwidth
              ? ` · ${Math.round(resolved.bandwidth / 1000)} kbps`
              : ""}
          </span>
        </div>
      )}

      <p className="bili-help">
        Worker 只解析公开 B 站播放信息并代理音频 Range 请求；不使用账号 Cookie。
        解析后用本站 Web Audio 播放、调音量和做 FFT。
      </p>
    </div>
  );
}
