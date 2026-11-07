import type { BilibiliVideoRef } from "./parse";

export const DEFAULT_BILIBILI_WORKER_URL =
  "https://rbmk-bili-audio-proxy.stanjk24.workers.dev";

const SQUIDTAIL_PARSE_URL =
  "https://api.squidtail.com/bili2vrc/parse/";
const DIRECT_RESOLVE_TIMEOUT_MS = 10_000;

export interface ResolvedBilibiliAudio {
  bvid: string;
  page: number;
  title: string;
  part: string;
  duration: number | null;
  streamUrl: string;
  streamUrls: string[];
  resolver: "squidtail-direct" | "squidtail-worker";
  strategy: "squidtail-mp4";
  quality: string | null;
}

export async function resolveBilibiliAudio(
  ref: BilibiliVideoRef,
): Promise<ResolvedBilibiliAudio> {
  const workerBase = normalizeWorkerUrl(
    (import.meta.env.VITE_BILIBILI_WORKER_URL as string | undefined)?.trim() ||
      DEFAULT_BILIBILI_WORKER_URL,
  );

  let directError: unknown;

  try {
    return await resolveDirect(ref, workerBase);
  } catch (cause) {
    directError = cause;
  }

  try {
    return await resolveViaWorker(ref, workerBase);
  } catch (workerError) {
    throw new Error(
      [
        "B 站音频解析失败。",
        `直连 Squidtail：${errorMessage(directError)}`,
        `Cloudflare fallback：${errorMessage(workerError)}`,
      ].join(" "),
    );
  }
}

async function resolveDirect(
  ref: BilibiliVideoRef,
  workerBase: string,
): Promise<ResolvedBilibiliAudio> {
  const url = new URL(SQUIDTAIL_PARSE_URL);
  url.searchParams.set("bv", ref.bvid);
  url.searchParams.set("p", String(ref.page));
  url.searchParams.set("format", "mp4");
  url.searchParams.set("otype", "json");

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    DIRECT_RESOLVE_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new Error("10 秒内未完成，切换 Cloudflare fallback");
    }
    throw cause;
  } finally {
    globalThis.clearTimeout(timeout);
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `Squidtail 直连返回非 JSON（HTTP ${response.status}）`,
    );
  }

  if (!response.ok) {
    throw new Error(
      typeof payload?.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : `HTTP ${response.status}`,
    );
  }

  const code = Number(payload?.code);
  const sourceUrl =
    typeof payload?.url === "string" ? normalizeMediaUrl(payload.url) : "";

  if (code !== 0 || !sourceUrl) {
    const message =
      typeof payload?.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : `code ${Number.isFinite(code) ? code : "unknown"}`;
    throw new Error(`Squidtail parse failed: ${message}`);
  }

  const workerStreamUrl = buildWorkerStreamUrl(workerBase, sourceUrl);

  return {
    bvid: ref.bvid,
    page: ref.page,
    title: ref.bvid,
    part: `P${ref.page}`,
    duration: null,
    streamUrl: sourceUrl,
    streamUrls: [sourceUrl, workerStreamUrl],
    resolver: "squidtail-direct",
    strategy: "squidtail-mp4",
    quality: normalizeQuality(payload?.quality),
  };
}

async function resolveViaWorker(
  ref: BilibiliVideoRef,
  workerBase: string,
): Promise<ResolvedBilibiliAudio> {
  const url = new URL(workerBase + "/resolve");
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
    throw new Error(
      `Cloudflare Resolver 返回非 JSON（HTTP ${response.status}）`,
    );
  }

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `Cloudflare Resolver 失败（HTTP ${response.status}）`,
    );
  }

  const streamUrl =
    typeof payload.streamUrl === "string" ? payload.streamUrl : "";

  if (!streamUrl) {
    throw new Error("Cloudflare Resolver 没有返回 Worker 媒体流地址");
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
    quality: normalizeQuality(payload?.quality),
  };
}

function buildWorkerStreamUrl(workerBase: string, sourceUrl: string) {
  const stream = new URL(workerBase + "/stream");
  stream.searchParams.set("url", sourceUrl);
  return stream.toString();
}

function normalizeMediaUrl(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return `https:${trimmed}`;

  const url = new URL(trimmed);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") {
    throw new Error("Squidtail 返回了非 HTTPS 媒体地址");
  }
  return url.toString();
}

function normalizeQuality(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value == null) return null;
  return String(value);
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value || "unknown error");
}

function normalizeWorkerUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}
