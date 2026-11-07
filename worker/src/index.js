const CDN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

// Bilibili's WAF currently treats datacenter egress + desktop-browser UA
// much more aggressively on metadata endpoints. A non-browser client UA
// avoids the legacy view endpoint's HTTP 412 in current deployments.
const API_UA = "okhttp/4.9.3";

const API_ORIGIN = "https://api.bilibili.com";
const BILI_REFERER = "https://www.bilibili.com/";

const ALLOWED_STREAM_SUFFIXES = [
  ".bilivideo.com",
  ".bilivideo.cn",
  ".mcdn.bilivideo.cn",
  ".biliapi.net",
  ".hdslb.com",
  ".bilibili.com",
];

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({
          ok: true,
          service: "rbmk-bili-audio-proxy",
          endpoints: ["/resolve?bvid=BV...&p=1", "/stream?url=..."],
        });
      }

      if (url.pathname === "/resolve") {
        if (request.method !== "GET") return methodNotAllowed();
        return await resolveAudio(request, url);
      }

      if (url.pathname === "/stream") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return methodNotAllowed();
        }
        return await proxyStream(request, url);
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: message }, 502);
    }
  },
};

async function resolveAudio(request, requestUrl) {
  const bvid = (requestUrl.searchParams.get("bvid") || "").trim();
  const page = Number(requestUrl.searchParams.get("p") || "1");

  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
    return json({ error: "invalid bvid" }, 400);
  }

  if (!Number.isInteger(page) || page < 1) {
    return json({ error: "invalid page" }, 400);
  }

  // Prefer /view because it already contains pages[] + cid. This removes one
  // extra pagelist request and is materially less likely to trip Bilibili WAF.
  let view = null;
  let pageList = null;

  try {
    const viewUrl = new URL("/x/web-interface/view", API_ORIGIN);
    viewUrl.searchParams.set("bvid", bvid);
    const viewResult = await biliJson(viewUrl, "view");
    if (viewResult.code !== 0 || !viewResult.data) {
      throw new Error(`view business error: ${viewResult.message || viewResult.code}`);
    }
    view = viewResult.data;
  } catch (error) {
    // Keep pagelist as a metadata-minimal fallback. If both fail, preserve the
    // first useful endpoint name in the error instead of returning a generic 412.
    try {
      const pageListUrl = new URL("/x/player/pagelist", API_ORIGIN);
      pageListUrl.searchParams.set("bvid", bvid);
      pageListUrl.searchParams.set("jsonp", "jsonp");
      const result = await biliJson(pageListUrl, "pagelist");
      if (result.code !== 0 || !Array.isArray(result.data)) {
        throw new Error(`pagelist business error: ${result.message || result.code}`);
      }
      pageList = result.data;
    } catch (fallbackError) {
      throw new Error(
        `metadata failed; primary: ${errorMessage(error)}; fallback: ${errorMessage(fallbackError)}`,
      );
    }
  }

  const pages = Array.isArray(view?.pages)
    ? view.pages
    : Array.isArray(pageList)
      ? pageList
      : [];

  const selectedPage =
    pages.find((item) => Number(item.page) === page) ??
    pages[page - 1];

  if (!selectedPage?.cid) {
    return json({ error: `page P${page} not found` }, 404);
  }

  const playUrl = new URL("/x/player/playurl", API_ORIGIN);
  playUrl.searchParams.set("bvid", bvid);
  playUrl.searchParams.set("cid", String(selectedPage.cid));
  playUrl.searchParams.set("qn", "80");
  playUrl.searchParams.set("fnver", "0");
  playUrl.searchParams.set("fnval", "16");
  playUrl.searchParams.set("fourk", "1");

  const play = await biliJson(playUrl, "playurl-dash");

  let sourceUrl = null;
  let strategy = null;
  let bandwidth = null;

  if (play.code === 0 && Array.isArray(play.data?.dash?.audio)) {
    const tracks = play.data.dash.audio
      .filter((track) => track && (track.baseUrl || track.base_url))
      .sort((a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0));

    const best = tracks[0];
    if (best) {
      sourceUrl = best.baseUrl || best.base_url;
      bandwidth = Number(best.bandwidth || 0) || null;
      strategy = "dash-audio";
    }
  }

  if (!sourceUrl) {
    const fallbackUrl = new URL("/x/player/playurl", API_ORIGIN);
    fallbackUrl.searchParams.set("bvid", bvid);
    fallbackUrl.searchParams.set("cid", String(selectedPage.cid));
    fallbackUrl.searchParams.set("qn", "64");
    fallbackUrl.searchParams.set("fnver", "0");
    fallbackUrl.searchParams.set("fnval", "1");
    fallbackUrl.searchParams.set("platform", "html5");
    fallbackUrl.searchParams.set("high_quality", "1");

    const fallback = await biliJson(fallbackUrl, "playurl-html5");
    sourceUrl =
      fallback.code === 0 ? fallback.data?.durl?.[0]?.url ?? null : null;
    if (sourceUrl) strategy = "durl-mp4";
  }

  if (!sourceUrl || !strategy) {
    throw new Error(
      `playurl returned no playable public audio: ${play.message || play.code}`,
    );
  }

  assertAllowedStreamUrl(sourceUrl);

  const stream = new URL("/stream", request.url);
  stream.searchParams.set("url", sourceUrl);

  const title = String(view?.title || selectedPage.part || bvid);
  const part = String(selectedPage.part || title);
  const duration =
    Number(selectedPage.duration || view?.duration || 0) || null;

  return json({
    bvid,
    cid: Number(selectedPage.cid),
    page,
    title,
    part,
    owner: view?.owner?.name ? String(view.owner.name) : null,
    duration,
    directUrl: sourceUrl,
    sourceUrl,
    proxyUrl: stream.toString(),
    streamUrl: stream.toString(),
    strategy,
    bandwidth,
  });
}


async function proxyStream(request, requestUrl) {
  const target = requestUrl.searchParams.get("url");
  if (!target) return json({ error: "missing url" }, 400);

  const targetUrl = assertAllowedStreamUrl(target);

  const headers = new Headers();
  headers.set("User-Agent", CDN_UA);
  headers.set("Referer", BILI_REFERER);
  headers.set("Origin", "https://www.bilibili.com");
  headers.set("Accept", request.headers.get("Accept") || "*/*");

  for (const name of ["Range", "If-Range", "If-None-Match", "If-Modified-Since"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    redirect: "follow",
  });

  const responseHeaders = corsHeaders();
  for (const name of [
    "Content-Type",
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "ETag",
    "Last-Modified",
    "Cache-Control",
  ]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  responseHeaders.set("X-RBMK-Proxy", "bilibili-audio");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function biliJson(url, label = "api") {
  const response = await fetch(url, {
    headers: {
      "User-Agent": API_UA,
      Referer: BILI_REFERER,
      Origin: "https://www.bilibili.com",
      Accept: "application/json, text/plain, */*",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) {
    throw new Error("Bilibili API returned non-JSON response");
  }

  return response.json();
}

function assertAllowedStreamUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid stream URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("only HTTPS stream URLs are allowed");
  }

  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_STREAM_SUFFIXES.some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
  );

  if (!allowed) {
    throw new Error("stream host not allowed");
  }

  return url;
}

function corsHeaders() {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers":
      "Range, If-Range, If-None-Match, If-Modified-Since, Content-Type",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, X-RBMK-Proxy",
  });
}

function json(body, status = 200) {
  const headers = corsHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function methodNotAllowed() {
  return json({ error: "method not allowed" }, 405);
}


function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
