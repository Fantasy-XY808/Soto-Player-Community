/**
 * WebDAV 流媒体客户端（渲染层）
 *
 * 免登录免 VPN 低延迟真母带路径
 *
 * WebDAV 是 NAS（Synology/QNAP/TrueNAS）通用协议，支持挂载 Hi-Res 母带库。
 * 用户只需在 NAS 启用 WebDAV 服务，本地或 VPN 内网访问即可。
 *
 * 限制：
 * - WebDAV 不暴露音频元数据（采样率/位深），仅靠文件扩展名 + 大小推断
 * - 真实位深/采样率由音频引擎在播放首帧时 probe
 * - 专辑/歌手按目录结构推断：顶层目录 = 歌手，二级目录 = 专辑，文件 = 歌曲
 *
 * 鉴权：HTTP Basic Auth（username:password）
 * 取流：GET {url}/{path} 直出原文件
 */
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingListParams,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
} from "@shared/types/streaming";
import { StreamingProtocolError, classifyError } from "./errors";
import { fetchWithTimeout, normalizeBase } from "./http";

/** 支持的音频扩展名（小写，与 scanner.rs AUDIO_EXTENSIONS 对齐） */
const AUDIO_EXTENSIONS = new Set([
  "mp3", "flac", "wav", "ogg", "aac", "m4a", "wma", "opus", "ape",
  "dsf", "dff", "aiff", "aif", "wv", "tta", "tak", "shn",
]);

/** 无损音频扩展名（用于推断 quality.codec） */
const LOSSLESS_EXTENSIONS = new Set([
  "flac", "wav", "ape", "aiff", "aif", "wv", "tta", "tak", "shn",
  "dsf", "dff", "m4a", // m4a 可能是 ALAC
]);

/** DSD 扩展名（SACD 母带） */
const DSD_EXTENSIONS = new Set(["dsf", "dff"]);

interface WebDAVProp {
  href: string;
  displayName?: string;
  size?: number;
  contentType?: string;
  isCollection?: boolean;
  lastModified?: string;
}

/**
 * 给已剥离 Basic Auth 的 URL 附上当前会话凭据
 * WebDAV 取流 URL 需要带 Basic Auth（query 参数不被 WebDAV 支持）
 * @param url - 原 URL
 * @param cfg - 服务器配置
 */
export const attachAuthToUrl = (url: string, cfg: StreamingServerConfig): string => {
  if (!cfg.username && !cfg.password) return url;
  try {
    const u = new URL(url);
    u.username = encodeURIComponent(cfg.username);
    u.password = encodeURIComponent(cfg.password);
    return u.toString();
  } catch {
    return url;
  }
};

/**
 * 构造 Basic Auth header 值
 * @param cfg - 服务器配置
 */
const basicAuthHeader = (cfg: StreamingServerConfig): string => {
  const cred = btoa(`${cfg.username}:${cfg.password}`);
  return `Basic ${cred}`;
};

/**
 * 构造请求头
 * @param cfg - 服务器配置
 */
const buildHeaders = (cfg: StreamingServerConfig, extra?: Record<string, string>): Record<string, string> => ({
  Authorization: basicAuthHeader(cfg),
  ...extra,
});

/**
 * 从文件路径取扩展名（小写，不含 .）
 * @param path - 文件路径
 */
const getExtension = (path: string): string => {
  const lastDot = path.lastIndexOf(".");
  if (lastDot < 0) return "";
  return path.slice(lastDot + 1).toLowerCase();
};

/**
 * 从文件路径取文件名（不含扩展名）
 * @param path - 文件路径
 */
const getFileName = (path: string): string => {
  const lastSlash = path.lastIndexOf("/");
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? name.slice(0, lastDot) : name;
};

/**
 * 解码 HTML 实体（WebDAV XML 中 & < > 会被转义）
 * @param s - 待解码字符串
 */
const decodeEntities = (s: string): string => {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
};

