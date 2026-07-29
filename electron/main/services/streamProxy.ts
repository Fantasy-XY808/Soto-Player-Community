/**
 * 本地 HTTP 流代理服务器
 *
 * 职责：
 *   为需要自定义请求头（Referer / User-Agent / Cookie 等）的远端音频 URL
 *   提供一个本地回环入口，让原生音频引擎无需感知 headers 即可拉流。
 *
 * 背景：
 *   原生音频引擎 AudioPlayer.load(source, autoPlay) 仅接受纯 URL，不支持
 *   自定义请求头。MusicFree 插件返回的部分高音质 URL 在缺少 Referer / UA
 *   时会被源站降级或拒绝（403 / 302 到低音质流）。本代理在主进程内统一注入
 *   这些 headers，把远端流转发给 127.0.0.1 的本地入口，引擎只需 load 本地
 *   代理 URL 即可拿到正确音质。
 *
 * 生命周期：
 *   - app.whenReady 时调用 init() 启动，监听 127.0.0.1:0（随机端口）
 *   - 每次播放解析时调用 registerStream() 拿到一个 token URL
 *   - token 10 分钟 TTL，过期自动清理，避免内存泄漏
 *   - app 退出前调用 dispose() 关闭服务器
 *
 * 性能：
 *   - 127.0.0.1 回环无网络往返，单次额外延迟 < 1ms
 *   - 流式转发（Readable.fromWeb → res），不缓冲完整内容，内存占用恒定
 *   - 支持 Range 请求透传，引擎 seek 时能正确拉到对应字节范围
 */

import http from "node:http";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { coreLog } from "@main/utils/logger";
import { overseasFetch } from "@main/services/proxyDispatcher";

/** 单个 token 的存活时间：10 分钟
 *
 *  与 musicfree-runtime urlCache 的 30 分钟 TTL 不同，token 寿命更短：
 *  - 一首歌典型时长 3-5 分钟，10 分钟足以覆盖整曲 + 一次 seek 回放
 *  - 切歌后旧 token 立即可被回收，避免 Map 无限增长
 *  - 若用户暂停很久后继续，token 过期会重新走 resolveTrackSource，URL 也会重新解析
 */
const TOKEN_TTL_MS = 10 * 60 * 1000;

/** 过期清理扫描间隔 */
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface StreamEntry {
  /** 远端真实音频 URL */
  url: string;
  /** 注入到上游请求的自定义 headers（Referer / Cookie / 自定义 UA 等） */
  headers?: Record<string, string>;
  /** 独立 User-Agent，优先级高于 headers["User-Agent"] */
  userAgent?: string;
  /** 过期时间戳（ms） */
  expiresAt: number;
}

/** token → 流条目 */
const tokenMap = new Map<string, StreamEntry>();

let server: http.Server | null = null;
let baseUrl = "";
let cleanupTimer: NodeJS.Timeout | null = null;

/** init 的 Promise 缓存：registerStream 在 server 未就绪时 await 它，避免渲染层首次调用时拿到空 baseUrl */
let initPromise: Promise<void> | null = null;

/**
 * 处理代理请求
 *
 * 流程：
 *   1. 解析 token，查找对应的远端 URL + headers
 *   2. 透传 Range 请求头（引擎 seek 时会用）
 *   3. fetch 远端，流式 pipe 回响应
 *   4. 上游失败时返回 502，让引擎走错误处理路径
 */
