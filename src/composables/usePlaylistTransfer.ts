/**
 * 歌单导入/导出组合式 API
 *
 * 提供：
 * - exportPlaylistToFile：序列化 + 写盘（不弹格式选择，由 UI 端 PlaylistExportDialog 处理）
 * - importPlaylistFromFile：弹文件选择 → 解析 → 转回 Track 入库
 * - importPlaylistFromContent：从已有字符串内容直接导入（拖入文件场景）
 *
 * 解析后的 PlaylistExportTrack 仅含元数据，需要 resolveImportedTrack 还原为可播放的 Track
 */

import type { Track, TrackSource, Artist, Album } from "@shared/types/player";
import type { PlaylistImportResult } from "@/services/playlist-transfer";
import {
  parsePlaylist,
  serializePlaylist,
  isSupportedImportFile,
} from "@/services/playlist-transfer";
import { usePlaylistStore } from "@/stores/playlist";
import { toast } from "@/composables/useToast";
import { navigateToPlaylist } from "@/utils/navigate";

/**
 * 已知在线平台白名单
 *
 * 用于过滤导入端的 platform 字段：
 * - 在白名单内：作为 TrackSource 接受（播放走对应平台官方接口）
 * - 不在白名单内（如 musicfree / 未知字符串）：回退为 local 直链播放（用 source 作 path）
 */
const KNOWN_ONLINE_PLATFORMS: ReadonlySet<string> = new Set<string>([
  "netease",
  "qqmusic",
  "kugou",
  "qobuz",
  "tidal",
  "archive",
  "mora",
  "prostudiomasters",
  "2l",
  "bilibili",
]);

/**
 * 把导入的 PlaylistExportTrack 还原为可播放的 Track
 *
 * - 本地文件（platform === "local" 或无 platform 或 platform 不在已知在线平台白名单内）：
 *   构造 source="local" 的 Track，path=source，id=path
 * - 在线平台（platform 为白名单内值且 platformId 存在）：保留 platform/platformId 作为可重新解析的标识，
 *   但艺术家/专辑/封面仅用导入的元数据填充，后续播放时由 audioSource 重新拉流
 *
 * 注意：musicfree 平台因 mf 运行时上下文无法序列化，导入后无法直接播放；
 * 若 source 字段是 URL，则回退为 local 直链播放。
 *
 * @param item 导入的精简曲目数据
 */
