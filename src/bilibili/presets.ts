export interface BilibiliPreset {
  label: string;
  bvid: string;
  page?: number;
  note: string;
}

export const BILIBILI_PRESETS: BilibiliPreset[] = [
  {
    label: "邦友の酒",
    bvid: "BV1VGYR6bECg",
    note: "强节拍 / 当前事故模式基准",
  },
  {
    label: "BV1Ax411J7YE",
    bvid: "BV1Ax411J7YE",
    note: "验收测试",
  },
];

export function presetInput(preset: BilibiliPreset): string {
  const page = preset.page && preset.page > 1 ? `?p=${preset.page}` : "";
  return `https://www.bilibili.com/video/${preset.bvid}/${page}`;
}
