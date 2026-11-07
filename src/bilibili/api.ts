import type { BilibiliVideoRef } from "./parse";

export type BilibiliResolverPath = "browser" | "worker-fallback";

export interface ResolvedBilibiliAudio {
  bvid: string;
  cid: number;
  page: number;
  title: string;
  part: string;
  owner: string | null;
  duration: number | null;
  directUrl: string;
  proxyUrl: string | null;
  streamUrls: string[];
  resolver: BilibiliResolverPath;
  strategy: "dash-audio" | "durl-mp4";
  bandwidth: number | null;
  localError: string | null;
}

interface BilibiliPage {
  cid: number;
  page: number;
  part?: string;
  duration?: number;
}

interface LocalResolvedCore {
  bvid: string;
  cid: number;
  page: number;
  title: string;
  part: string;
  owner: string | null;
  duration: number | null;
  directUrl: string;
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
  let localError: string | null = null;

  try {
    const local = await resolveBilibiliAudioLocally(ref);
    const proxyUrl = base
      ? buildWorkerStreamUrl(base, local.directUrl)
      : null;

    return {
      ...local,
      proxyUrl,
      streamUrls: uniqueUrls([local.directUrl, proxyUrl]),
      resolver: "browser",
      localError: null,
    };
  } catch (cause) {
    localError = errorMessage(cause);
  }

  if (!base) {
    throw new Error(
      `浏览器本地解析失败：${localError}。未配置 Worker fallback，因此无法继续。`,
    );
  }

  const fallback = await resolveViaWorker(base, ref);

  return {
    ...fallback,
    streamUrls: uniqueUrls([fallback.directUrl, fallback.proxyUrl]),
    resolver: "worker-fallback",
    localError,
  };
}

async function resolveBilibiliAudioLocally(
  ref: BilibiliVideoRef,
): Promise<LocalResolvedCore> {
  const viewUrl = new URL(
    "https://api.bilibili.com/x/web-interface/view",
  );
  viewUrl.searchParams.set("bvid", ref.bvid);

  const view = await browserBiliJson(viewUrl, "view");
  if (view.code !== 0 || !view.data) {
    throw new Error(`view API: ${view.message || view.code}`);
  }

  const pages = Array.isArray(view.data.pages)
    ? (view.data.pages as BilibiliPage[])
    : [];

  const selectedPage =
    pages.find((item) => Number(item.page) === ref.page) ??
    pages[ref.page - 1];

  if (!selectedPage?.cid) {
    throw new Error(`P${ref.page} 不存在或没有 cid`);
  }

  const primary = await requestBrowserPlayurl(
    ref.bvid,
    Number(selectedPage.cid),
    "dash",
  );

  let selected = selectPlayableSource(primary);

  if (!selected) {
    const fallback = await requestBrowserPlayurl(
      ref.bvid,
      Number(selectedPage.cid),
      "mp4",
    );
    selected = selectPlayableSource(fallback);
  }

  if (!selected) {
    throw new Error("playurl 没有返回可播放的公开音轨");
  }

  return {
    bvid: ref.bvid,
    cid: Number(selectedPage.cid),
    page: ref.page,
    title: String(view.data.title || selectedPage.part || ref.bvid),
    part: String(selectedPage.part || view.data.title || ref.bvid),
    owner: view.data.owner?.name ? String(view.data.owner.name) : null,
    duration:
      Number(selectedPage.duration || view.data.duration || 0) || null,
    directUrl: selected.url,
    strategy: selected.strategy,
    bandwidth: selected.bandwidth,
  };
}

async function requestBrowserPlayurl(
  bvid: string,
  cid: number,
  mode: "dash" | "mp4",
) {
  const url = new URL("https://api.bilibili.com/x/player/playurl");
  url.searchParams.set("bvid", bvid);
  url.searchParams.set("cid", String(cid));
  url.searchParams.set("qn", mode === "dash" ? "80" : "64");
  url.searchParams.set("fnver", "0");
  url.searchParams.set("fnval", mode === "dash" ? "16" : "1");

  if (mode === "dash") {
    url.searchParams.set("fourk", "1");
  } else {
    url.searchParams.set("platform", "html5");
    url.searchParams.set("high_quality", "1");
  }

  const payload = await browserBiliJson(url, "playurl");
  if (payload.code !== 0) {
    throw new Error(`playurl API: ${payload.message || payload.code}`);
  }

  return payload;
}

function selectPlayableSource(payload: any): {
  url: string;
  strategy: "dash-audio" | "durl-mp4";
  bandwidth: number | null;
} | null {
  if (Array.isArray(payload?.data?.dash?.audio)) {
    const tracks = payload.data.dash.audio
      .filter((track: any) => track && (track.baseUrl || track.base_url))
      .sort(
        (a: any, b: any) =>
          Number(b.bandwidth || 0) - Number(a.bandwidth || 0),
      );

    const best = tracks[0];
    if (best) {
      return {
        url: String(best.baseUrl || best.base_url),
        strategy: "dash-audio",
        bandwidth: Number(best.bandwidth || 0) || null,
      };
    }
  }

  const durl = payload?.data?.durl?.[0]?.url;
  if (durl) {
    return {
      url: String(durl),
      strategy: "durl-mp4",
      bandwidth: null,
    };
  }

  return null;
}

async function browserBiliJson(url: URL, label: string): Promise<any> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });
  } catch (cause) {
    throw new Error(
      `${label} 浏览器直连失败（通常是 CORS/网络限制）：${errorMessage(cause)}`,
    );
  }

  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${label} 返回了非 JSON 响应`);
  }
}

async function resolveViaWorker(
  base: string,
  ref: BilibiliVideoRef,
): Promise<Omit<ResolvedBilibiliAudio, "streamUrls" | "resolver" | "localError">> {
  const url = new URL(base + "/resolve");
  url.searchParams.set("bvid", ref.bvid);
  url.searchParams.set("p", String(ref.page));

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Worker 返回了非 JSON 响应（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : `Worker 解析失败（HTTP ${response.status}）`,
    );
  }

  const directUrl =
    typeof payload.directUrl === "string"
      ? payload.directUrl
      : typeof payload.sourceUrl === "string"
        ? payload.sourceUrl
        : "";

  const proxyUrl =
    typeof payload.proxyUrl === "string"
      ? payload.proxyUrl
      : typeof payload.streamUrl === "string"
        ? payload.streamUrl
        : null;

  if (!directUrl && !proxyUrl) {
    throw new Error("Worker 没有返回 direct/proxy 音频地址");
  }

  return {
    bvid: String(payload.bvid || ref.bvid),
    cid: Number(payload.cid || 0),
    page: Number(payload.page || ref.page),
    title: String(payload.title || ref.bvid),
    part: String(payload.part || payload.title || ref.bvid),
    owner: payload.owner ? String(payload.owner) : null,
    duration: Number(payload.duration || 0) || null,
    directUrl: directUrl || proxyUrl!,
    proxyUrl,
    strategy:
      payload.strategy === "durl-mp4" ? "durl-mp4" : "dash-audio",
    bandwidth: Number(payload.bandwidth || 0) || null,
  };
}

function buildWorkerStreamUrl(base: string, directUrl: string): string {
  const url = new URL(base + "/stream");
  url.searchParams.set("url", directUrl);
  return url.toString();
}

function uniqueUrls(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeWorkerUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
