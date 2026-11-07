import type { BilibiliVideoRef } from "./parse";

export const DEFAULT_BILIBILI_WORKER_URL =
  "https://rbmk-bili-audio-proxy.stanjk24.workers.dev";

export interface ResolvedBilibiliAudio {
  bvid: string;
  page: number;
  title: string;
  part: string;
  duration: number | null;
  streamUrl: string;
  streamUrls: string[];
  resolver: "squidtail-worker";
  strategy: "squidtail-mp4";
  quality: string | null;
}

export async function resolveBilibiliAudio(
  ref: BilibiliVideoRef,
): Promise<ResolvedBilibiliAudio> {
  const base = normalizeWorkerUrl(
    (import.meta.env.VITE_BILIBILI_WORKER_URL as string | undefined)?.trim() ||
      DEFAULT_BILIBILI_WORKER_URL,
  );

  const url = new URL(base + "/resolve");
  url.searchParams.set("bvid", ref.bvid);
  url.searchParams.set("p", String(ref.page));

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Resolver 返回了非 JSON 响应（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `Resolver 失败（HTTP ${response.status}）`,
    );
  }

  const streamUrl =
    typeof payload.streamUrl === "string" ? payload.streamUrl : "";

  if (!streamUrl) {
    throw new Error("Resolver 没有返回 Worker 媒体流地址");
  }

  return {
    bvid: String(payload.bvid || ref.bvid),
    page: Number(payload.page || ref.page),
    title: String(payload.title || ref.bvid),
    part: String(payload.part || `P${ref.page}`),
    duration: Number(payload.duration || 0) || null,
    streamUrl,
    streamUrls: [streamUrl],
    resolver: "squidtail-worker",
    strategy: "squidtail-mp4",
    quality:
      typeof payload.quality === "string" && payload.quality.trim()
        ? payload.quality.trim()
        : null,
  };
}

function normalizeWorkerUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}
