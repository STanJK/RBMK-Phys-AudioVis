export interface BilibiliPreset {
  label: string;
  bvid: string;
  page?: number;
}

export const BILIBILI_PRESETS: BilibiliPreset[] = [
  {
    label: "邦友の酒",
    bvid: "BV1VGYR6bECg",
  },
  {
    label: "aLIEz",
    bvid: "BV1Ax411J7YE",
  },
];

export function presetInput(preset: BilibiliPreset): string {
  const page = preset.page && preset.page > 1 ? `?p=${preset.page}` : "";
  return `https://www.bilibili.com/video/${preset.bvid}/${page}`;
}