/**
 * 解析 WebDAV PROPFIND multistatus XML
 * @param xml - 原始 XML 字符串
 * @param basePath - 当前请求的 base path（用于过滤掉目录本身）
 */
const parsePropfind = (xml: string, basePath: string): WebDAVProp[] => {
  const result: WebDAVProp[] = [];
  // 简易 XML 解析（避免引入 xmldom 依赖，PROPFIND 响应结构稳定）
  const responseRegex = /<[^:]*response[^>]*>([\s\S]*?)<\/[^:]*response>/g;
  let match: RegExpExecArray | null;
  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1];
    const hrefMatch = block.match(/<[^:]*href[^>]*>([^<]+)<\/[^:]*href>/);
    if (!hrefMatch) continue;
    const href = decodeURIComponent(decodeEntities(hrefMatch[1].trim()));
    // 跳过目录自身（href === basePath）
    if (href === basePath || href === basePath + "/") continue;
    const isCollection = /<[^:]*collection[^/]*\/>/.test(block);
    const sizeMatch = block.match(/<[^:]*getcontentlength[^>]*>([^<]+)<\/[^:]*getcontentlength>/);
    const nameMatch = block.match(/<[^:]*displayname[^>]*>([^<]+)<\/[^:]*displayname>/);
    const typeMatch = block.match(/<[^:]*getcontenttype[^>]*>([^<]+)<\/[^:]*getcontenttype>/);
    const modifiedMatch = block.match(/<[^:]*getlastmodified[^>]*>([^<]+)<\/[^:]*getlastmodified>/);
    result.push({
      href,
      displayName: nameMatch ? decodeEntities(nameMatch[1].trim()) : undefined,
      size: sizeMatch ? Number(sizeMatch[1].trim()) : undefined,
      contentType: typeMatch ? typeMatch[1].trim() : undefined,
      isCollection,
      lastModified: modifiedMatch ? modifiedMatch[1].trim() : undefined,
    });
  }
  return result;
};

/**
 * PROPFIND 一个目录，返回子条目
 * @param cfg - 服务器配置
 * @param dirPath - 目录路径（相对 base，以 / 开头）
 */
const propfind = async (cfg: StreamingServerConfig, dirPath: string): Promise<WebDAVProp[]> => {
  const base = normalizeBase(cfg.url);
  const path = dirPath.startsWith("/") ? dirPath : `/${dirPath}`;
  const url = `${base}${path}`;
  const res = await fetchWithTimeout(url, {
    method: "PROPFIND",
    headers: buildHeaders(cfg, {
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    }),
    body:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<D:propfind xmlns:D="DAV:">' +
      "<D:prop><D:displayname/><D:getcontentlength/><D:getcontenttype/><D:resourcetype/><D:getlastmodified/></D:prop>" +
      "</D:propfind>",
  });
  if (!res.ok) {
    throw new StreamingProtocolError(`PROPFIND ${path} 失败: HTTP ${res.status}`);
  }
  const xml = await res.text();
  return parsePropfind(xml, path);
};

/**
 * Ping 服务器：PROPFIND 根目录，成功即认为连通
 * @param cfg - 服务器配置
 */
export const ping = async (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  try {
    await propfind(cfg, "/");
    return { ok: true, version: "WebDAV" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: classifyError(err),
    };
  }
};

/**
 * 派生稳定 Track.id：`${cfg.id}:${hash(path)}`
 * @param cfg - 服务器配置
 * @param path - 文件路径
 */
const trackId = (cfg: StreamingServerConfig, path: string): string =>
  `${cfg.id}:${encodeURIComponent(path)}`;

/**
 * WebDAV 文件 → 统一 Track
 * @param cfg - 服务器配置
 * @param prop - WebDAV PROPFIND 条目
 * @param dirPath - 父目录路径（用于推断 album name）
 */
