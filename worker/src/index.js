const CDN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

const API_UA = "okhttp/4.9.3";
const API_ORIGIN = "https://api.bilibili.com";
const BILI_REFERER = "https://www.bilibili.com/";

const WBI_MIXIN_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const ALLOWED_STREAM_SUFFIXES = [
  ".bilivideo.com",
  ".bilivideo.cn",
  ".mcdn.bilivideo.cn",
  ".biliapi.net",
  ".hdslb.com",
  ".bilibili.com",
];

let cachedWbi = null;

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
          resolver: "wbi-view + signed-plain-playurl",
          endpoints: ["/resolve?bvid=BV...&p=1", "/stream?url=..."],
        });
      }

      if (url.pathname === "/resolve") {
        if (request.method !== "GET") return methodNotAllowed();
        return await resolveAudio(request, url);
      }

      if (url.pathname === "/diagnose") {
        if (request.method !== "GET") return methodNotAllowed();
        return await diagnoseBilibili(url);
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


async function diagnoseBilibili(requestUrl) {
  const bvid = (requestUrl.searchParams.get("bvid") || "BV1VGYR6bECg").trim();

  const targets = [
    ["video-page", `https://www.bilibili.com/video/${bvid}/`],
    ["homepage", "https://www.bilibili.com/"],
    ["api-nav", "https://api.bilibili.com/x/web-interface/nav"],
    ["api-view", `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`],
  ];

  const results = [];

  for (const [name, target] of targets) {
    try {
      const response = await fetch(target, {
        headers: {
          "User-Agent": CDN_UA,
          Referer: BILI_REFERER,
          Accept: name.includes("page") || name === "homepage"
            ? "text/html,application/xhtml+xml"
            : "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        redirect: "manual",
      });

      const text = await response.text();
      results.push({
        name,
        status: response.status,
        location: response.headers.get("location"),
        contentType: response.headers.get("content-type"),
        hasInitialState: text.includes("__INITIAL_STATE__"),
        hasPlayInfo: text.includes("__playinfo__"),
        prefix: text.slice(0, 120),
      });
    } catch (error) {
      results.push({
        name,
        error: errorMessage(error),
      });
    }
  }

  return json({ ok: true, bvid, results });
}

async function resolveAudio(request, requestUrl) {
  const bvid = (requestUrl.searchParams.get("bvid") || "").trim();
  const page = Number(requestUrl.searchParams.get("p") || "1");

  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
    return json({ error: "invalid bvid" }, 400);
  }

  if (!Number.isInteger(page) || page < 1) {
    return json({ error: "invalid page" }, 400);
  }

  let view = null;
  let pageList = null;
  let metadataErrors = [];

  try {
    const result = await wbiJson(
      "/x/web-interface/wbi/view",
      { bvid },
      "wbi-view",
    );
    if (result.code !== 0 || !result.data) {
      throw new Error(`wbi-view business error: ${result.message || result.code}`);
    }
    view = result.data;
  } catch (error) {
    metadataErrors.push(errorMessage(error));
  }

  if (!view) {
    try {
      const legacyUrl = new URL("/x/web-interface/view", API_ORIGIN);
      legacyUrl.searchParams.set("bvid", bvid);
      const result = await biliJson(legacyUrl, "legacy-view");
      if (result.code !== 0 || !result.data) {
        throw new Error(`legacy-view business error: ${result.message || result.code}`);
      }
      view = result.data;
    } catch (error) {
      metadataErrors.push(errorMessage(error));
    }
  }

  if (!view) {
    try {
      const pageListUrl = new URL("/x/player/pagelist", API_ORIGIN);
      pageListUrl.searchParams.set("bvid", bvid);
      pageListUrl.searchParams.set("jsonp", "jsonp");
      const result = await biliJson(pageListUrl, "pagelist");
      if (result.code !== 0 || !Array.isArray(result.data)) {
        throw new Error(`pagelist business error: ${result.message || result.code}`);
      }
      pageList = result.data;
    } catch (error) {
      metadataErrors.push(errorMessage(error));
    }
  }

  if (!view && !pageList) {
    throw new Error(`metadata failed; ${metadataErrors.join("; ")}`);
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

  const cid = Number(selectedPage.cid);
  const playErrors = [];

  let sourceUrl = null;
  let strategy = null;
  let bandwidth = null;

  const dashParams = {
    bvid,
    cid,
    qn: 80,
    fnver: 0,
    fnval: 16,
    fourk: 1,
  };

  try {
    const play = await wbiJson(
      "/x/player/playurl",
      dashParams,
      "signed-playurl-dash",
    );

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
      playErrors.push(
        `signed-playurl-dash no audio: ${play.message || play.code}`,
      );
    }
  } catch (error) {
    playErrors.push(errorMessage(error));
  }

  if (!sourceUrl) {
    try {
      const html5 = await wbiJson(
        "/x/player/playurl",
        {
          bvid,
          cid,
          qn: 64,
          fnver: 0,
          fnval: 1,
          platform: "html5",
          high_quality: 1,
        },
        "signed-playurl-html5",
      );

      sourceUrl =
        html5.code === 0 ? html5.data?.durl?.[0]?.url ?? null : null;

      if (sourceUrl) {
        strategy = "durl-mp4";
      } else {
        playErrors.push(
          `signed-playurl-html5 no durl: ${html5.message || html5.code}`,
        );
      }
    } catch (error) {
      playErrors.push(errorMessage(error));
    }
  }

  if (!sourceUrl || !strategy) {
    throw new Error(`playurl failed; ${playErrors.join("; ")}`);
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
    cid,
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
    metadataStrategy: view ? "wbi-or-legacy-view" : "pagelist",
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

async function wbiJson(path, params, label) {
  const signedUrl = await buildWbiUrl(path, params);
  return biliJson(signedUrl, label, true);
}

async function buildWbiUrl(path, params) {
  const { mixinKey } = await getWbiKey();
  const signed = { ...params, wts: Math.floor(Date.now() / 1000) };

  const query = Object.entries(signed)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const cleanValue = String(value).replace(/[!'()*]/g, "");
      return `${encodeURIComponent(key)}=${encodeURIComponent(cleanValue)}`;
    })
    .join("&");

  const wRid = md5(query + mixinKey);
  const url = new URL(path, API_ORIGIN);
  url.search = `${query}&w_rid=${wRid}`;
  return url;
}

async function getWbiKey() {
  if (cachedWbi && cachedWbi.expiresAt > Date.now()) {
    return cachedWbi;
  }

  const navUrl = new URL("/x/web-interface/nav", API_ORIGIN);
  const nav = await biliJson(navUrl, "wbi-nav", true);
  const imgUrl = nav?.data?.wbi_img?.img_url;
  const subUrl = nav?.data?.wbi_img?.sub_url;

  if (typeof imgUrl !== "string" || typeof subUrl !== "string") {
    throw new Error("wbi-nav missing wbi_img");
  }

  const imgKey = extractWbiFileKey(imgUrl);
  const subKey = extractWbiFileKey(subUrl);
  const original = imgKey + subKey;
  const mixinKey = WBI_MIXIN_TABLE
    .map((index) => original[index] || "")
    .join("")
    .slice(0, 32);

  if (mixinKey.length !== 32) {
    throw new Error("wbi-nav produced invalid mixin key");
  }

  cachedWbi = {
    mixinKey,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };

  return cachedWbi;
}

function extractWbiFileKey(value) {
  const url = new URL(value);
  const filename = url.pathname.split("/").pop() || "";
  return filename.replace(/\.[^.]+$/, "");
}

async function biliJson(url, label = "api", preferBrowser = false) {
  const profiles = preferBrowser
    ? [
        {
          "User-Agent": CDN_UA,
          Referer: BILI_REFERER,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Sec-Fetch-Site": "same-site",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
        },
        {
          "User-Agent": API_UA,
          Accept: "application/json",
        },
      ]
    : [
        {
          "User-Agent": API_UA,
          Accept: "application/json, text/plain, */*",
        },
        {
          "User-Agent": CDN_UA,
          Referer: BILI_REFERER,
          Accept: "application/json, text/plain, */*",
        },
      ];

  const errors = [];

  for (const headers of profiles) {
    const response = await fetch(url, {
      headers,
      redirect: "follow",
    });

    if (!response.ok) {
      errors.push(`${label} HTTP ${response.status}`);
      if (response.status === 412) continue;
      throw new Error(errors[errors.length - 1]);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      errors.push(`${label} non-JSON`);
      continue;
    }

    return response.json();
  }

  throw new Error(errors.join(" / "));
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

// Small self-contained MD5 implementation for WBI signing.
function md5(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(
    paddedLength - 4,
    Math.floor(bitLength / 0x100000000),
    true,
  );

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const constants = Array.from({ length: 64 }, (_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0,
  );

  for (let offset = 0; offset < buffer.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, i) =>
      view.getUint32(offset + i * 4, true),
    );

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;

      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const next = d;
      d = c;
      c = b;

      const sum =
        (a + f + constants[i] + words[g]) >>> 0;
      b = (b + leftRotate(sum, shifts[i])) >>> 0;
      a = next;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0]
    .map((value) =>
      [0, 8, 16, 24]
        .map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, "0"))
        .join(""),
    )
    .join("");
}

function leftRotate(value, amount) {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}
