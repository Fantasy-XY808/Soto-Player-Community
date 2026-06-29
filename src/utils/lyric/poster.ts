import type { Track } from "@shared/types/player";
import { hexToRgb } from "@/utils/color";
import { extractPalette, getDominantColor, type RGB } from "@/utils/palette";

/** 海报中的一行歌词 */
export interface LyricPosterLine {
  text: string;
  /** 翻译 */
  translation?: string;
  /** 音译 */
  romaji?: string;
  /** 对唱行 */
  duet?: boolean;
}

/** 卡片样式 */
export type LyricCardStyle = "classic" | "compact" | "poster" | "minimal";

export interface LyricPosterOptions {
  track: Track;
  lines: LyricPosterLine[];
  /** 无封面时的背景色 HEX，可空 */
  fallbackColor?: string | null;
  /** 卡片样式，默认 classic */
  style?: LyricCardStyle;
}

const SCALE = 3;
const MAX_CANVAS_PX = 16000;
const WIDTH = 720;
const PAD_X = 56;
const PAD_TOP = 64;
const PAD_BOTTOM = 30;

const FONT_STACK = '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const LYRIC_FONT = `bold 34px ${FONT_STACK}`;
const TRANS_FONT = `24px ${FONT_STACK}`;
const ROMAJI_FONT = `italic 22px ${FONT_STACK}`;
const TITLE_FONT = `bold 28px ${FONT_STACK}`;
const ARTIST_FONT = `22px ${FONT_STACK}`;
const ALBUM_FONT = `18px ${FONT_STACK}`;
const MARK_FONT = `600 15px ${FONT_STACK}`;
const DATE_FONT = `500 16px ${FONT_STACK}`;

const LYRIC_LH = 48;
const TRANS_LH = 34;
const ROMAJI_LH = 32;
const SUBLINE_GAP = 8;
const BLOCK_GAP = 30;
const HEADER_GAP = 44;
const WATERMARK_GAP = 26;
const WATERMARK_H = 16;

/** 内容区宽度 */
const CONTENT_WIDTH = WIDTH - PAD_X * 2;

/** 样式专属参数 */
interface StyleConfig {
  /** 顶部封面尺寸（poster 模式为大封面，其他为缩略图） */
  thumbSize: number;
  /** 封面圆角 */
  thumbRadius: number;
  /** 标题字体 */
  titleFont: string;
  /** 艺人字体 */
  artistFont: string;
  /** 歌词字体 */
  lyricFont: string;
  /** 翻译字体 */
  transFont: string;
  /** 音译字体 */
  romajiFont: string;
  /** 行高 */
  lyricLh: number;
  transLh: number;
  romajiLh: number;
  /** 内容宽度 */
  contentWidth: number;
  /** 顶部留白 */
  padTop: number;
  /** 水印间距 */
  watermarkGap: number;
}