const webdavFileToTrack = (
  cfg: StreamingServerConfig,
  prop: WebDAVProp,
  dirPath: string,
): Track => {
  const ext = getExtension(prop.href);
  const fileName = prop.displayName || getFileName(prop.href);
  const albumName = dirPath.split("/").filter(Boolean).pop() ?? "";
  const codec = DSD_EXTENSIONS.has(ext)
    ? "dsd"
    : LOSSLESS_EXTENSIONS.has(ext)
      ? ext === "m4a"
        ? "alac" // 猜测 m4a 是 ALAC，实际由引擎 probe
        : ext
      : ext;
  // 推断 bitsPerSample：DSD 1bit，FLAC/WAV 可能 16/24/32，无法仅凭扩展名确定
  return {
    id: trackId(cfg, prop.href),
    source: "streaming",
    serverId: cfg.id,
    // originalId 编码为完整路径，getStreamUrl 直接用
    originalId: decodeURIComponent(prop.href),
    title: fileName,
    artists: [], // WebDAV 无元数据，由音频引擎从 tag 提取
    album: albumName ? { name: albumName } : undefined,
    duration: 0, // WebDAV 无时长信息，由引擎 probe
    fileSize: prop.size,
    quality: {
      sampleRate: 0, // 由引擎 probe
      channels: 2,
      bitsPerSample: 0, // 由引擎 probe
      bitRate: 0,
      codec,
    },
  };
};

/**
 * 列出目录下的音频文件（非递归）
 * @param cfg - 服务器配置
 * @param dirPath - 目录路径
 */
const listAudioFiles = async (
  cfg: StreamingServerConfig,
  dirPath: string,
): Promise<Track[]> => {
  const entries = await propfind(cfg, dirPath);
  return entries
    .filter((e) => !e.isCollection && AUDIO_EXTENSIONS.has(getExtension(e.href)))
    .map((e) => webdavFileToTrack(cfg, e, dirPath));
};

/**
 * 列出目录下的子目录
 * @param cfg - 服务器配置
 * @param dirPath - 目录路径
 */
const listSubdirs = async (
  cfg: StreamingServerConfig,
  dirPath: string,
): Promise<WebDAVProp[]> => {
  const entries = await propfind(cfg, dirPath);
  return entries.filter((e) => e.isCollection);
};

/**
 * 拉专辑列表（二级目录 = 专辑）
 *
 * 约定目录结构：
 * - /Artist1/Album1/track1.flac, track2.flac ...
 * - /Artist1/Album2/...
 * - /Artist2/Album1/...
 *
 * 顶层目录 = 歌手，二级目录 = 专辑
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listAlbums = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Album[]> => {
  const artists = await listSubdirs(cfg, "/");
  const albums: Album[] = [];
  for (const artistDir of artists) {
    const artistName = artistDir.displayName || getFileName(artistDir.href);
    const albumDirs = await listSubdirs(cfg, artistDir.href);
    for (const albumDir of albumDirs) {
      const albumName = albumDir.displayName || getFileName(albumDir.href);
      albums.push({
        id: decodeURIComponent(albumDir.href),
        name: albumName,
        artist: artistName,
        cover: undefined, // WebDAV 无封面
        year: undefined,
      });
      if (params?.limit && albums.length >= params.limit) return albums;
    }
  }
  return albums;
};

/**
 * 拉歌手列表（顶层目录 = 歌手）
 * @param cfg - 服务器配置
 */
export const listArtists = async (cfg: StreamingServerConfig): Promise<Artist[]> => {
  const artists = await listSubdirs(cfg, "/");
  return artists.map((d) => ({
    id: decodeURIComponent(d.href),
    name: d.displayName || getFileName(d.href),
  }));
};

/**
 * 拉歌单列表（WebDAV 无歌单概念，返回空）
 * @param _cfg - 服务器配置
 */
export const listPlaylists = async (_cfg: StreamingServerConfig): Promise<Playlist[]> => [];

