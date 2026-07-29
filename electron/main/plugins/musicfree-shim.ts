/**
 * MusicFreeDesktop 插件协议兼容垫片
 *
 * MusicFree 插件用 CommonJS `module.exports = { platform, search, getMediaSource, ... }` 导出，
 * 14 个方法覆盖完整音源生命周期。本垫片：
 * 1. 在沙箱里注入 `module` / `exports` / `require` / `env` / `process` 全局变量
 * 2. 提供白名单 require：cheerio / crypto-js / axios / dayjs / big-integer / qs / he / webdav
 * 3. 脚本执行后从 `module.exports`（或 `.default`）提取实例
 * 4. 把实例的 14 个方法包装成 splayer action handler，注册到 router
 *
 * 被 sandbox.worker.ts 导入，运行在 utilityProcess + vm.Context。
 *
 * 设计与 lx-shim 一致：installMusicFreeShim 在脚本执行前注入全局变量，
 * 返回的 handle.extractAndRegister() 在脚本执行后提取方法并注册 handlers。
 */

import CryptoJs from "crypto-js";
import dayjs from "dayjs";
import axios from "axios";
import bigInt from "big-integer";
import qs from "qs";
import * as cheerio from "cheerio";
import he from "he";
import * as webdav from "webdav";
import type {
  ActionIO,
  HostApi,
  MfAlbumItem,
  MfArtistItem,
  MfArtistMediaType,
  MfGetAlbumInfoReq,
  MfGetAlbumInfoRes,
  MfGetArtistWorksReq,
  MfGetArtistWorksRes,
  MfGetLyricReq,
  MfGetLyricRes,
  MfGetMediaSourceReq,
  MfGetMediaSourceRes,
  MfGetMusicCommentsReq,
  MfGetMusicCommentsRes,
  MfGetMusicInfoReq,
  MfGetMusicInfoRes,
  MfGetMusicSheetInfoReq,
  MfGetMusicSheetInfoRes,
  MfGetRecommendSheetTagsRes,
  MfGetRecommendSheetsByTagReq,
  MfGetRecommendSheetsByTagRes,
  MfGetTopListDetailReq,
  MfGetTopListDetailRes,
  MfGetTopListsRes,
  MfImportMusicItemReq,
  MfImportMusicItemRes,
  MfImportMusicSheetReq,
  MfImportMusicSheetRes,
  MfMediaType,
  MfMusicItem,
  MfQualityKey,
  MfSearchReq,
  MfSearchRes,
  MfSheetItem,
  MfSheetGroupItem,
  MfUserVariable,
  PluginAction,
  PluginQuality,
  SourceCapability,
} from "@shared/types/plugin";

/** MusicFree 插件实例的最小形状（运行时提取，不强校验） */
interface MfPluginInstance {
  platform: string;
  version?: string;
  appVersion?: string;
  srcUrl?: string;
  primaryKey?: string[];
  defaultSearchType?: MfMediaType;
  supportedSearchType?: MfMediaType[];
  cacheControl?: "cache" | "no-cache" | "no-store";
  author?: string;
  userVariables?: MfUserVariable[];
  hints?: Record<string, string[]>;
  search?: (query: string, page: number, type: MfMediaType) => Promise<unknown>;
  getMediaSource?: (
    musicItem: Partial<MfMusicItem>,
    quality: MfQualityKey,
  ) => Promise<unknown>;
  getMusicInfo?: (musicBase: {
    id: string;
    platform: string;
    [key: string]: unknown;
  }) => Promise<unknown>;
  getLyric?: (musicItem: Partial<MfMusicItem>) => Promise<unknown>;
  getAlbumInfo?: (albumItem: MfAlbumItem, page: number) => Promise<unknown>;
  getMusicSheetInfo?: (sheetItem: MfSheetItem, page: number) => Promise<unknown>;
  getArtistWorks?: (
    artistItem: MfArtistItem,
    page: number,
    type: MfArtistMediaType,
  ) => Promise<unknown>;
  importMusicSheet?: (urlLike: string) => Promise<unknown>;
  importMusicItem?: (urlLike: string) => Promise<unknown>;
  getTopLists?: () => Promise<unknown>;
  getTopListDetail?: (topListItem: MfSheetItem, page: number) => Promise<unknown>;
  getRecommendSheetTags?: () => Promise<unknown>;
  getRecommendSheetsByTag?: (
    tag: { id: string; title?: string; [key: string]: unknown },
    page?: number,
  ) => Promise<unknown>;
  getMusicComments?: (musicItem: MfMusicItem, page?: number) => Promise<unknown>;
}

