const SQUIDTAIL_PARSE_URL =
  "https://api.squidtail.com/bili2vrc/parse/";

const CDN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

const BILI_REFERER = "https://www.bilibili.com/";

const ALLOWED_STREAM_SUFFIXES = [
  ".bilivideo.com",
  ".bilivideo.cn",
  ".mcdn.bilivideo.cn",
  ".biliapi.net",
  ".hdslb.com",
  ".bilibili.com",
];

const ALLOWED_STREAM_HOSTS = new Set([
  "api.squidtail.com",
  "upos-hz-mirrorakam.akamaized.net",
]);

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
          resolver: "squidtail-bili2vrc",
          upstream: SQUIDTAIL_PARSE_URL,
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

  const upstreamUrl = new URL(SQUIDTAIL_PARSE_URL);
  upstreamUrl.searchParams.set("bv", bvid);
  upstreamUrl.searchParams.set("p", String(page));
  upstreamUrl.searchParams.set("format", "mp4");
  upstreamUrl.searchParams.set("otype", "json");

  const upstream = await fetch(upstreamUrl, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": CDN_UA,
    },
    redirect: "follow",
  });

  const raw = await upstream.text();

  if (!upstream.ok) {
    throw new Error(
      `Squidtail HTTP ${upstream.status}${raw ? `: ${truncate(raw, 240)}` : ""}`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Squidtail returned non-JSON: ${truncate(raw, 240)}`,
    );
  }

  const code = Number(parsed?.code);
  const sourceUrl =
    typeof parsed?.url === "string" ? normalizeMediaUrl(parsed.url) : "";

  if (code !== 0 || !sourceUrl) {
    const message =
      typeof parsed?.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : `code ${Number.isFinite(code) ? code : "unknown"}`;
    throw new Error(`Squidtail parse failed: ${message}`);
  }

  assertAllowedStreamUrl(sourceUrl);

  const stream = new URL("/stream", request.url);
  stream.searchParams.set("url", sourceUrl);

  const quality =
    typeof parsed?.quality === "string"
      ? parsed.quality
      : parsed?.quality == null
        ? null
        : String(parsed.quality);

  return json({
    bvid,
    page,
    title: bvid,
    part: `P${page}`,
    duration: null,
    streamUrl: stream.toString(),
    strategy: "squidtail-mp4",
    quality,
    resolver: "squidtail-bili2vrc",
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

  for (const name of [
    "Range",
    "If-Range",
    "If-None-Match",
    "If-Modified-Since",
  ]) {
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

function normalizeMediaUrl(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return `https:${trimmed}`;

  const url = new URL(trimmed);
  if (url.protocol === "http:") url.protocol = "https:";
  return url.toString();
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
  const allowed =
    ALLOWED_STREAM_HOSTS.has(host) ||
    ALLOWED_STREAM_SUFFIXES.some(
      (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
    );

  if (!allowed) {
    throw new Error(`stream host not allowed: ${host}`);
  }

  return url;
}

function truncate(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
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
