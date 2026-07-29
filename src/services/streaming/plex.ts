/**
 * Plex 流媒体客户端（渲染层）
 *
 * 免登录免 VPN 低延迟真母带路径
 *
 * Plex 媒体服务器原生支持 24bit/192kHz FLAC/ALAC/WAV 等真母带格式，
 * 用户只需在 NAS / 本机部署 Plex Media Server + 音乐库，无需登录第三方账号、
 * 无需翻墙、延迟仅限局域网往返（典型 <5ms）。
 *
 * 鉴权：
 * - POST https://plex.tv/users/sign_in.xml（Basic Auth username:password）→ 拿 X-Plex-Token
 * - 后续所有请求带 X-Plex-Token query 参数 + X-Plex-* 请求头
 * - 服务器侧 /identity 返回 machineIdentifier，用于构造 X-Plex-Client-Identifier
 *
 * 取流：
 * - /library/parts/{partId}/file?X-Plex-Token=...&download=1 直接拉原文件（不转码）
 * - 原 metadata 里 Media[0].Part[0].id 是 partId，但 getStreamUrl 只收到 ratingKey，
 *   故需先 GET /library/metadata/{ratingKey} 拿 Part id（已加 30s LRU 缓存降低延迟）
 */
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingAuthResult,
  StreamingListParams,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
} from "@shared/types/streaming";
import { StreamingAuthError, StreamingProtocolError, classifyError } from "./errors";
import { ensureOk, fetchWithTimeout, normalizeBase } from "./http";

const PRODUCT_NAME = "Soto-Player-Community";
const PRODUCT_VERSION = "3.1.0";
const PLATFORM_NAME = "Desktop";
const DEVICE_NAME = "Soto Player Desktop";

/** 派生稳定 clientIdentifier（基于 cfg.id） */
const clientId = (cfg: StreamingServerConfig): string => `soto-player-${cfg.id}`;

/**
 * 给已剥离 X-Plex-Token 的 image URL 附上当前 token
 * @param url - 已剥离 token 的 URL
 * @param cfg - 服务器配置
 */
export const attachAuthToUrl = (url: string, cfg: StreamingServerConfig): string => {
  if (!cfg.accessToken) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("X-Plex-Token", cfg.accessToken);
    return u.toString();
  } catch {
    return url;
  }
};

/**
 * 构造 Plex 请求头
 * @param cfg - 服务器配置
 */
const buildHeaders = (cfg: StreamingServerConfig): Record<string, string> => ({
  Accept: "application/json",
  "X-Plex-Client-Identifier": clientId(cfg),
  "X-Plex-Product": PRODUCT_NAME,
  "X-Plex-Version": PRODUCT_VERSION,
  "X-Plex-Platform": PLATFORM_NAME,
  "X-Plex-Device-Name": DEVICE_NAME,
  ...(cfg.accessToken ? { "X-Plex-Token": cfg.accessToken } : {}),
});

/**
 * 发起 Plex 请求；URL 自带 X-Plex-Token query（Plex 端点要求 query 不接受 header token）
 * @param cfg - 服务器配置
 * @param path - API 路径（不含 base URL）
 * @param init - fetch 选项
 */
const callApi = async <T>(
  cfg: StreamingServerConfig,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const base = normalizeBase(cfg.url);
  const url = `${base}/${path.replace(/^\//, "")}`;
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: { ...buildHeaders(cfg), ...(init?.headers ?? {}) },
  });
  ensureOk(res);
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
};

/** Plex MediaContainer 通用结构 */
interface PlexMediaContainer<T> {
  MediaContainer?: T;
}

interface PlexIdentity {
  MediaContainer?: { machineIdentifier?: string; version?: string };
}

interface PlexSection {
  key: string;
  title: string;
  type: string;
  agent: string;
  scanner: string;
}

interface PlexSections {
  Directory: PlexSection[];
}

/** Plex Track 节点 */
interface PlexTrack {
  ratingKey: string;
  key: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  duration?: number;
  viewCount?: number;
  parentTitle?: string;
  grandparentTitle?: string;
  index?: number;
  parentIndex?: number;
  Media?: Array<{
    id: number;
    duration?: number;
    bitrate?: number;
    audioChannels?: number;
    audioSampleRate?: number;
    container?: string;
    Part?: Array<{
      id: number;
      key: string;
      file?: string;
      size?: number;
      container?: string;
      audioProfile?: string;
    }>;
  }>;
}