/** 各样式参数 */
const STYLE_CONFIGS: Record<LyricCardStyle, StyleConfig> = {
  classic: {
    thumbSize: 72,
    thumbRadius: 16,
    titleFont: TITLE_FONT,
    artistFont: ARTIST_FONT,
    lyricFont: LYRIC_FONT,
    transFont: TRANS_FONT,
    romajiFont: ROMAJI_FONT,
    lyricLh: LYRIC_LH,
    transLh: TRANS_LH,
    romajiLh: ROMAJI_LH,
    contentWidth: CONTENT_WIDTH,
    padTop: PAD_TOP,
    watermarkGap: WATERMARK_GAP,
  },
  compact: {
    thumbSize: 56,
    thumbRadius: 12,
    titleFont: `bold 24px ${FONT_STACK}`,
    artistFont: `18px ${FONT_STACK}`,
    lyricFont: `bold 28px ${FONT_STACK}`,
    transFont: `20px ${FONT_STACK}`,
    romajiFont: `italic 18px ${FONT_STACK}`,
    lyricLh: 40,
    transLh: 28,
    romajiLh: 26,
    contentWidth: CONTENT_WIDTH,
    padTop: 48,
    watermarkGap: 20,
  },
  poster: {
    thumbSize: 200,
    thumbRadius: 24,
    titleFont: `bold 36px ${FONT_STACK}`,
    artistFont: `26px ${FONT_STACK}`,
    lyricFont: `bold 30px ${FONT_STACK}`,
    transFont: `22px ${FONT_STACK}`,
    romajiFont: `italic 20px ${FONT_STACK}`,
    lyricLh: 44,
    transLh: 32,
    romajiLh: 30,
    contentWidth: CONTENT_WIDTH,
    padTop: 80,
    watermarkGap: 30,
  },
  minimal: {
    thumbSize: 0,
    thumbRadius: 0,
    titleFont: `bold 26px ${FONT_STACK}`,
    artistFont: `20px ${FONT_STACK}`,
    lyricFont: `300 32px ${FONT_STACK}`,
    transFont: `22px ${FONT_STACK}`,
    romajiFont: `italic 20px ${FONT_STACK}`,
    lyricLh: 46,
    transLh: 32,
    romajiLh: 30,
    contentWidth: CONTENT_WIDTH,
    padTop: 56,
    watermarkGap: 24,
  },
};

/** 从 font 字符串提取 px 字号 */
const fontSizeFromFont = (font: string): number => {
  const m = font.match(/(\d+)px/);
  return m ? Number(m[1]) : 24;
};

/** Blob 转 dataURL */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** 把当前曲目封面解析为 dataURL */
const resolveCoverDataUrl = async (track: Track): Promise<string | null> => {
  // 本地：主进程返回解码后的原图 dataURL
  if (track.source === "local") {
    const res = await window.api.player.getCoverRaw();
    return res.success && res.data ? res.data : null;
  }
  // 远程：主进程拉字节回渲染层
  const url = track.coverOriginal || track.cover;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await window.api.system.fetchRemoteBytes(url);
    if (!res.success || !res.data) return null;
    return await blobToDataUrl(new Blob([new Uint8Array(res.data)]));
  } catch {
    return null;
  }
};

/** 从封面图提取主色调（用于渐变背景） */
const extractCoverPalette = async (
  coverImg: HTMLImageElement | null,
): Promise<{ dominant: RGB; palette: RGB[] } | null> => {
  if (!coverImg) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(coverImg, 0, 0, 64, 64);
    const imageData = ctx.getImageData(0, 0, 64, 64);
    const palette = extractPalette(imageData, 4);
    const dominant = getDominantColor(palette);
    return { dominant, palette };
  } catch {
    return null;
  }
};

/** 按宽度折行，英文按词、CJK 按字回退 */
const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  if (!text) return [];
  const lines: string[] = [];
  let line = "";
  const breakByChar = (token: string): void => {
    for (const char of token) {
      if (line && ctx.measureText(line + char).width > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  };
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    if (ctx.measureText(line + word).width <= maxWidth) {
      line += word;
    } else if (ctx.measureText(word).width > maxWidth) {
      breakByChar(word);
    } else {
      if (line.trim()) lines.push(line.replace(/\s+$/, ""));
      line = word.replace(/^\s+/, "");
    }
  }
  if (line.trim()) lines.push(line.replace(/\s+$/, ""));
  return lines;
};

