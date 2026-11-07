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
    label: "朋友的酒 DJ / 源音频",
    bvid: "BV1hXbN6VEKV",
    note: "邦友系列常用源音频",
  },
  {
    label: "舟友的酒",
    bvid: "BV12hHr6UEqc",
    note: "高密度节拍 / 强响应",
  },
  {
    label: "Bad Apple!! / 高级弹幕",
    bvid: "BV1ZxtSzdEPn",
    note: "稳定节拍 / 频谱覆盖广",
  },
];

export function presetInput(preset: BilibiliPreset): string {
  const page = preset.page && preset.page > 1 ? `?p=${preset.page}` : "";
  return `https://www.bilibili.com/video/${preset.bvid}/${page}`;
}
