import { useState } from "react";
import type { AudioEngine } from "../audio/AudioEngine";
import {
  resolveBilibiliAudio,
  type ResolvedBilibiliAudio,
} from "./api";
import { parseBilibiliInput } from "./parse";
import { BILIBILI_PRESETS, presetInput } from "./presets";

interface BilibiliSourceProps {
  engine: AudioEngine;
}

export function BilibiliSource({ engine }: BilibiliSourceProps) {
  const [input, setInput] = useState("");
  const [resolved, setResolved] = useState<ResolvedBilibiliAudio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (rawInput = input) => {
    try {
      setLoading(true);
      setError(null);

      const ref = parseBilibiliInput(rawInput);
      const result = await resolveBilibiliAudio(ref);
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
            P{resolved.page} · {resolved.part} · {resolved.strategy}
          </span>
          <span>
            RESOLVER: SQUIDTAIL BILI2VRC
            {resolved.quality ? ` · ${resolved.quality}` : ""}
          </span>
          <span>
            {resolved.proxyUrl
              ? "MEDIA: DIRECT + WORKER STREAM FALLBACK"
              : "MEDIA: DIRECT"}
          </span>
        </div>
      )}

      <p className="bili-help">
        B 站解析只通过内置 Worker 调用 Squidtail Bili2VRC API。
        浏览器和 Worker 均不再直接调用 Bilibili metadata / WBI 接口。
      </p>
    </div>
  );
}