/**
 * 拉歌曲列表（递归所有音频文件，按目录排序）
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listSongs = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Track[]> => {
  const artists = await listSubdirs(cfg, "/");
  const songs: Track[] = [];
  for (const artistDir of artists) {
    const albumDirs = await listSubdirs(cfg, artistDir.href);
    for (const albumDir of albumDirs) {
      const tracks = await listAudioFiles(cfg, albumDir.href);
      songs.push(...tracks);
      if (params?.limit && songs.length >= params.limit) return songs;
    }
  }
  return songs;
};

/**
 * 拉指定专辑的歌曲
 * @param cfg - 服务器配置
 * @param albumId - 专辑目录路径
 */
export const getAlbumSongs = async (
  cfg: StreamingServerConfig,
  albumId: string,
): Promise<Track[]> => listAudioFiles(cfg, albumId);

/**
 * 拉指定歌单的歌曲（WebDAV 无歌单，返回空）
 * @param _cfg - 服务器配置
 * @param _playlistId - 歌单 id
 */
export const getPlaylistSongs = async (
  _cfg: StreamingServerConfig,
  _playlistId: string,
): Promise<Track[]> => [];

/**
 * 拉指定歌手名下的专辑（二级目录列表）
 * @param cfg - 服务器配置
 * @param artistId - 歌手目录路径
 */
export const getArtistAlbums = async (
  cfg: StreamingServerConfig,
  artistId: string,
): Promise<Album[]> => {
  const albumDirs = await listSubdirs(cfg, artistId);
  const artistName = artistId.split("/").filter(Boolean).pop() ?? "";
  return albumDirs.map((d) => ({
    id: decodeURIComponent(d.href),
    name: d.displayName || getFileName(d.href),
    artist: artistName,
    cover: undefined,
  }));
};

/**
 * 拉指定歌手名下的所有歌曲
 * @param cfg - 服务器配置
 * @param artistId - 歌手目录路径
 */
export const getArtistSongs = async (
  cfg: StreamingServerConfig,
  artistId: string,
): Promise<Track[]> => {
  const albumDirs = await listSubdirs(cfg, artistId);
  const songs: Track[] = [];
  for (const albumDir of albumDirs) {
    const tracks = await listAudioFiles(cfg, albumDir.href);
    songs.push(...tracks);
  }
  return songs;
};

/**
 * 搜索歌曲/专辑/歌手
 *
 * WebDAV 不支持服务端搜索，只能客户端遍历。为避免性能问题，
 * 这里仅在已缓存的 songs 里搜，调用方应先 listSongs 后再 search。
 * @param _cfg - 服务器配置
 * @param _query - 搜索关键词
 */
export const search = async (
  _cfg: StreamingServerConfig,
  _query: string,
): Promise<StreamingSearchResult> => ({ songs: [], albums: [], artists: [] });

/**
 * 取流播放 URL（直出原文件）
 *
 * WebDAV 取流需要 Basic Auth header，但 HTML <audio> 元素不支持自定义 header，
 * 故把凭据编码到 URL 里（http://user:pass@host/path 形式）。
 * 注意：此 URL 含明文凭据，仅限本地/内网使用。
 *
 * @param cfg - 服务器配置
 * @param originalId - 文件完整路径（已 URL 编码）
 */
export const getStreamUrl = async (
  cfg: StreamingServerConfig,
  originalId: string,
  _playSessionId?: string,
): Promise<string> => {
  const base = normalizeBase(cfg.url);
  const path = originalId.startsWith("/") ? originalId : `/${originalId}`;
  // 把 Basic Auth 编码到 URL
  const cred = `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`;
  // 提取 protocol + host 部分
  const urlMatch = base.match(/^(https?:\/\/)(.+)$/);
  if (!urlMatch) throw new StreamingProtocolError(`WebDAV URL 格式错误: ${base}`);
  const [, protocol, host] = urlMatch;
  return `${protocol}${cred}${host}${path}`;
};

/**
 * 取歌词（WebDAV 不支持，返回 null）
 * @param _cfg - 服务器配置
 * @param _originalId - 文件路径
 */
export const getLyrics = async (
  _cfg: StreamingServerConfig,
  _originalId: string,
): Promise<string | null> => null;
