/**
 * 渲染端歌词解析兜底链
 *
 * 优先级：本地内嵌 → 本地 .lrc/.ttml 外挂 → 流媒体服务器 → 在线平台 → 插件源 (musicLyric)
 *
 * 与 src/services/lyricLoader.ts 的区别：
 * - lyricLoader 是带 token 竞态 + 偏好打分的复杂状态机，直接对接 useMediaStore
 * - lyricResolve 是无状态的解析链，仅返回 ResolvedLyric，由调用方决定如何 commit
 *
 * 注：本模块仅使用 type-only import 与 window 全局访问，避免在 tsx 测试环境
 * 中触发 @shared/* / @/* 别名解析（与 src/services/coverLoader.ts 一致）。
 */

import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricLine, LyricFormat } from "@shared/types/lyrics";

export interface LyricInput {
  title: string;
  artist: string;
  album?: string;
  duration: number;
  trackId: string;
  source: string;
}

export interface OnlineResult {
  format: LyricFormat;
  text: string;
  lines?: LyricLine[];
  translation?: string;
  transliteration?: string;
}

export interface LocalLyric {
  format: LyricFormat;
  path: string;
}

export interface ResolvedLyric {
  source: "embedded" | "localFile" | "streaming" | "online" | "plugin" | "none";
  result?: OnlineResult;
  localFile?: LocalLyric;
}

export const toLyricInput = (track: Track): LyricInput => ({
  title: track.title,
  artist: track.artists.map((a) => a.name).join(" "),
  album: track.album?.name,
  duration: track.duration,
  trackId: track.id,
  source: track.source,
});

export const embeddedLyricFromDetail = (
  detail: TrackDetail | undefined,
): ResolvedLyric | null => {
  if (!detail?.embeddedLyric) return null;
  return {
    source: "embedded",
    result: { format: "lrc", text: detail.embeddedLyric },
  };
};

export const resolvePluginLyric = async (
  input: LyricInput,
): Promise<ResolvedLyric | null> => {
  try {
    const plugins =
      (await window.api?.plugins?.getPluginsWithAction?.("musicLyric")) ?? [];
    for (const plugin of plugins) {
      try {
        const result = (await window.api?.plugins?.callAction?.(
          plugin.manifest.id,
          "musicLyric",
          input,
        )) as
          | {
              text?: string;
              format?: LyricFormat;
              lines?: LyricLine[];
              translation?: string;
              transliteration?: string;
            }
          | undefined;
        if (result?.text) {
          return {
            source: "plugin",
            result: {
              format: result.format ?? "lrc",
              text: result.text,
              lines: result.lines,
              translation: result.translation,
              transliteration: result.transliteration,
            },
          };
        }
      } catch {
        // 继续下一个插件
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const shouldTryTTML = (track: Track): boolean => {
  return (
    (track.quality?.bitsPerSample ?? 0) >= 24 ||
    (track.quality?.sampleRate ?? 0) >= 96_000
  );
};

export const resolveTTMLOverlay = async (
  track: Track,
): Promise<OnlineResult | null> => {
  // fetchTTMLOverlay 仅支持 netease / qqmusic
  if (track.source !== "netease" && track.source !== "qqmusic") return null;
  try {
    const res = await window.api?.lyrics?.fetchTTMLOverlay?.(track, track.source);
    if (res?.ok && res.data) {
      return { format: "ttml", text: res.data };
    }
    return null;
  } catch {
    return null;
  }
};

export const resolveLocalRepoLyric = async (
  track: Track,
): Promise<OnlineResult | null> => {
  try {
    const res = await window.api?.lyrics?.matchLocalTTML?.(track);
    if (res?.ok && res.data) {
      return { format: "ttml", text: res.data };
    }
    return null;
  } catch {
    return null;
  }
};

export const resolveStreamingServerLyric = async (
  _track: Track,
): Promise<OnlineResult | null> => {
  // StreamingApi.getLyric 尚未实现，先返回 null
  return null;
};

export const fetchFromPlatform = async (
  _input: LyricInput,
  _preferTtml: boolean,
): Promise<OnlineResult | null> => {
  // lyrics.fetchOnline 尚未实现，先返回 null
  return null;
};

/** 按优先级串行尝试 */
export const resolveOnlineByPreference = async (
  track: Track,
  detail?: TrackDetail,
): Promise<ResolvedLyric> => {
  const input = toLyricInput(track);

  const embedded = embeddedLyricFromDetail(detail);
  if (embedded) return embedded;

  const localTtml = await resolveLocalRepoLyric(track);
  if (localTtml) return { source: "localFile", result: localTtml };

  if (track.source === "streaming") {
    const streaming = await resolveStreamingServerLyric(track);
    if (streaming) return { source: "streaming", result: streaming };
  }

  const preferTtml = shouldTryTTML(track);
  if (preferTtml) {
    const ttml = await resolveTTMLOverlay(track);
    if (ttml) return { source: "online", result: ttml };
  }
  const online = await fetchFromPlatform(input, preferTtml);
  if (online) return { source: "online", result: online };

  const plugin = await resolvePluginLyric(input);
  if (plugin) return plugin;

  return { source: "none" };
};
