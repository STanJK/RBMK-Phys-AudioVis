export interface BilibiliVideoRef {
  bvid: string;
  page: number;
}

export function parseBilibiliInput(input: string): BilibiliVideoRef {
  const value = input.trim();

  if (!value) {
    throw new Error("请输入 B 站视频链接或 BV 号");
  }

  if (/b23\.tv/i.test(value)) {
    throw new Error(
      "b23.tv 短链暂不直接解析；请先打开短链，再复制完整 bilibili.com 视频地址",
    );
  }

  const bvid = value.match(/BV[0-9A-Za-z]{10}/)?.[0];
  if (!bvid) {
    throw new Error("没有找到有效的 BV 号；BV 号区分大小写");
  }

  let page = 1;

  try {
    const url = new URL(value);
    const p = Number(url.searchParams.get("p") ?? url.searchParams.get("page"));
    if (Number.isInteger(p) && p > 0) page = p;
  } catch {
    const p = Number(value.match(/[?&](?:p|page)=(\d+)/i)?.[1]);
    if (Number.isInteger(p) && p > 0) page = p;
  }

  return { bvid, page };
}