/** Plex Album 节点 */
interface PlexAlbum {
  ratingKey: string;
  key: string;
  title: string;
  year?: number;
  parentTitle?: string;
  leafCount?: number;
  thumb?: string;
}

/** Plex Artist 节点 */
interface PlexArtist {
  ratingKey: string;
  key: string;
  title: string;
  thumb?: string;
  childCount?: number;
}

/** Plex Playlist 节点 */
interface PlexPlaylist {
  ratingKey: string;
  title: string;
  leafCount?: number;
  composite?: string;
}

/** ratingKey → partId LRU 缓存（30s TTL，降低 getStreamUrl 的二次请求延迟） */
const partIdCache = new Map<string, { partId: number; expiresAt: number }>();
const PART_ID_TTL = 30_000;
const PART_ID_CAPACITY = 200;

const setPartIdCache = (ratingKey: string, partId: number): void => {
  if (partIdCache.size >= PART_ID_CAPACITY) {
    const oldest = partIdCache.keys().next().value;
    if (oldest !== undefined) partIdCache.delete(oldest);
  }
  partIdCache.set(ratingKey, { partId, expiresAt: Date.now() + PART_ID_TTL });
};

const getPartIdCache = (ratingKey: string): number | undefined => {
  const entry = partIdCache.get(ratingKey);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    partIdCache.delete(ratingKey);
    return undefined;
  }
  return entry.partId;
};

/**
 * 派生稳定 Track.id：`${cfg.id}:${ratingKey}`
 * @param cfg - 服务器配置
 * @param ratingKey - Plex 侧 ratingKey
 */
const trackId = (cfg: StreamingServerConfig, ratingKey: string): string =>
  `${cfg.id}:${ratingKey}`;

/**
 * 拼 Plex 封面 URL；ratingKey 为空返回 undefined
 * @param cfg - 服务器配置
 * @param ratingKey - 条目 ratingKey
 * @param thumb - Plex 返回的 thumb 路径（/library/metadata/.../thumb/...）
 * @param size - 缩放尺寸（Plex 用 width/height 等比，这里传 width）
 */
const plexCoverUrl = (
  cfg: StreamingServerConfig,
  ratingKey: string | undefined,
  thumb?: string,
  size?: number,
): string | undefined => {
  if (!ratingKey && !thumb) return undefined;
  const base = normalizeBase(cfg.url);
  const token = cfg.accessToken ? `?X-Plex-Token=${encodeURIComponent(cfg.accessToken)}` : "";
  // 优先用 thumb 路径（带 hash，命中率高）
  if (thumb) {
    const path = thumb.startsWith("/") ? thumb : `/${thumb}`;
    const sizeQ = size ? `${thumb.includes("?") ? "&" : "?"}width=${size}&height=${size}` : "";
    return `${base}${path}${token}${sizeQ}`;
  }
  // 兜底：/library/metadata/{ratingKey}/thumb
  return `${base}/library/metadata/${ratingKey}/thumb${token}${size ? `&width=${size}&height=${size}` : ""}`;
};

/**
 * Plex Track → 统一 Track
 * @param cfg - 服务器配置
 * @param track - Plex 返回的 Track 节点
 */
const plexTrackToTrack = (cfg: StreamingServerConfig, track: PlexTrack): Track => {
  const media = track.Media?.[0];
  const part = media?.Part?.[0];
  // 缓存 partId 供 getStreamUrl 直接用，避免每次播放都二次拉 metadata
  if (part?.id) setPartIdCache(track.ratingKey, part.id);
  return {
    id: trackId(cfg, track.ratingKey),
    source: "streaming",
    serverId: cfg.id,
    originalId: track.ratingKey,
    title: track.title || "",
    artists: track.grandparentTitle ? [{ name: track.grandparentTitle }] : [],
    album: track.parentTitle ? { id: track.parentRatingKey, name: track.parentTitle } : undefined,
    duration: track.duration ?? 0,
    track: track.index,
    cover: plexCoverUrl(cfg, track.parentRatingKey, undefined, 500),
    coverOriginal: plexCoverUrl(cfg, track.parentRatingKey, undefined, 1500),
    fileSize: part?.size,
    quality: {
      sampleRate: media?.audioSampleRate ?? 0,
      channels: media?.audioChannels ?? 2,
      bitsPerSample: 0, // Plex 不直接暴露 bitDepth，由音频引擎在播放时 probe
      bitRate: media?.bitrate ? media.bitrate * 1000 : 0,
      codec: media?.container ?? part?.container ?? "",
    },
  };
};

