import type { BilibiliVideoRef } from "./parse";

export interface ResolvedBilibiliAudio {
  bvid: string;
  cid: number;
  page: number;
  title: string;
  part: string;
  owner: string | null;
  duration: number | null;
  streamUrl: string;
  strategy: "dash-audio" | "durl-mp4";
  bandwidth: number | null;
}

export function getConfiguredWorkerUrl(): string {
  const envUrl = (
    import.meta.env.VITE_BILIBILI_WORKER_URL as string | undefined
  )?.trim();

  if (envUrl) return normalizeWorkerUrl(envUrl);

  try {
    return normalizeWorkerUrl(
      window.localStorage.getItem("rbmk-bili-worker-url") ?? "",
    );
  } catch {
    return "";
  }
}

export function saveWorkerUrl(value: string) {
  const normalized = normalizeWorkerUrl(value);
  try {
    if (normalized) {
      window.localStorage.setItem("rbmk-bili-worker-url", normalized);
    } else {
      window.localStorage.removeItem("rbmk-bili-worker-url");
    }
  } catch {
    // Storage may be blocked; the in-memory value still works.
  }
  return normalized;
}

export async function resolveBilibiliAudio(
  workerUrl: string,
  ref: BilibiliVideoRef,
): Promise<ResolvedBilibiliAudio> {
  const base = normalizeWorkerUrl(workerUrl);
  if (!base) throw new Error("请先配置 Bilibili Worker URL");

  const url = new URL(base + "/resolve");
  url.searchParams.set("bvid", ref.bvid);
  url.searchParams.set("p", String(ref.page));

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Worker 返回了非 JSON 响应（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Worker 解析失败（HTTP ${response.status}）`;
    throw new Error(message);
  }

  return payload as ResolvedBilibiliAudio;
}

function normalizeWorkerUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}