/**
 * axios 默认超时
 *
 * 8s，与 ACTION_TIMEOUTS.search 对齐。
 * 插件层若直接用 axios 拉远端数据，8s 内未返回就让宿主超时控制接管；
 * 否则插件本身可能在 15s 后才报错，但宿主 getMediaSource 已在 12s 超时返回，
 * 残留的 axios 请求会拖慢下一次调用。
 */
axios.defaults.timeout = 8_000;

/** 简化的代理配置形状（与 ProxySettings 子集对齐，避免循环依赖） */
interface ProxyConfig {
  protocol: "off" | "http" | "socks";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * 把 system.proxy 同步到 axios.defaults.proxy
 *
 * axios 内置 proxy 字段仅支持 HTTP/HTTPS 代理（基于 Node http.Agent 实现）；
 * SOCKS5 需要 socks-proxy-agent 作为 httpsAgent，项目未引入该依赖，先做以下处理：
 *   - HTTP/HTTPS 代理：配置 axios.defaults.proxy，让 axios 自动走代理
 *   - SOCKS5 代理：关闭 axios.defaults.proxy（直连），由插件各自的 axios 调用按需处理
 *     若 SOCKS5 场景插件不可用，后续可引入 socks-proxy-agent
 *   - 关闭/未配置：proxy=false，axios 直连
 *
 * 调用时机：
 *   - installMusicFreeShim 时调用一次（worker init 阶段）
 *   - 主进程 system.proxy 变化时通过 proxyUpdate 消息通知所有 worker 重新配置（待实现）
 *
 * @param proxy - system.proxy 配置快照；undefined 时按 off 处理
 */
export const configureAxiosProxy = (proxy?: ProxyConfig): void => {
  if (!proxy || proxy.protocol === "off" || !proxy.host) {
    axios.defaults.proxy = false;
    return;
  }
  if (proxy.protocol === "socks") {
    // SOCKS5 暂不支持，让 axios 直连；用户可改用混合端口或 HTTP 代理
    axios.defaults.proxy = false;
    return;
  }
  axios.defaults.proxy = {
    host: proxy.host,
    port: proxy.port,
    protocol: proxy.protocol,
    auth: proxy.username
      ? { username: proxy.username, password: proxy.password ?? "" }
      : undefined,
  };
};

/**
 * 白名单 require 映射表
 * 与 MusicFreeDesktop 的 plugin.ts packages 表对齐
 */
const buildWhitelistPackages = (splayer: HostApi) => {
  /** musicfree/storage polyfill：映射到 splayer.storage，每插件隔离 */
  const pluginStorage = {
    get: (key: string) => splayer.storage.get(key),
    set: (key: string, value: unknown) => splayer.storage.set(key, value),
    remove: (key: string) => splayer.storage.remove(key),
    keys: () => splayer.storage.keys(),
  };

  /** @react-native-cookies/cookies polyfill：沙箱内无法直接访问 Electron session，先做 no-op */
  const cookiesPolyfill = {
    get: () => Promise.resolve([]),
    set: () => Promise.resolve(true),
    clear: () => Promise.resolve(true),
    flush: () => Promise.resolve(true),
    addListener: () => undefined,
    removeAllListeners: () => undefined,
  };

  const packages: Record<string, unknown> = {
    cheerio,
    "crypto-js": CryptoJs,
    axios,
    dayjs,
    "big-integer": bigInt,
    qs,
    he,
    webdav,
    "musicfree/storage": pluginStorage,
    "@react-native-cookies/cookies": cookiesPolyfill,
  };

  return packages;
};

/** MusicFree 音质 → 宿主 PluginQuality 映射 */
const MF_QUALITY_TO_HOST: Record<MfQualityKey, PluginQuality> = {
  low: "lq",
  standard: "sq",
  high: "hq",
  super: "hi-res",
};

const HOST_QUALITY_TO_MF: Record<PluginQuality, MfQualityKey> = {
  lq: "low",
  sq: "standard",
  hq: "high",
  lossless: "super",
  "hi-res": "super",
  jymaster: "super",
  sky: "super",
  jyeffect: "super",
};

/** MusicFree 插件实例提取结果 */
export interface MfExtractResult {
  platform: string;
  userVariables?: MfUserVariable[];
  /** 已注册到 handlers 的 action 列表 */
  registeredActions: PluginAction[];
}

/** installMusicFreeShim 返回的句柄 */
export interface MusicFreeShimHandle {
  /**
   * 脚本执行后调用：从 module.exports 提取实例方法并注册到 handlers
   * @returns 平台标识与用户变量声明；platform 为空时视为非法插件
   */
  extractAndRegister: () => MfExtractResult;
}

/**
 * 安装 MusicFree 垫片
 *
 * @param sandboxGlobal - 沙箱上下文对象（vm.createContext 前的 plain object）
 * @param splayer - 宿主 API 实例
 * @param handlers - 共享的 action handler 注册表
 * @param onSources - 注册成功后上报能力的回调
 * @param scriptInfo - 脚本元数据（主进程解析头注释后传入）
 * @param userVariables - 用户为此插件配置的变量值
 * @param proxy - 系统代理配置快照（worker init 时传入，让 axios 走代理）
 */
export const installMusicFreeShim = (
  sandboxGlobal: Record<string, unknown>,
  splayer: HostApi,
  handlers: Map<PluginAction, (req: unknown) => Promise<unknown>>,
  onSources: (sources: Record<string, SourceCapability>) => void,
  scriptInfo: { name: string; description: string; version: string; author: string; homepage: string },
  userVariables: Record<string, string>,
  proxy?: ProxyConfig,
): MusicFreeShimHandle => {
  // 同步代理配置到 axios（让插件用 axios 拉数据时自动走系统代理）
  configureAxiosProxy(proxy);
  // CommonJS module 容器：插件执行时 `module.exports = { ... }` 会填充此对象
  const _module = {
    exports: {} as Record<string, unknown>,
    loaded: false,
  };

  const packages = buildWhitelistPackages(splayer);

  /** 白名单 require：只允许 MusicFree 插件约定的包 */
  const _require = (packageName: string): unknown => {
    const pkg = packages[packageName];
    if (pkg != null) {
      // MusicFreeDesktop 的做法：给 pkg 挂一个 default 指向自己，兼容 `require('axios').default` 用法
      if (typeof pkg === "object" && pkg !== null) {
        (pkg as Record<string, unknown>).default = pkg;
      }
      return pkg;
    }
    return null;
  };

  /** 插件环境变量 */
  const env = {
    getUserVariables: () => userVariables,
    os: process.platform,
    appVersion: splayer.appVersion,
    lang: splayer.locale,
  };

  /** process polyfill：对齐 MusicFreeDesktop 的 _process 形状 */
  const _process = {
    platform: process.platform,
    version: splayer.appVersion,
    env,
    ensurePluginInitialized: Promise.resolve(),
  };

  // 注入 CommonJS 全局变量
  sandboxGlobal.module = _module;
  sandboxGlobal.exports = _module.exports;
  sandboxGlobal.require = _require;
  sandboxGlobal.__musicfree_require = _require;
  sandboxGlobal.env = env;
  // 注意：不覆盖 sandboxGlobal.process（Node 原生 process 在 utilityProcess 已可用，
  // 但 MusicFreeDesktop 传入的是定制版 _process；这里用 Object.defineProperty 软覆盖关键字段）
  try {
    Object.defineProperty(sandboxGlobal, "process", {
      value: _process,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    // 某些 vm context 不允许 defineProperty，退化为直接赋值
    sandboxGlobal.process = _process;
  }

  // 脚本可能用 globalThis 引用，确保 module/exports/require 可见
  sandboxGlobal.globalThis = sandboxGlobal;

  /**
   * 脚本执行后调用：从 _module.exports 提取实例并注册 handlers
   */
  const extractAndRegister = (): MfExtractResult => {
    _module.loaded = true;
    const exports = _module.exports;
    const instance = (exports.default ?? exports) as MfPluginInstance;

    if (!instance || typeof instance !== "object") {
      return { platform: "", registeredActions: [] };
    }

    const platform = typeof instance.platform === "string" ? instance.platform : "";
    if (!platform) {
      return { platform: "", registeredActions: [] };
    }

    const registeredActions: PluginAction[] = [];

    /** 注册单个 action handler */
    const register = <A extends PluginAction>(
      action: A,
      fn: ((...args: unknown[]) => unknown) | undefined,
      argTransform: (req: ActionIO[A]["req"]) => unknown[],
      resTransform: (raw: unknown) => ActionIO[A]["res"],
    ): void => {
      if (typeof fn !== "function") return;
      registeredActions.push(action);
      handlers.set(action, async (req: unknown) => {
        const args = argTransform(req as ActionIO[A]["req"]);
        const raw = await Promise.resolve(fn.apply(instance, args));
        return resTransform(raw);
      });
    };

    // search: (query, page, type) => { isEnd?, data: [] }
    register(
      "search",
      instance.search as ((...args: unknown[]) => unknown) | undefined,
      (req: MfSearchReq) => [req.query, req.page, req.type],
      (raw) => {
        const r = (raw ?? {}) as { isEnd?: boolean; data?: unknown[] };
        return {
          isEnd: r.isEnd ?? true,
          data: (r.data ?? []) as MfMusicItem[] | MfAlbumItem[] | MfArtistItem[] | MfSheetItem[],
        } as MfSearchRes;
      },
    );

    // getMediaSource: (musicItem, quality) => { headers?, url?, userAgent?, quality? }
    register(
      "getMediaSource" as const,
      instance.getMediaSource as ((...args: unknown[]) => unknown) | undefined,
      (req: MfGetMediaSourceReq) => [req.musicItem, req.quality],
      (raw) => {
        if (raw == null) return {} as MfGetMediaSourceRes;
        const r = raw as MfGetMediaSourceRes;
        return {
          headers: r.headers,
          url: r.url,
          userAgent: r.userAgent,
          quality: r.quality,
        };
      },
    );

    // getLyric: (musicItem) => { lrc?, rawLrc?, translation? }
    register(
      "getLyric" as const,
      instance.getLyric as ((...args: unknown[]) => unknown) | undefined,
      (req: MfGetLyricReq) => [req.musicItem],
      (raw) => {
        if (raw == null) return {} as MfGetLyricRes;
        const r = raw as MfGetLyricRes;
        return { lrc: r.lrc, rawLrc: r.rawLrc, translation: r.translation };
      },
    );

    // getMusicInfo: (musicBase) => Partial<IMusicItem> | null
    register(
      "getMusicInfo" as const,
      instance.getMusicInfo as ((...args: unknown[]) => unknown) | undefined,
      (req: MfGetMusicInfoReq) => [req.musicBase],
      (raw) => ({ musicItem: (raw ?? undefined) as Partial<MfMusicItem> | undefined }) as MfGetMusicInfoRes,
    );

    // getAlbumInfo: (albumItem, page) => { isEnd?, albumItem?, musicList? }
    register(
      "getAlbumInfo" as const,
      instance.getAlbumInfo as ((...args: unknown[]) => unknown) | undefined,
      (req: MfGetAlbumInfoReq) => [req.albumItem, req.page],
      (raw) => (raw ?? {}) as MfGetAlbumInfoRes,
    );

    // getMusicSheetInfo: (sheetItem, page) => { isEnd?, sheetItem?, musicList? }
    register(
      "getMusicSheetInfo" as const,
      instance.getMusicSheetInfo as ((...args: unknown[]) => unknown) | undefined,
      (req: MfGetMusicSheetInfoReq) => [req.sheetItem, req.page],
      (raw) => (raw ?? {}) as MfGetMusicSheetInfoRes,
    );

    // getArtistWorks: (artistItem, page, type) => { isEnd?, data: [] }
    register(
      "getArtistWorks" as const,
      instance.getArtistWorks as ((...args: unknown[]) => unknown) | undefined,
      (req: MfGetArtistWorksReq) => [req.artistItem, req.page, req.type],
      (raw) => {
        const r = (raw ?? {}) as { isEnd?: boolean; data?: unknown[] };
        return {
          isEnd: r.isEnd ?? true,
          data: (r.data ?? []) as MfMusicItem[] | MfAlbumItem[],
        } as MfGetArtistWorksRes;
      },
    );

    // importMusicSheet: (urlLike) => IMusicItem[] | null
    register(
      "importMusicSheet" as const,
      instance.importMusicSheet as ((...args: unknown[]) => unknown) | undefined,
      (req: MfImportMusicSheetReq) => [req.url],
      (raw) => ({ musicList: (raw ?? []) as MfMusicItem[] }) as MfImportMusicSheetRes,
    );

    // importMusicItem: (urlLike) => IMusicItem | null
    register(
      "importMusicItem" as const,
      instance.importMusicItem as ((...args: unknown[]) => unknown) | undefined,
      (req: MfImportMusicItemReq) => [req.url],
      (raw) => ({ musicItem: (raw ?? null) as MfMusicItem | null }) as MfImportMusicItemRes,
    );

    // getTopLists: () => IMusicSheetGroupItem[]
    register(
      "getTopLists" as const,
      instance.getTopLists as ((...args: unknown[]) => unknown) | undefined,
      () => [],
      (raw) => ({ data: (raw ?? []) as MfSheetGroupItem[] }) as MfGetTopListsRes,
    );

    // getTopListDetail: (topListItem, page) => { isEnd?, topListItem?, musicList? }
    register(
      "getTopListDetail" as const,
      instance.getTopListDetail as ((...args: unknown[]) => unknown) | undefined,
      (req: MfGetTopListDetailReq) => [req.topListItem, req.page],
      (raw) => (raw ?? {}) as MfGetTopListDetailRes,
    );

    // getRecommendSheetTags: () => { pinned?, data? }
    register(
      "getRecommendSheetTags" as const,
      instance.getRecommendSheetTags as ((...args: unknown[]) => unknown) | undefined,
      () => [],
      (raw) => (raw ?? {}) as MfGetRecommendSheetTagsRes,
    );

    // getRecommendSheetsByTag: (tag, page?) => { isEnd?, data? }
    register(
      "getRecommendSheetsByTag" as const,
      instance.getRecommendSheetsByTag as ((...args: unknown[]) => unknown) | undefined,
      (req: MfGetRecommendSheetsByTagReq) => [req.tag, req.page],
      (raw) => (raw ?? {}) as MfGetRecommendSheetsByTagRes,
    );

    // getMusicComments: (musicItem, page?) => { isEnd?, data? }
    register(
      "getMusicComments" as const,
      instance.getMusicComments as ((...args: unknown[]) => unknown) | undefined,
      (req: MfGetMusicCommentsReq) => [req.musicItem, req.page],
      (raw) => (raw ?? {}) as MfGetMusicCommentsRes,
    );

    // 上报能力：MusicFree 插件统一注册为一个 source，actions = 已注册的 action 列表
    if (registeredActions.length > 0) {
      const capabilities: Record<string, SourceCapability> = {
        [platform]: {
          name: scriptInfo.name || platform,
          actions: registeredActions,
        },
      };
      onSources(capabilities);
    }

    return {
      platform,
      userVariables: Array.isArray(instance.userVariables) ? instance.userVariables : undefined,
      registeredActions,
    };
  };

  return { extractAndRegister };
};

/** MusicFree 音质映射工具（导出供 router / audioSource 使用） */
export const mapMfQualityToHost = (q: MfQualityKey): PluginQuality => MF_QUALITY_TO_HOST[q] ?? "hq";
export const mapHostQualityToMf = (q: PluginQuality): MfQualityKey => HOST_QUALITY_TO_MF[q] ?? "high";

/**
 * 将宿主 Track 转换为 MusicFree IMusicItem
 * 用于调用 MusicFree 插件方法时的入参归一化
 */
export const trackToMfMusicItem = (track: {
  id: string;
  title: string;
  artists?: { name: string }[];
  album?: { name?: string };
  cover?: string;
  duration: number;
  source?: string;
}): MfMusicItem => ({
  id: track.id,
  platform: track.source ?? "",
  title: track.title,
  artist: track.artists?.map((a) => a.name).join(", "),
  album: track.album?.name,
  artwork: track.cover,
  duration: Math.floor(track.duration / 1000),
});

/**
 * 将 MusicFree IMusicItem 转换为宿主可识别的归一化对象
 * 渲染端拿到后再映射为 Track
 */
export const mfMusicItemToTrackFields = (item: MfMusicItem): {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  duration: number;
  platform: string;
  url?: string;
} => ({
  id: item.id,
  title: item.title,
  artist: item.artist ?? "",
  album: item.album,
  artwork: item.artwork,
  duration: (item.duration ?? 0) * 1000,
  platform: item.platform,
  url: item.url,
});