/**
 * Plex Album → 统一 Album
 * @param cfg - 服务器配置
 * @param album - Plex Album 节点
 */
const plexAlbumToView = (cfg: StreamingServerConfig, album: PlexAlbum): Album => ({
  id: album.ratingKey,
  name: album.title,
  artist: album.parentTitle,
  cover: plexCoverUrl(cfg, album.ratingKey, album.thumb, 300),
  trackCount: album.leafCount,
  year: album.year,
});

/**
 * Plex Artist → 统一 Artist
 * @param cfg - 服务器配置
 * @param artist - Plex Artist 节点
 */
const plexArtistToView = (cfg: StreamingServerConfig, artist: PlexArtist): Artist => ({
  id: artist.ratingKey,
  name: artist.title,
  avatar: plexCoverUrl(cfg, artist.ratingKey, artist.thumb, 300),
  albumCount: artist.childCount,
});

/**
 * Plex Playlist → 统一 Playlist
 * @param cfg - 服务器配置
 * @param pl - Plex Playlist 节点
 */
const plexPlaylistToView = (cfg: StreamingServerConfig, pl: PlexPlaylist): Playlist => ({
  id: pl.ratingKey,
  name: pl.title,
  cover: plexCoverUrl(cfg, pl.ratingKey, pl.composite, 300),
  trackCount: pl.leafCount,
});

/**
 * Ping 服务器拿版本号
 * @param cfg - 服务器配置
 */
export const ping = async (cfg: StreamingServerConfig): Promise<StreamingPingResult> => {
  try {
    const json = await callApi<PlexIdentity>(cfg, "identity");
    const version = json?.MediaContainer?.version;
    return { ok: true, version };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: classifyError(err),
    };
  }
};

/**
 * 用账号密码换 X-Plex-Token
 * POST https://plex.tv/users/sign_in.json（Basic Auth）
 * @param cfg - 服务器配置（需 username/password）
 */
export const authenticate = async (cfg: StreamingServerConfig): Promise<StreamingAuthResult> => {
  const basic = btoa(`${cfg.username}:${cfg.password}`);
  const res = await fetchWithTimeout("https://plex.tv/users/sign_in.json", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-Plex-Client-Identifier": clientId(cfg),
      "X-Plex-Product": PRODUCT_NAME,
      "X-Plex-Version": PRODUCT_VERSION,
      "X-Plex-Platform": PLATFORM_NAME,
      "X-Plex-Device-Name": DEVICE_NAME,
      Authorization: `Basic ${basic}`,
    },
  });
  ensureOk(res);
  const json = (await res.json()) as { user?: { authToken?: string; uuid?: string } };
  const token = json?.user?.authToken;
  if (!token) throw new StreamingProtocolError("Plex 登录响应缺少 authToken");
  return { accessToken: token, userId: json.user?.uuid ?? "" };
};

/** 校验已登录并返回 accessToken */
const requireAuth = (cfg: StreamingServerConfig): string => {
  if (!cfg.accessToken) throw new StreamingAuthError("缺少 X-Plex-Token");
  return cfg.accessToken;
};

/**
 * 拉所有音乐库 section（type=artist）
 * @param cfg - 服务器配置
 */
const listMusicSections = async (cfg: StreamingServerConfig): Promise<PlexSection[]> => {
  requireAuth(cfg);
  const json = await callApi<PlexMediaContainer<PlexSections>>(cfg, "library/sections");
  return (json?.MediaContainer?.Directory ?? []).filter((s) => s.type === "artist");
};