const handleRequest = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> => {
  try {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const token = reqUrl.searchParams.get("token");
    if (!token) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing token");
      return;
    }
    const entry = tokenMap.get(token);
    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Token not found or expired");
      return;
    }

    // 构造上游请求头
    const upstreamHeaders: Record<string, string> = { ...(entry.headers ?? {}) };
    if (entry.userAgent) {
      upstreamHeaders["User-Agent"] = entry.userAgent;
    }
    // 透传 Range 请求头，支持引擎 seek 拉特定字节范围
    const range = req.headers.range;
    if (range) {
      upstreamHeaders["Range"] = Array.isArray(range) ? range[0] : range;
    }

    // 用 overseasFetch：与音频引擎 setProxy 行为一致，
    // 用户配了系统代理时自动走代理 dispatcher（Clash / 自建 HTTP / SOCKS5），
    // 关闭代理时等同于 Node 原生 fetch 直连。
    // 这样海外源 URL 也能通过 streamProxy 正常拉流，不会因代理缺失而失败。
    const upstream = await overseasFetch(entry.url, {
      headers: upstreamHeaders,
      // redirect: "follow" 让 fetch 自动跟随 302，避免代理层手动处理 Location
      redirect: "follow",
    });

    // 转发上游响应头（仅剔除 hop-by-hop 头）
    // content-length 保留：音频引擎依赖它确定流长度与 seek 边界；
    //   若上游用 chunked（无 content-length），Node 会自动改用 chunked 编码，无碍
    const respHeaders: Record<string, string | string[]> = {};
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // hop-by-hop / 由 Node 自行管理的头不转发
      if (
        lower === "transfer-encoding" ||
        lower === "connection" ||
        lower === "keep-alive"
      ) {
        return;
      }
      respHeaders[key] = value;
    });

    res.writeHead(upstream.status, respHeaders);

    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body as never);
      nodeStream.pipe(res);
      // 客户端断开时主动中止上游，避免连接泄漏
      res.on("close", () => {
        try {
          nodeStream.destroy();
        } catch {
          // 忽略销毁错误
        }
      });
    } else {
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
    }
    res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** 扫描并清理过期 token */
const cleanupExpired = (): void => {
  const now = Date.now();
  let removed = 0;
  for (const [token, entry] of tokenMap) {
    if (entry.expiresAt < now) {
      tokenMap.delete(token);
      removed++;
    }
  }
  if (removed > 0) {
    coreLog.debug(`[streamProxy] 清理 ${removed} 个过期 token，当前 ${tokenMap.size} 个活跃`);
  }
};

/**
 * 启动代理服务器
 *
 * 监听 127.0.0.1:0（随机端口），避免与其他进程冲突。
 * 启动后 baseUrl 形如 `http://127.0.0.1:54321`，供 registerStream 拼接。
 *
 * 多次调用幂等：返回同一个 Promise，避免重复 listen 导致 EADDRINUSE。
 */
export const init = (): Promise<void> => {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (server) return;
    server = http.createServer(handleRequest);
    await new Promise<void>((resolve, reject) => {
      server!.listen(0, "127.0.0.1", () => resolve());
      server!.on("error", reject);
    });
    const addr = server.address();
    if (addr && typeof addr === "object") {
      baseUrl = `http://127.0.0.1:${addr.port}`;
      coreLog.info(`[streamProxy] 启动于 ${baseUrl}`);
    } else {
      throw new Error("[streamProxy] 无法获取监听地址");
    }
    cleanupTimer = setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
    // 不阻止进程退出
    if (cleanupTimer.unref) cleanupTimer.unref();
  })();
  return initPromise;
};

/**
 * 注册一个需要 headers 的远端 URL，返回本地代理 URL
 *
 * 渲染层调用此 IPC，把 MusicFree 解析结果中的 (url, headers, userAgent) 注册到代理，
 * 拿到的 token URL 可直接喂给 player:load 或 cache.song.fetch。
 *
 * 若代理服务器尚未就绪（极端情况下渲染层在主进程启动早期调用），会先 await init。
 *
 * @param url - 远端真实音频 URL
 * @param headers - 注入到上游请求的自定义 headers
 * @param userAgent - 独立 User-Agent（优先于 headers["User-Agent"]）
 * @returns 本地代理 URL，形如 `http://127.0.0.1:port/?token=xxx`
 */
export const registerStream = async (
  url: string,
  headers?: Record<string, string>,
  userAgent?: string,
): Promise<string> => {
  if (!url) throw new Error("registerStream: url is required");
  if (!baseUrl) {
    // 极端情况：渲染层在 init 完成前调用，await 一下即可
    await init();
    if (!baseUrl) {
      throw new Error("registerStream: streamProxy 初始化失败");
    }
  }
  const token = randomBytes(16).toString("hex");
  tokenMap.set(token, {
    url,
    headers,
    userAgent,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return `${baseUrl}/?token=${token}`;
};

/** 关闭代理服务器（app 退出时调用） */
export const dispose = (): void => {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  tokenMap.clear();
  if (server) {
    server.close();
    server = null;
    baseUrl = "";
    initPromise = null;
  }
};
