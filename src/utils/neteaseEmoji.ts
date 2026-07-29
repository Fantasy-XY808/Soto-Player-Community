/**
 * 网易云音乐评论表情包解析
 *
 * 网易云评论接口返回的 content 中，表情以 `[呲牙]` 这类方括号文本形式存在。
 * 这里维护一份常用表情 → Unicode emoji 的字典，把文本替换为 Unicode emoji；
 * 未识别的 `[xxx]` 原样保留，避免误吞用户内容。
 *
 * 仅覆盖常用表情；网易云表情集较大，生僻表情会以原始 `[xxx]` 文本展示。
 */

/** 表情片段类型 */
export interface EmojiSegment {
  /** 文本片段 / 表情片段 */
  type: "text" | "emoji";
  /** 文本内容 / Unicode emoji */
  value: string;
  /** 表情原始标记（如 `[呲牙]`），仅 emoji 段携带 */
  alt?: string;
}

/** 网易云表情 → Unicode emoji 字典（常用表情） */
const NETEASE_EMOJI_MAP: Record<string, string> = {
  "[呲牙]": "😁",
  "[大笑]": "😄",
  "[憨笑]": "😅",
  "[偷笑]": "😊",
  "[可爱]": "☺️",
  "[微笑]": "🙂",
  "[幸灾乐祸]": "😆",
  "[鬼脸]": "👻",
  "[吐]": "🤮",
  "[捂脸]": "🤦",
  "[奸笑]": "😏",
  "[机智]": "🤓",
  "[叹气]": "😮‍💨",
  "[嘿哈]": "😃",
  "[捂眼]": "🙈",
  "[尴尬]": "😬",
  "[哭笑不得]": "😂",
  "[哭]": "😭",
  "[流泪]": "😢",
  "[流汗]": "💦",
  "[发呆]": "😮",
  "[愤怒]": "😠",
  "[抓狂]": "😡",
  "[奋斗]": "💪",
  "[加油]": "💪",
  "[拳头]": "👊",
  "[鼓掌]": "👏",
  "[强]": "👍",
  "[弱]": "👎",
  "[OK]": "👌",
  "[合十]": "🙏",
  "[玫瑰]": "🌹",
  "[凋谢]": "🥀",
  "[爱心]": "❤️",
  "[心碎]": "💔",
  "[爱情]": "💕",
  "[飞吻]": "😘",
  "[示爱]": "🥰",
  "[抱拳]": "🙇",
  "[勾引]": "😘",
  "[握手]": "🤝",
  "[拥抱]": "🤗",
  "[跳舞]": "💃",
  "[唱歌]": "🎤",
  "[啤酒]": "🍺",
  "[咖啡]": "☕",
  "[蛋糕]": "🎂",
  "[礼物]": "🎁",
  "[红包]": "🧧",
  "[发财]": "💰",
  "[元宝]": "🪙",
  "[炸弹]": "💣",
  "[庆祝]": "🎉",
  "[烟花]": "🎆",
  "[爆竹]": "🧨",
  "[灯笼]": "🏮",
  "[彩带]": "🎊",
  "[气球]": "🎈",
  "[太阳]": "☀️",
  "[月亮]": "🌙",
  "[星星]": "⭐",
  "[流星]": "☄️",
  "[彩虹]": "🌈",
  "[云]": "☁️",
  "[雪花]": "❄️",
  "[火焰]": "🔥",
  "[闪电]": "⚡",
  "[风]": "💨",
  "[雨]": "🌧️",
  "[水]": "💧",
  "[冰]": "🧊",
  "[地球]": "🌍",
  "[音乐]": "🎵",
  "[耳机]": "🎧",
  "[吉他]": "🎸",
  "[钢琴]": "🎹",
  "[电影]": "🎬",
  "[相机]": "📷",
  "[电话]": "📞",
  "[手机]": "📱",
  "[电脑]": "💻",
  "[电视]": "📺",
  "[收音机]": "📻",
  "[书]": "📖",
  "[笔]": "✏️",
  "[钟]": "🕐",
  "[沙漏]": "⏳",
  "[钥匙]": "🔑",
  "[锁]": "🔒",
  "[钉子]": "📌",
  "[旗帜]": "🚩",
};

/** 匹配 `[xxx]` 形式的表情标记 */
const EMOJI_REGEX = /(\[[^\]]+\])/g;

/**
 * 把网易云评论文本解析为文本/表情片段数组
 *
 * - 命中字典的 `[xxx]` → emoji 片段
 * - 未命中的 `[xxx]` → 文本片段（原样保留）
 * - 其余连续文本 → 文本片段
 *
 * @param text 原始评论内容
 * @returns 片段数组，可直接 v-for 渲染
 */
export const renderNeteaseEmoji = (text: string): EmojiSegment[] => {
  if (!text) return [];
  const result: EmojiSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  EMOJI_REGEX.lastIndex = 0;
  while ((match = EMOJI_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const emoji = NETEASE_EMOJI_MAP[match[0]];
    if (emoji) {
      result.push({ type: "emoji", value: emoji, alt: match[0] });
    } else {
      result.push({ type: "text", value: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    result.push({ type: "text", value: text.slice(lastIndex) });
  }
  return result;
};