/** 加载图片，失败回 null */
const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** object-fit: cover 方式绘制图片 */
const drawCovered = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void => {
  const imgRatio = img.width / img.height;
  const boxRatio = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (imgRatio > boxRatio) {
    sw = img.height * boxRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / boxRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
};

/** RGB 转 CSS */
const rgbToCss = ({ r, g, b }: RGB, alpha = 1): string =>
  alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;

/** 颜色亮度调整：factor<1 变暗，>1 变亮 */
const adjustBrightness = ({ r, g, b }: RGB, factor: number): RGB => ({
  r: Math.max(0, Math.min(255, Math.round(r * factor))),
  g: Math.max(0, Math.min(255, Math.round(g * factor))),
  b: Math.max(0, Math.min(255, Math.round(b * factor))),
});

/** 绘制渐变背景：封面主色三段渐变 */
const drawGradientBackground = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dominant: RGB,
  hasCover: boolean,
  fallbackHex: string | null | undefined,
): void => {
  if (hasCover) {
    const top = dominant;
    const mid = adjustBrightness(dominant, 0.5);
    const bottom = adjustBrightness(dominant, 0.2);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, rgbToCss(top, 0.85));
    gradient.addColorStop(0.55, rgbToCss(mid, 0.92));
    gradient.addColorStop(1, rgbToCss(bottom, 0.96));
    ctx.fillStyle = gradient;
  } else {
    const baseRgbStr = hexToRgb(fallbackHex || "#14141c");
    ctx.fillStyle = `rgb(${baseRgbStr})`;
  }
  ctx.fillRect(0, 0, width, height);
};

/** 绘制顶部封面 + 标题 + 艺人 + 专辑，返回头部高度 */
const drawHeader = (
  ctx: CanvasRenderingContext2D,
  cfg: StyleConfig,
  coverImg: HTMLImageElement | null,
  track: Track,
  padTop: number,
  padX: number,
): number => {
  const title = track.title;
  const artist = track.artists.map((item) => item.name).join(" / ");
  const album = track.album?.name;
  const thumb = cfg.thumbSize;
  const titleSize = fontSizeFromFont(cfg.titleFont);
  const artistSize = fontSizeFromFont(cfg.artistFont);

  ctx.textBaseline = "top";
  let titleX = padX;

  if (coverImg && thumb > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(padX, padTop, thumb, thumb, cfg.thumbRadius);
    ctx.clip();
    drawCovered(ctx, coverImg, padX, padTop, thumb, thumb);
    ctx.restore();
    titleX = padX + thumb + 18;
  }

  const titleY = coverImg && thumb > 0 ? padTop + (thumb - titleSize) / 2 : padTop;

  // 标题
  ctx.fillStyle = "#ffffff";
  ctx.font = cfg.titleFont;
  ctx.fillText(title, titleX, titleY);

  // 艺人
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.font = cfg.artistFont;
  ctx.fillText(artist, titleX, titleY + titleSize + 6);

  // 专辑（如果有）
  if (album) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = ALBUM_FONT;
    ctx.fillText(album, titleX, titleY + titleSize + artistSize + 10);
  }

  // 头部总高度
  return thumb > 0 ? thumb : titleSize + artistSize + (album ? 36 : 20);
};

/**
 * 把选中歌词绘制成一张海报 PNG（自动解析当前封面）
 * @param options - 曲目、歌词行、无封面时的背景色、卡片样式
 * @returns PNG Blob
 */
