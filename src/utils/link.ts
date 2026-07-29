/**
 * 音乐分享链接解析
 *
 * 参考 dawn-lc fork 的 link.ts，扩展支持网易云 / QQ音乐 / 酷狗 / Bilibili 等主流平台。
 *
 * 支持两种 URL 形态（以网易云为例）：
 * - PC 端：https://music.163.com/#/song?id=123456
 * - 移动端分享：https://music.163.com/song/123456/?userid=xxx
 *
 * 各平台 typeMap：
 * - song / album / artist / playlist
 */

import type { TrackSource } from "@shared/types/player";

/** 资源类型 */
export type LinkType = "song" | "album" | "artist" | "playlist";

/** 解析结果 */
export interface ParsedLink {
  /** 资源类型 */
  type: LinkType;
  /** 资源 ID */
  id: string;
  /** 来源平台 */
  source: TrackSource;
}

/** 各平台链接匹配规则 */
interface LinkRule {
  source: TrackSource;
  /** 匹配正则 */
  pattern: RegExp;
  /** URL 中类型字符串 → LinkType 映射 */
  typeMap: Record<string, LinkType>;
}

/**
 * 规则表
 *
 * 注意：网易云的 URL 形态最复杂（PC 端带 #/ 前缀，移动端用 /song/id/ 路径）；
 * 其他平台只支持标准 /xxx?id= 形态。
 */
const RULES: LinkRule[] = [
  {
    source: "netease",
    // 匹配两种格式：
    // 1. /song?id=123456 （PC 端，含 /#/ 前缀）
    // 2. /song/123456/?userid=xxx （移动端分享）
    // match[1] = 资源类型，match[2] = 查询 id，match[3] = 路径 id
    pattern:
      /music\.163\.com(?:\/#)?\/(song|album|artist|playlist)(?:\?(?:.*&)?id=(\d+)|\/(\d+)(?:\/|\?))/,
    typeMap: { song: "song", album: "album", artist: "artist", playlist: "playlist" },
  },
  {
    source: "qqmusic",
    // PC 端：https://y.qq.com/n/ryqq/songDetail/001qvvgF38HVc4
    // 移动端：https://i.y.qq.com/v8/playsong.html?songmid=001qvvgF38HVc4
    // match[1] = 路径 mid，match[2] = songmid 查询参数
    pattern:
      /y\.qq\.com\/(?:n\/ryqq\/(?:songDetail|albumDetail|singerDetail|playsquare)\/([^/?#]+)|.*[?&]songmid=([^&#]+))/,
    typeMap: { songDetail: "song", albumDetail: "album", singerDetail: "artist", playsquare: "playlist" },
  },
  {
    source: "kugou",
    // https://www.kugou.com/song/#hash=xxx 或 https://www.kugou.com/album/id/xxx
    // match[1] = song hash，match[2] = album id，match[3] = singer id，match[4] = special id
    pattern:
      /kugou\.com\/(?:song.*[?&]hash=([^&#]+)|album\/(?:id\/)?(\w+)|singer\/(?:id\/)?(\w+)|special\/single\/(\w+))/,
    typeMap: { song: "song", album: "album", singer: "artist", special: "playlist" },
  },
  {
    source: "bilibili",
    // https://www.bilibili.com/video/BV1xx411c7mD 或 https://b23.tv/xxxxx
    // B 站一个视频即一个可播放单元，统一识别为 song
    // match[1] = BV 号，match[2] = b23.tv 短链 id
    pattern: /(?:bilibili\.com\/video\/(BV[\w]+)|b23\.tv\/([\w]+))/,
    typeMap: { video: "song" },
  },
];

/**
 * 解析音乐分享链接
 *
 * @param input 用户输入的文本（可能含多行，自动提取首个匹配）
 * @returns 解析结果，非链接 / 不支持平台返回 null
 */
export const parseShareLink = (input: string): ParsedLink | null => {
  if (!input) return null;
  const trimmed = input.trim();

  for (const rule of RULES) {
    const match = trimmed.match(rule.pattern);
    if (!match) continue;

    // 网易云规则：match[1] = 类型，match[2] = 查询 id，match[3] = 路径 id
    if (rule.source === "netease") {
      const type = rule.typeMap[match[1]];
      if (!type) continue;
      const id = match[2] || match[3];
      if (!id) continue;
      return { type, id, source: rule.source };
    }

    // QQ音乐规则：match[1] = 路径中的 mid，match[2] = songmid 查询参数
    if (rule.source === "qqmusic") {
      const id = match[1] || match[2];
      if (!id) continue;
      // QQ 音乐路径段直接含类型字符串，需要从 URL 中提取
      let type: LinkType = "song";
      if (/albumDetail/.test(trimmed)) type = "album";
      else if (/singerDetail/.test(trimmed)) type = "artist";
      else if (/playsquare/.test(trimmed)) type = "playlist";
      return { type, id, source: rule.source };
    }

    // 酷狗规则：match[1..4] 按顺序对应 song/album/singer/special
    if (rule.source === "kugou") {
      const candidates: Array<{ id: string; typeKey: string }> = [
        { id: match[1], typeKey: "song" },
        { id: match[2], typeKey: "album" },
        { id: match[3], typeKey: "singer" },
        { id: match[4], typeKey: "special" },
      ];
      const hit = candidates.find((c) => c.id);
      if (!hit) continue;
      const type = rule.typeMap[hit.typeKey];
      if (!type) continue;
      return { type, id: hit.id, source: rule.source };
    }

    // Bilibili 规则：match[1] = BV 号，match[2] = b23.tv 短链 id
    if (rule.source === "bilibili") {
      const id = match[1] || match[2];
      if (!id) continue;
      return { type: "song", id, source: rule.source };
    }
  }

  return null;
};

/**
 * 兼容 dawn-lc fork 的别名
 *
 * 旧 API 名 `parseMusicLink` 保留，与 `parseShareLink` 行为完全一致。
 */
export const parseMusicLink = parseShareLink;

export default parseShareLink;
