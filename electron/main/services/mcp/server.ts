/**
 * Soto Player MCP 服务端
 *
 * 注册 16 个工具（播放控制 + 曲库检索 + 在线搜索 + 队列管理）+ 2 个资源，
 * 供外部 AI Agent 通过 Model Context Protocol 远程控制本播放器。
 *
 * 工具列表：
 *   1. get_playback_status  - 获取播放状态/进度/音量
 *   2. get_now_playing      - 获取当前曲目轻量快照
 *   3. play                 - 恢复播放
 *   4. pause                - 暂停
 *   5. stop                 - 停止
 *   6. next_track           - 下一曲
 *   7. previous_track       - 上一曲
 *   8. seek                 - 跳转到指定毫秒
 *   9. set_volume           - 设置音量（0~1）
 *  10. play_track           - 播放指定 Track（来自搜索/曲库）
 *  11. set_play_mode        - 设置循环/随机模式
 *  12. add_to_queue         - 批量加入队列
 *  13. search_library       - 搜索本地曲库
 *  14. search_online_songs  - 搜索网易云/QQ/酷狗
 *  15. get_random_tracks    - 随机获取曲目
 *  16. list_albums          - 列出专辑
 *  17. list_artists         - 列出艺术家
 *
 * 资源：
 *   - soto://now-playing      - 当前播放轻量快照
 *   - soto://library/summary  - 曲库摘要（歌曲/专辑/艺术家数量）
 */

import { appVersion } from "@main/utils/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPlayer } from "@main/services/engine";
import { playerControl } from "@main/services/playerControl";
import * as nowPlaying from "@main/services/nowPlaying";
import type { Track } from "@shared/types/player";
import {
  getAlbumList,
  getArtistList,
  getRandomTracks,
  getTrackCount,
  searchTracks,
} from "@main/database";
import { toMs } from "@main/utils/time";
import { createMcpEndpoint as createHttpEndpoint, type McpEndpoint } from "./endpoint";
import { searchOnlineTracks } from "./onlineSearch";

/** 把任意值包成 MCP text content（JSON 序列化） */
const jsonContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/**
 * 读取当前播放模式（repeat / shuffle）
 *
 * 托盘服务只在主进程内维护模式状态，渲染层为权威源；
 * MCP 服务运行在主进程，无法直接拿到渲染层状态。
 * 这里返回 unknown 让调用方自行处理，避免与渲染层不一致。
 */
const readPlayMode = (): { repeat: unknown; shuffle: unknown } => ({
  repeat: null,
  shuffle: null,
});

