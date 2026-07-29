# MCP（Model Context Protocol）

Soto Player 内置一个 MCP 服务端，允许外部 AI Agent 通过 [Model Context Protocol](https://modelcontextprotocol.io/) 远程控制本播放器：检索曲库、搜索在线歌曲、控制播放、管理队列。

## 启用方式

MCP 端点随「外部 API」一起启动，需先在 `设置 → 高级 → 外部 API` 中：

1. 打开「启用外部 API」总开关；
2. 记下端口（默认 `3660`），需要时开启「允许局域网访问」。

服务监听 `http://127.0.0.1:{port}/mcp`（局域网模式为 `http://0.0.0.0:{port}/mcp`）。MCP 端点复用同一端口，无需单独配置。

## 传输方式

采用 **Streamable HTTP** 传输：

- 客户端以 `POST /mcp` 发送 JSON-RPC 请求，首条须为 `initialize`；
- 服务端在响应中返回 `Mcp-Session-Id`，后续请求需附带该头；
- `DELETE /mcp` 用于终结会话；
- 单会话空闲上限 30 分钟，最多并发 8 个会话，超过后驱逐最旧。

## 工具列表

### 播放状态

| 工具 | 说明 | 入参 |
| --- | --- | --- |
| `get_playback_status` | 获取播放状态/进度/音量 | — |
| `get_now_playing` | 当前曲目轻量快照（不含完整歌词） | — |

### 播放控制

| 工具 | 说明 | 入参 |
| --- | --- | --- |
| `play` | 恢复播放 | — |
| `pause` | 暂停 | — |
| `stop` | 停止 | — |
| `next_track` | 下一曲 | — |
| `previous_track` | 上一曲 | — |
| `seek` | 跳转到指定毫秒 | `positionMs: number` |
| `set_volume` | 设置音量（0~1） | `volume: number` |
| `play_track` | 播放指定 Track（来自搜索/曲库结果） | `track: Track` |
| `set_play_mode` | 设置循环/随机模式 | `repeat?: "off" \| "list" \| "one"`，`shuffle?: "on" \| "off"` |
| `add_to_queue` | 批量加入队列（≤50） | `tracks: Track[]`，`position?: "next" \| "end"` |

### 曲库检索

| 工具 | 说明 | 入参 |
| --- | --- | --- |
| `search_library` | 搜索本地曲库 | `query: string`，`limit?: number` |
| `search_online_songs` | 搜索网易云 / QQ / 酷狗 | `platform: "netease" \| "qqmusic" \| "kugou"`，`query: string`，`page?: number`，`limit?: number` |
| `get_random_tracks` | 随机获取曲目 | `limit?: number` |
| `list_albums` | 列出专辑摘要 | `limit?: number` |
| `list_artists` | 列出艺术家摘要 | `limit?: number` |

## 资源

| URI | 说明 |
| --- | --- |
| `soto://now-playing` | 当前播放轻量快照（含播放位置、时长，不含歌词正文） |
| `soto://library/summary` | 曲库摘要（歌曲 / 专辑 / 艺术家数量） |

## 客户端配置示例

### Claude Desktop

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "soto-player": {
      "url": "http://127.0.0.1:3660/mcp"
    }
  }
}
```

### 通用 SDK 调用

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://127.0.0.1:3660/mcp"),
);
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

// 拿到当前播放状态
const status = await client.callTool({ name: "get_playback_status" });

// 搜索本地曲库并播放第一首
const searchResult = await client.callTool({
  name: "search_library",
  arguments: { query: "周杰伦", limit: 5 },
});
const { tracks } = JSON.parse(searchResult.content[0].text);

if (tracks.length > 0) {
  await client.callTool({ name: "play_track", arguments: { track: tracks[0] } });
}
```

## 安全提示

- MCP 端点本身**无鉴权**，关闭「允许局域网访问」时仅本机可访问；
- 如需开放给局域网内 AI Agent，请确认所处网络可信；
- 关闭「外部 API」总开关会一并停止 MCP 端点。

## 实现位置

| 模块 | 路径 |
| --- | --- |
| 工具/资源注册 | `electron/main/services/mcp/server.ts` |
| HTTP 端点（会话/传输） | `electron/main/services/mcp/endpoint.ts` |
| 在线搜索归一化 | `electron/main/services/mcp/onlineSearch.ts` |