/**
 * 拉专辑列表（按添加时间倒序，跨所有 music section）
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listAlbums = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Album[]> => {
  requireAuth(cfg);
  const sections = await listMusicSections(cfg);
  const first = sections[0];
  if (!first) return [];
  const json = await callApi<PlexMediaContainer<{ Metadata?: PlexAlbum[] }>>(
    cfg,
    `library/sections/${first.key}/albums?type=9&sort=addedAt:desc${
      params?.limit ? `&X-Plex-Container-Start=${params.offset ?? 0}&X-Plex-Container-Size=${params.limit}` : ""
    }`,
  );
  return (json?.MediaContainer?.Metadata ?? []).map((a) => plexAlbumToView(cfg, a));
};

/**
 * 拉歌手列表（按名字升序）
 * @param cfg - 服务器配置
 */
export const listArtists = async (cfg: StreamingServerConfig): Promise<Artist[]> => {
  requireAuth(cfg);
  const sections = await listMusicSections(cfg);
  const first = sections[0];
  if (!first) return [];
  const json = await callApi<PlexMediaContainer<{ Metadata?: PlexArtist[] }>>(
    cfg,
    `library/sections/${first.key}/all?type=8&sort=titleSort:asc`,
  );
  return (json?.MediaContainer?.Metadata ?? []).map((a) => plexArtistToView(cfg, a));
};

/**
 * 拉歌单列表（Plex 的 Playlists 端点）
 * @param cfg - 服务器配置
 */
export const listPlaylists = async (cfg: StreamingServerConfig): Promise<Playlist[]> => {
  requireAuth(cfg);
  const json = await callApi<PlexMediaContainer<{ Metadata?: PlexPlaylist[] }>>(
    cfg,
    "playlists?playlistType=audio",
  );
  return (json?.MediaContainer?.Metadata ?? []).map((p) => plexPlaylistToView(cfg, p));
};

/**
 * 拉歌曲列表（按添加时间倒序，type=10 即 track）
 * @param cfg - 服务器配置
 * @param params - 可选分页参数
 */
export const listSongs = async (
  cfg: StreamingServerConfig,
  params?: StreamingListParams,
): Promise<Track[]> => {
  requireAuth(cfg);
  const sections = await listMusicSections(cfg);
  const first = sections[0];
  if (!first) return [];
  const json = await callApi<PlexMediaContainer<{ Metadata?: PlexTrack[] }>>(
    cfg,
    `library/sections/${first.key}/all?type=10&sort=addedAt:desc${
      params?.limit ? `&X-Plex-Container-Start=${params.offset ?? 0}&X-Plex-Container-Size=${params.limit}` : ""
    }`,
  );
  return (json?.MediaContainer?.Metadata ?? []).map((t) => plexTrackToTrack(cfg, t));
};

/**
 * 拉指定专辑的歌曲
 * @param cfg - 服务器配置
 * @param albumId - 专辑 ratingKey
 */
export const getAlbumSongs = async (
  cfg: StreamingServerConfig,
  albumId: string,
): Promise<Track[]> => {
  requireAuth(cfg);
  const json = await callApi<PlexMediaContainer<{ Metadata?: PlexTrack[] }>>(
    cfg,
    `library/metadata/${albumId}/children`,
  );
  // children 端点返回的是 Track 列表（parentRatingKey === albumId）
  return (json?.MediaContainer?.Metadata ?? [])
    .filter((t) => t.Media?.[0]?.Part)
    .map((t) => plexTrackToTrack(cfg, t));
};

/**
 * 拉指定歌单的歌曲
 * @param cfg - 服务器配置
 * @param playlistId - 歌单 ratingKey
 */
export const getPlaylistSongs = async (
  cfg: StreamingServerConfig,
  playlistId: string,
): Promise<Track[]> => {
  requireAuth(cfg);
  const json = await callApi<PlexMediaContainer<{ Metadata?: PlexTrack[] }>>(
    cfg,
    `playlists/${playlistId}/items`,
  );
  return (json?.MediaContainer?.Metadata ?? []).map((t) => plexTrackToTrack(cfg, t));
};

/**
 * 拉指定歌手名下的专辑（按年份倒序）
 * @param cfg - 服务器配置
 * @param artistId - 歌手 ratingKey
 */
export const getArtistAlbums = async (
  cfg: StreamingServerConfig,
  artistId: string,
): Promise<Album[]> => {
  requireAuth(cfg);
  const json = await callApi<PlexMediaContainer<{ Metadata?: PlexAlbum[] }>>(
    cfg,
    `library/metadata/${artistId}/children?excludeElements=Track`,
  );
  return (json?.MediaContainer?.Metadata ?? []).map((a) => plexAlbumToView(cfg, a));
};