export const createLyricPoster = async (options: LyricPosterOptions): Promise<Blob> => {
  const { track, lines, fallbackColor, style = "classic" } = options;
  const cfg = STYLE_CONFIGS[style];

  const coverDataUrl = await resolveCoverDataUrl(track);
  const coverImg = coverDataUrl ? await loadImage(coverDataUrl) : null;
  const palette = await extractCoverPalette(coverImg);
  const dominant = palette?.dominant ?? { r: 30, g: 30, b: 46 };

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  // 预折行并量算高度
  const layout = lines.map((line) => {
    ctx.font = cfg.lyricFont;
    const main = wrapText(ctx, line.text || " ", cfg.contentWidth);
    ctx.font = cfg.transFont;
    const translation = line.translation ? wrapText(ctx, line.translation, cfg.contentWidth) : [];
    ctx.font = cfg.romajiFont;
    const romaji = line.romaji ? wrapText(ctx, line.romaji, cfg.contentWidth) : [];
    return { main, translation, romaji, duet: !!line.duet };
  });

  let lyricsHeight = 0;
  layout.forEach((block, index) => {
    if (index > 0) lyricsHeight += BLOCK_GAP;
    lyricsHeight += Math.max(1, block.main.length) * cfg.lyricLh;
    if (block.translation.length)
      lyricsHeight += SUBLINE_GAP + block.translation.length * cfg.transLh;
    if (block.romaji.length) lyricsHeight += SUBLINE_GAP + block.romaji.length * cfg.romajiLh;
  });

  const titleSize = fontSizeFromFont(cfg.titleFont);
  const artistSize = fontSizeFromFont(cfg.artistFont);
  const headerHeight =
    cfg.thumbSize > 0 ? cfg.thumbSize : titleSize + artistSize + 30;
  const totalHeight =
    cfg.padTop + headerHeight + HEADER_GAP + lyricsHeight + cfg.watermarkGap + WATERMARK_H + PAD_BOTTOM;

  // 超长海报降采样，避免超出画布像素上限导致导出空白
  const scale = Math.min(SCALE, MAX_CANVAS_PX / totalHeight);
  canvas.width = WIDTH * scale;
  canvas.height = totalHeight * scale;
  ctx.scale(scale, scale);

  // 渐变背景：基于封面主色
  drawGradientBackground(ctx, WIDTH, totalHeight, dominant, !!coverImg, fallbackColor);

  // 封面模糊背景层（增加质感）
  if (coverImg) {
    const margin = style === "poster" ? 100 : 80;
    const blur = style === "poster" ? 80 : 70;
    ctx.filter = `blur(${blur}px) saturate(1.3)`;
    drawCovered(ctx, coverImg, -margin, -margin, WIDTH + margin * 2, totalHeight + margin * 2);
    ctx.filter = "none";
    ctx.fillStyle = style === "poster" ? "rgba(0, 0, 0, 0.55)" : "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, WIDTH, totalHeight);
  }

  // 顶部光晕（增加视觉层次）
  const haloGradient = ctx.createRadialGradient(WIDTH / 2, 0, 0, WIDTH / 2, 0, WIDTH * 0.7);
  haloGradient.addColorStop(0, rgbToCss(dominant, 0.25));
  haloGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = haloGradient;
  ctx.fillRect(0, 0, WIDTH, 300);

  // 顶部封面 + 标题 + 艺人 + 专辑
  const headerRealHeight = drawHeader(ctx, cfg, coverImg, track, cfg.padTop, PAD_X);

  // 歌词
  let y = cfg.padTop + headerRealHeight + HEADER_GAP;
  layout.forEach((block, index) => {
    if (index > 0) y += BLOCK_GAP;
    // 对唱行右对齐，其余左对齐
    const textX = block.duet ? WIDTH - PAD_X : PAD_X;
    ctx.textAlign = block.duet ? "right" : "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = cfg.lyricFont;
    for (const text of block.main) {
      ctx.fillText(text, textX, y);
      y += cfg.lyricLh;
    }
    if (block.translation.length) {
      y += SUBLINE_GAP;
      ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
      ctx.font = cfg.transFont;
      for (const text of block.translation) {
        ctx.fillText(text, textX, y);
        y += cfg.transLh;
      }
    }
    if (block.romaji.length) {
      y += SUBLINE_GAP;
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.font = cfg.romajiFont;
      for (const text of block.romaji) {
        ctx.fillText(text, textX, y);
        y += cfg.romajiLh;
      }
    }
  });

  // 底部日期 + 水印
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = DATE_FONT;
  ctx.textAlign = "left";
  ctx.fillText(dateStr, PAD_X, totalHeight - PAD_BOTTOM - WATERMARK_H - 4);

  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = MARK_FONT;
  ctx.textAlign = "center";
  ctx.fillText("Made by Soto-Player Community", WIDTH / 2, totalHeight - PAD_BOTTOM - WATERMARK_H);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("导出图片失败"))),
      "image/png",
    );
  });
};
