/**
 * 汽水音乐 API（插件源）
 *
 * 汽水音乐走字节系签名加密，无法原生接入，必须依赖第三方插件。
 * 这里只提供插件存在性探测 + URL 解析转发，不直接实现网络调用。
 */

import type { Track } from "@shared/types/player";
import type { QualityLevel } from "@/utils/quality";
import { usePluginsStore } from "@/stores/plugins";

/** 汽水音乐在插件 SourceCapability 中的 source key 约定 */
export const QISHUI_PLUGIN_SOURCE_KEY = "qishui";

/**
 * 检查汽水音乐插件是否已安装并就绪
 * @returns true 表示至少一个已启用插件声明了 qishui 源的 musicUrl 动作
 */
export const isQishuiAvailable = (): boolean => {
  const plugins = usePluginsStore();
  return plugins.list.some(
    (info) =>
      info.enabled &&
      info.status.state === "ready" &&
      info.status.sources[QISHUI_PLUGIN_SOURCE_KEY]?.actions.includes("musicUrl"),
  );
};

/**
 * 通过插件解析汽水音乐 Track 的可播放 URL
 *
 * @param track - 要解析的 track；track.id 为汽水音乐歌曲 id
 * @param quality - 音质档位（默认 hq）
 * @returns 解析到的 URL；插件不可用或解析失败时返回 null
 */
export const resolveQishuiTrack = async (
  track: Track,
  quality: QualityLevel = "hq",
): Promise<string | null> => {
  if (!isQishuiAvailable()) return null;
  const plugins = usePluginsStore();
  const candidates = plugins.list.filter(
    (info) =>
      info.enabled &&
      info.status.state === "ready" &&
      info.status.sources[QISHUI_PLUGIN_SOURCE_KEY]?.actions.includes("musicUrl"),
  );
  const totalSec = track.duration > 0 ? Math.round(track.duration / 1000) : 0;
  const interval =
    totalSec > 0
      ? `${Math.floor(totalSec / 60)
          .toString()
          .padStart(2, "0")}:${(totalSec % 60).toString().padStart(2, "0")}`
      : null;
  const singer = track.artists.map((artist) => artist.name).join("/");
  const musicInfo = {
    id: track.id,
    songmid: track.id,
    songId: track.id,
    name: track.title,
    singer,
    source: QISHUI_PLUGIN_SOURCE_KEY,
    interval,
    meta: {
      songId: track.id,
      albumName: track.album?.name ?? "",
      albumId: track.album?.id,
      picUrl: track.cover ?? null,
    },
  };
  for (const plugin of candidates) {
    try {
      const res = await window.api.plugins.resolveUrl({
        pluginId: plugin.manifest.id,
        source: QISHUI_PLUGIN_SOURCE_KEY,
        quality,
        musicInfo,
      });
      if (res?.url) return res.url;
    } catch (err) {
      console.warn("[qishui] resolveUrl failed", plugin.manifest.id, err);
    }
  }
  return null;
};