const resolveImportedTrack = (item: import("@/services/playlist-transfer").PlaylistExportTrack): Track => {
  const platform = item.platform;
  const isKnownOnline = !!platform && KNOWN_ONLINE_PLATFORMS.has(platform);
  const isLocal = !platform || platform === "local" || !isKnownOnline;
  const artists: Artist[] = item.artist
    ? item.artist
        .split(/[\/,，、&]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name }))
    : [];
  const album: Album | undefined = item.album ? { name: item.album } : undefined;
  // 本地：id 用 path（兜底生成）；在线：id 用 platformId（兜底用 source）
  const id = isLocal
    ? item.source ?? `local:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    : item.platformId ?? item.source ?? `imported:${Date.now()}`;
  const trackSource: TrackSource = (isLocal ? "local" : platform) as TrackSource;
  const duration = typeof item.duration === "number" ? item.duration * 1000 : 0;
  const track: Track = {
    id,
    source: trackSource,
    title: item.title,
    artists,
    album,
    duration,
    cover: item.cover,
  };
  if (isLocal && item.source) {
    track.path = item.source;
  }
  return track;
};

/**
 * 拖入文件导入入口：判断是否为支持的歌单格式
 */
export const isPlaylistImportFile = (filename: string): boolean =>
  isSupportedImportFile(filename);

/**
 * 歌单导入导出组合式函数
 *
 * 必须在 setup 中调用；返回的函数可异步调用
 */
export const usePlaylistTransfer = () => {
  const { t } = useI18n();

  /**
   * 直接序列化并写盘（不弹格式选择对话框）
   *
   * @returns true 表示成功写入文件
   */
  const exportPlaylistToFile = async (
    name: string,
    tracks: Track[],
    format: import("@/services/playlist-transfer").PlaylistExportFormat,
    description?: string,
  ): Promise<boolean> => {
    if (tracks.length === 0) {
      toast.warning(t("playlistTransfer.empty"));
      return false;
    }
    const content = serializePlaylist(name, tracks, format, description);
    const result = await window.api.playlist.export(name, content, format);
    if (result.success) {
      toast.success(t("playlistTransfer.exportSuccess"));
      return true;
    }
    if (result.reason === "canceled") return false;
    toast.error(t("playlistTransfer.exportFailed"));
    return false;
  };

  /**
   * 把已解析的导入结果应用到本地歌单
   *
   * 默认行为：新建本地歌单并把所有解析成功的曲目添加进去
   *
   * 流程：
   * 1. resolveImportedTrack 把 PlaylistExportTrack 还原为 Track[]
   * 2. 调 library.upsertTracks 把 Track[] 写入音乐库（修正 id 为 sha256(path) 或保留 platformId）
   * 3. 用修正后的 Track[] 调 playlistStore.addTracks，让歌单能查到这些曲目
   *
   * @param result 解析结果
   * @param fallbackName 默认歌单名（取自文件名或 meta.name）
   * @param onCreated 可选回调：创建成功后回调新歌单 id（用于跳转）
   */
  const applyImportResult = async (
    result: PlaylistImportResult,
    fallbackName: string,
    onCreated?: (playlistId: string) => void,
  ): Promise<boolean> => {
    if (!result.success || result.tracks.length === 0) {
      const errMsg =
        result.errors.length > 0 ? result.errors[0] : t("playlistTransfer.parseFailed");
      toast.error(errMsg);
      return false;
    }
    const playlistStore = usePlaylistStore();
    const name = (result.meta?.name ?? fallbackName).trim() || fallbackName;
    const tracks = result.tracks.map(resolveImportedTrack);
    try {
      // 写入音乐库：返回修正 id 后的 Track[]（本地用 sha256(path)，在线用 platformId）
      const upsertRes = await window.api.library.upsertTracks(tracks);
      if (!upsertRes.success || !upsertRes.data) {
        toast.error(t("playlistTransfer.importFailed"));
        return false;
      }
      const correctedTracks = upsertRes.data;
      const created = await playlistStore.create(name, result.meta?.description);
      await playlistStore.addTracks(created.id, correctedTracks);
      toast.success(
        t("playlistTransfer.importSuccess", { count: correctedTracks.length, name }),
      );
      onCreated?.(created.id);
      return true;
    } catch (err) {
      console.error("[playlistTransfer] import failed:", err);
      toast.error(t("playlistTransfer.importFailed"));
      return false;
    }
  };

  /**
   * 从文件选择器导入
   *
   * 调用主进程弹文件选择对话框，读取后解析并入库
   */
  const importPlaylistFromFile = async (): Promise<boolean> => {
    const picked = await window.api.playlist.import();
    if (!picked.success) {
      if (picked.reason === "readFailed") {
        toast.error(t("playlistTransfer.readFailed"));
      }
      return false;
    }
    const filename = picked.filename ?? "playlist.json";
    const content = picked.content ?? "";
    const result = parsePlaylist(content, filename);
    const fallbackName = filename.replace(/\.[^.]+$/, "");
    return applyImportResult(result, fallbackName, (id) => {
      navigateToPlaylist(id, { source: "local", name: result.meta?.name });
    });
  };

  /**
   * 从已读取的文件内容导入（拖入文件场景）
   *
   * 调用方已读取了 file.text()，直接传入字符串内容
   */
  const importPlaylistFromContent = async (
    content: string,
    filename: string,
  ): Promise<boolean> => {
    if (!isSupportedImportFile(filename)) {
      toast.info(t("playlistTransfer.unsupportedFormat"));
      return false;
    }
    const result = parsePlaylist(content, filename);
    const fallbackName = filename.replace(/\.[^.]+$/, "");
    return applyImportResult(result, fallbackName, (id) => {
      navigateToPlaylist(id, { source: "local", name: result.meta?.name });
    });
  };

  return {
    exportPlaylistToFile,
    importPlaylistFromFile,
    importPlaylistFromContent,
  };
};