/**
 * 拉指定歌手名下的所有歌曲
 * @param cfg - 服务器配置
 * @param artistId - 歌手 ratingKey
 */
export const getArtistSongs = async (
  cfg: StreamingServerConfig,
  artistId: string,
): Promise<Track[]> => {
  requireAuth(cfg);
  const sections = await listMusicSections(cfg);
  const first = sections[0];
  if (!first) return [];
  const json = await callApi<PlexMediaContainer<{ Metadata?: PlexTrack[] }>>(
    cfg,
    `library/sections/${first.key}/all?type=10&artist.id=${artistId}&sort=parentTitle,year,trackNumber`,
  );
  return (json?.MediaContainer?.Metadata ?? []).map((t) => plexTrackToTrack(cfg, t));
};

/**
 * 搜索歌曲/专辑/歌手（Plex 的 /search 端点，type 10/9/8）
 * @param cfg - 服务器配置
 * @param query - 搜索关键词
 */
export const search = async (
  cfg: StreamingServerConfig,
  query: string,
): Promise<StreamingSearchResult> => {
  requireAuth(cfg);
  const q = encodeURIComponent(query);
  const [trackRes, albumRes, artistRes] = await Promise.all([
    callApi<PlexMediaContainer<{ Metadata?: PlexTrack[] }>>(
      cfg,
      `search?query=${q}&type=10&limit=50`,
    ).catch(() => null),
    callApi<PlexMediaContainer<{ Metadata?: PlexAlbum[] }>>(
      cfg,
      `search?query=${q}&type=9&limit=50`,
    ).catch(() => null),
    callApi<PlexMediaContainer<{ Metadata?: PlexArtist[] }>>(
      cfg,
      `search?query=${q}&type=8&limit=50`,
    ).catch(() => null),
  ]);
  return {
    songs: (trackRes?.MediaContainer?.Metadata ?? []).map((t) => plexTrackToTrack(cfg, t)),
    albums: (albumRes?.MediaContainer?.Metadata ?? []).map((a) => plexAlbumToView(cfg, a)),
    artists: (artistRes?.MediaContainer?.Metadata ?? []).map((a) => plexArtistToView(cfg, a)),
  };
};

/**
 * 取流播放 URL（直出原文件，不转码）
 *
 * Plex 的 partId 需从 metadata 拿，listSongs/getAlbumSongs 时已缓存到 partIdCache；
 * 缓存 miss 时 fetch /library/metadata/{ratingKey} 实时拉一次
 *
 * @param cfg - 服务器配置
 * @param originalId - 歌曲 ratingKey
 * @param _playSessionId - Plex 不需要 PlaySessionId
 */
export const getStreamUrl = async (
  cfg: StreamingServerConfig,
  originalId: string,
  _playSessionId?: string,
): Promise<string> => {
  const token = requireAuth(cfg);
  // 1. 命中缓存直接拼 URL（低延迟路径，<1ms）
  let partId = getPartIdCache(originalId);
  // 2. 缓存 miss：fetch metadata 拿 Part id
  if (!partId) {
    const json = await callApi<PlexMediaContainer<{ Metadata?: PlexTrack[] }>>(
      cfg,
      `library/metadata/${originalId}`,
    );
    const track = json?.MediaContainer?.Metadata?.[0];
    partId = track?.Media?.[0]?.Part?.[0]?.id;
    if (!partId) throw new StreamingProtocolError("Plex 响应缺少 Part id");
    setPartIdCache(originalId, partId);
  }
  const base = normalizeBase(cfg.url);
  // download=1 强制原文件不转码；X-Plex-Token 在 query 里（Plex 不接受 header token）
  return `${base}/library/parts/${partId}/file?X-Plex-Token=${encodeURIComponent(token)}&download=1`;
};

/**
 * 取歌词（Plex 不原生支持歌词，返回 null）
 * @param _cfg - 服务器配置
 * @param _originalId - 歌曲 ratingKey
 */
export const getLyrics = async (
  _cfg: StreamingServerConfig,
  _originalId: string,
): Promise<string | null> => null;
