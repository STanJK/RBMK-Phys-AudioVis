import { useState } from "react";
import type { AudioEngine } from "../audio/AudioEngine";
import {
  getConfiguredWorkerUrl,
  resolveBilibiliAudio,
  saveWorkerUrl,
  type ResolvedBilibiliAudio,
} from "./api";
import { parseBilibiliInput } from "./parse";
import { BILIBILI_PRESETS, presetInput } from "./presets";

interface BilibiliSourceProps {
  engine: AudioEngine;
}

export function BilibiliSource({ engine }: BilibiliSourceProps) {
  const [input, setInput] = useState("");
  const [workerUrl, setWorkerUrl] = useState(getConfiguredWorkerUrl);
  const [resolved, setResolved] = useState<ResolvedBilibiliAudio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (rawInput = input) => {
    try {
      setLoading(true);
      setError(null);

      const ref = parseBilibiliInput(rawInput);
      const savedWorkerUrl = saveWorkerUrl(workerUrl);
      setWorkerUrl(savedWorkerUrl);

      const result = await resolveBilibiliAudio(savedWorkerUrl, ref);
      setResolved(result);

      const label =
        result.part && result.part !== result.title
          ? `${result.title} / ${result.part}`
          : result.title;

      await engine.loadBilibili({
        streamUrls: result.streamUrls,
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
        <label htmlFor="bili-worker-url">Worker fallback URL（可选）</label>
        <input
          id="bili-worker-url"
          className="bili-input"
          type="url"
          value={workerUrl}
          spellCheck={false}
          placeholder="本地解析失败/直连失败时才使用"
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

      <div className="bili-presets">
        <span>DEFAULT TEST LIST</span>
        <div>
          {BILIBILI_PRESETS.map((preset) => {
            const value = presetInput(preset);
            return (
              <button
                key={preset.bvid + String(preset.page ?? 1)}
                type="button"
                disabled={loading}
                title={preset.note}
                onClick={() => {
                  setInput(value);
                  void load(value);
                }}
              >
                <strong>{preset.label}</strong>
                <small>{preset.note}</small>
              </button>
            );
          })}
        </div>
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
          <span>
            RESOLVER: {resolved.resolver === "browser" ? "BROWSER / LOCAL" : "WORKER FALLBACK"}
            {resolved.proxyUrl ? " · STREAM FALLBACK READY" : " · DIRECT ONLY"}
          </span>
          {resolved.localError && (
            <span title={resolved.localError}>
              LOCAL FAIL: {resolved.localError}
            </span>
          )}
        </div>
      )}

      <p className="bili-help">
        默认先由当前浏览器直接解析公开 B 站 API，并优先尝试 CDN 直连。
        如果遇到 CORS、HTTP 412 或 CDN 防盗链，且配置了 Worker，则自动退到
        Worker /resolve 或 /stream。Worker 不使用账号 Cookie。
      </p>
    </div>
  );
}