/** 创建并注册 Soto Player MCP 能力 */
const createServer = (): McpServer => {
  const server = new McpServer({
    name: "soto-player",
    version: appVersion,
  });

  // —— 状态读取工具 ——

  server.registerTool(
    "get_playback_status",
    {
      title: "获取播放状态",
      description: "获取 Soto Player 当前播放状态、进度、时长和音量。时间单位为毫秒",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    () => {
      const status = getPlayer().getStatus();
      const playMode = readPlayMode();
      return jsonContent({
        state: status.state,
        positionMs: toMs(status.position),
        durationMs: toMs(status.duration),
        volume: status.volume,
        isFinished: status.isFinished,
        repeat: playMode.repeat,
        shuffle: playMode.shuffle,
      });
    },
  );

  server.registerTool(
    "get_now_playing",
    {
      title: "获取当前歌曲",
      description: "获取当前歌曲和播放位置的轻量快照，不包含完整歌词正文",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    () => {
      const snap = nowPlaying.lightSnapshot();
      const status = getPlayer().getStatus();
      // 补齐 duration（lightSnapshot 内未携带）
      return jsonContent({
        ...snap,
        durationMs: toMs(status.duration),
      });
    },
  );

  // —— 播放控制工具 ——

  const controls = [
    ["play", "继续播放", () => playerControl.play()],
    ["pause", "暂停播放", () => playerControl.pause()],
    ["stop", "停止播放", () => playerControl.stop()],
    ["next_track", "播放下一曲", () => playerControl.next()],
    ["previous_track", "播放上一曲", () => playerControl.prev()],
  ] as const;
  for (const [name, description, run] of controls) {
    server.registerTool(
      name,
      {
        title: description,
        description: `${description}。`,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      () => {
        run();
        return jsonContent({ ok: true });
      },
    );
  }

  server.registerTool(
    "seek",
    {
      title: "跳转播放位置",
      description: "将当前歌曲跳转到指定毫秒位置",
      inputSchema: { positionMs: z.number().finite().min(0) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ positionMs }) => {
      await playerControl.seek(positionMs);
      return jsonContent({ ok: true, positionMs });
    },
  );

  server.registerTool(
    "set_volume",
    {
      title: "设置音量",
      description: "设置播放器音量，取值范围为 0 到 1",
      inputSchema: { volume: z.number().finite().min(0).max(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ volume }) => {
      playerControl.setVolume(volume);
      return jsonContent({ ok: true, volume });
    },
  );

  server.registerTool(
    "play_track",
    {
      title: "播放指定曲目",
      description:
        "将指定曲目加入播放队列并立即播放。传入完整的 Track 对象（通常来自 search_library、search_online_songs 或 get_random_tracks 的返回值）",
      inputSchema: { track: z.record(z.string(), z.any()) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ track }) => {
      if (!track || typeof track.id !== "string") {
        throw new Error("Invalid track object.");
      }
      playerControl.playTrack(track as Track);
      return jsonContent({ ok: true, id: track.id });
    },
  );

  server.registerTool(
    "set_play_mode",
    {
      title: "设置播放模式",
      description:
        "设置播放器的循环模式或随机模式。repeat: 循环模式 (off/list/one), shuffle: 随机播放 (on/off)",
      inputSchema: {
        repeat: z.enum(["off", "list", "one"]).optional(),
        shuffle: z.enum(["on", "off"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ repeat, shuffle }) => {
      if (repeat) {
        playerControl.setRepeat(repeat);
      }
      if (shuffle) {
        playerControl.setShuffle(shuffle);
      }
      return jsonContent({ ok: true, repeat, shuffle });
    },
  );

  server.registerTool(
    "add_to_queue",
    {
      title: "添加到播放队列",
      description: "批量添加最多 50 个完整 Track 到当前歌曲之后或队列末尾，不立即播放",
      inputSchema: {
        tracks: z.array(z.record(z.string(), z.any())).min(1).max(50),
        position: z.enum(["next", "end"]).default("next"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ tracks, position }) => {
      if (tracks.some((track) => typeof track.id !== "string")) {
        throw new Error("Invalid track object.");
      }
      playerControl.addToQueue(tracks as Track[], position);
      return jsonContent({ ok: true, count: tracks.length, position });
    },
  );

  // —— 曲库检索工具 ——

  server.registerTool(
    "search_library",
    {
      title: "搜索本地曲库",
      description: "按歌曲名、艺术家或专辑搜索本地曲库，返回匹配的曲目",
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ query, limit }) => {
      const matches = searchTracks(query);
      return jsonContent({
        total: matches.length,
        tracks: matches.slice(0, limit),
      });
    },
  );

  server.registerTool(
    "search_online_songs",
    {
      title: "搜索在线歌曲",
      description: "按关键词搜索网易云音乐、QQ 音乐或酷狗音乐，返回可直接传给 play_track 的曲目",
      inputSchema: {
        platform: z.enum(["netease", "qqmusic", "kugou"]),
        query: z.string().trim().min(1).max(200),
        page: z.number().int().min(1).max(100).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ platform, query, page, limit }) =>
      jsonContent(await searchOnlineTracks(platform, query, page, limit)),
  );

  server.registerTool(
    "get_random_tracks",
    {
      title: "随机获取曲目",
      description: "从本地曲库随机返回若干首曲目",
      inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
      annotations: { readOnlyHint: true, idempotentHint: false },
    },
    ({ limit }) => jsonContent({ tracks: getRandomTracks(limit) }),
  );

  server.registerTool(
    "list_albums",
    {
      title: "列出专辑",
      description: "列出本地曲库中的专辑摘要，最多返回 100 条",
      inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ limit }) => {
      const albums = getAlbumList();
      return jsonContent({
        total: albums.length,
        albums: albums.slice(0, limit).map(({ cover: _cover, ...album }) => album),
      });
    },
  );

  server.registerTool(
    "list_artists",
    {
      title: "列出艺术家",
      description: "列出本地曲库中的艺术家摘要，最多返回 100 条",
      inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ limit }) => {
      const artists = getArtistList();
      return jsonContent({
        total: artists.length,
        artists: artists.slice(0, limit).map(({ cover: _cover, ...artist }) => artist),
      });
    },
  );

  // —— 资源 ——

  server.registerResource(
    "now-playing",
    "soto://now-playing",
    {
      title: "Soto Player 当前播放",
      description: "不含完整歌词正文的当前歌曲与播放位置轻量快照",
      mimeType: "application/json",
    },
    (uri) => {
      const snap = nowPlaying.lightSnapshot();
      const status = getPlayer().getStatus();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ ...snap, durationMs: toMs(status.duration) }),
          },
        ],
      };
    },
  );

  server.registerResource(
    "library-summary",
    "soto://library/summary",
    {
      title: "Soto Player 曲库摘要",
      description: "本地曲库的歌曲、专辑和艺术家数量",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            tracks: getTrackCount(),
            albums: getAlbumList().length,
            artists: getArtistList().length,
          }),
        },
      ],
    }),
  );

  return server;
};

/** 创建 Soto Player MCP HTTP 端点 */
export const createMcpEndpoint = (): McpEndpoint => createHttpEndpoint(createServer);

export type { McpEndpoint } from "./endpoint";
