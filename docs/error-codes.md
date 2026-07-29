# 错误码对照表（多语言）

> 本文档列出 Soto Player-Community 中所有错误码及其含义。
> 错误码统一格式为 `[ERR-XXXXX-X]`，其中：
> - `XXXXX` 为 5 位模块+错误编号
> - 末尾 `-X` 为子场景标识（同一错误的不同触发点）

## 编码规范

### 格式

```
[ERR-XXXXX-X]
```

- `ERR-` 固定前缀
- `XXXXX` 5 位数字，前 1-2 位标识模块，后 3-4 位为序号
- `-X` 可选的子场景字母（A-Z），区分同一错误码在不同函数/位置触发

### 模块划分

| 模块代码 | 范围 | 模块名称 |
|---------|------|---------|
| 10000-10999 | 10XXX | 更新器（updater） |
| 11000-11999 | 11XXX | Qobuz 音源接入（qobuz） |
| 12000-12999 | 12XXX | Tidal 音源接入（tidal） |
| 13000-13999 | 13XXX | mora / Internet Archive / 2L 等第三批音源（reserved） |
| 20000-20999 | 20XXX | 音频引擎（audio-engine） |
| 30000-30999 | 30XXX | 播放器（player） |
| 40000-40999 | 40XXX | 歌词（lyrics） |
| 50000-50999 | 50XXX | 下载（download） |
| 60000-60999 | 60XXX | 解灰源（unblock） |
| 70000-70999 | 70XXX | 视频渲染（render-video） |
| 80000-80999 | 80XXX | IPC 通信（ipc） |
| 90000-90999 | 90XXX | 网络/文件系统（net/fs） |

> Internet Archive 占用 13001-13006。
> mora / prostudiomasters / 2L 占用 14XXX 段位：mora 占 14100-14199，prostudiomasters 占 14200-14299，2L 占 14000-14099。

### 严重等级

| 等级 | 含义 | 日志方法 |
|------|------|---------|
| INFO | 流程关键节点（启动、完成、状态变更） | `log.info()` |
| DEBUG | 调试信息（细节流转） | `log.debug()` |
| WARN | 异常但可恢复（任务不存在、参数缺失） | `log.warn()` |
| ERROR | 错误，影响当前操作 | `log.error()` |

---

## Qobuz 模块（11XXX）

### 11001 — 搜索成功

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11001-A | Qobuz 搜索成功: keywords=`{keywords}` page=`{page}` hits=`{hits}`/`{total}` | Qobuz search succeeded: keywords=`{keywords}` page=`{page}` hits=`{hits}`/`{total}` |

### 11002 — 搜索失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11002-A | Qobuz 搜索失败: keywords=`{keywords}` | Qobuz search failed: keywords=`{keywords}` |

### 11003 — Preview 命中

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11003-A | Qobuz preview 命中: trackId=`{trackId}` → `{preview}`... | Qobuz preview hit: trackId=`{trackId}` → `{preview}`... |

### 11004 — Preview 为空

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11004-A | Qobuz preview 为空: trackId=`{trackId}` | Qobuz preview empty: trackId=`{trackId}` |

### 11005 — 无可用 app_secret

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11005-A | Qobuz 无可用 app_secret 或全部候选已失败: trackId=`{trackId}` | Qobuz no app_secret available or all candidates failed: trackId=`{trackId}` |

### 11006 — getFileUrl 成功

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11006-A | Qobuz getFileUrl 成功: trackId=`{trackId}` format=`{formatId}` | Qobuz getFileUrl succeeded: trackId=`{trackId}` format=`{formatId}` |

### 11007 — getFileUrl 返回空 url

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11007-A | Qobuz getFileUrl 返回空 url: trackId=`{trackId}` format=`{formatId}` secret=`{secret}` | Qobuz getFileUrl returned empty url: trackId=`{trackId}` format=`{formatId}` secret=`{secret}` |

### 11008 — getFileUrl 失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11008-A | Qobuz getFileUrl 签名失败，切换 secret 重试: trackId=`{trackId}` failed=`{secret}` reason=`{reason}` | Qobuz getFileUrl signature failed, switching secret to retry: trackId=`{trackId}` failed=`{secret}` reason=`{reason}` |
| ERR-11008-A | Qobuz getFileUrl 失败（非签名问题）: trackId=`{trackId}` format=`{formatId}` reason=`{reason}` | Qobuz getFileUrl failed (non-signature issue): trackId=`{trackId}` format=`{formatId}` reason=`{reason}` |

### 11009 — getFileUrl 全部 format 失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11009-A | Qobuz getFileUrl 全部 format 失败，回落 preview: trackId=`{trackId}` | Qobuz getFileUrl all formats failed, falling back to preview: trackId=`{trackId}` |

### 11010 — Preview 拉取异常

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11010-A | Qobuz preview 拉取异常: trackId=`{trackId}` | Qobuz preview fetch error: trackId=`{trackId}` |

### 11011 — song_url 全部失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11011-A | Qobuz song_url 全部失败: trackId=`{trackId}` | Qobuz song_url all failed: trackId=`{trackId}` |

### 11012 — 原生歌词命中

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11012-A | Qobuz 原生歌词命中: trackId=`{trackId}` len=`{len}` | Qobuz native lyric hit: trackId=`{trackId}` len=`{len}` |

### 11013 — 原生歌词拉取失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11013-A | Qobuz 原生歌词拉取失败: trackId=`{trackId}` | Qobuz native lyric fetch failed: trackId=`{trackId}` |

### 11014 — 歌词未命中

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11014-A | Qobuz 歌词未命中，待第三方源接入: trackId=`{trackId}` albumId=`{albumId}` isrc=`{isrc}` | Qobuz lyric not found, awaiting third-party source: trackId=`{trackId}` albumId=`{albumId}` isrc=`{isrc}` |

### 11021 — app_secret 格式非法

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11021-A | app_secret 格式非法（非 32 位十六进制）: source=`{source}` | app_secret format invalid (not 32-char hex): source=`{source}` |

### 11022 — 活跃 app_secret 选定

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11022-A | Qobuz 活跃 app_secret 选定: source=`{source}` appId=`{appId}` | Qobuz active app_secret selected: source=`{source}` appId=`{appId}` |

### 11023 — 无可用 app_secret

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11023-A | Qobuz 无可用 app_secret（候选共 `{count}` 个均未通过校验） | Qobuz no app_secret available (`{count}` candidates all failed validation) |

### 11024 — app_secret 切换

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11024-A | Qobuz app_secret 切换: 剔除失败 secret 后 → source=`{source}` | Qobuz app_secret switched: removed failed secret → source=`{source}` |

### 11025 — app_secret 全部候选均已失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11025-A | Qobuz app_secret 全部候选均已失败，无可用 secret | Qobuz all app_secret candidates failed, no available secret |

### 11026 — token 已加密落盘

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11026-A | Qobuz token 已加密落盘: nickname=`{nickname}` subscription=`{subscription}` | Qobuz token encrypted and saved: nickname=`{nickname}` subscription=`{subscription}` |

### 11027 — 写入 qobuz.json 失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11027-A | 写入 qobuz.json 失败: `{err}` | Failed to write qobuz.json: `{err}` |

### 11028 — token 已清除

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11028-A | Qobuz token 已清除 | Qobuz token cleared |

### 11029 — 删除 qobuz.json 失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11029-A | 删除 qobuz.json 失败: `{err}` | Failed to delete qobuz.json: `{err}` |

### 11030 — 用户自定义 app_secret 已落盘

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11030-A | Qobuz 用户自定义 app_secret 已落盘: count=`{count}` | Qobuz user app_secret saved: count=`{count}` |

### 11031 — 写入 qobuz-secrets.json 失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11031-A | 写入 qobuz-secrets.json 失败: `{err}` | Failed to write qobuz-secrets.json: `{err}` |

### 11032 — 用户名密码登录未实现

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-11032-A | Qobuz 用户名密码登录未实现（impl1g 阶段） | Qobuz username/password login not implemented (impl1g stage) |

---

## Tidal 模块（12XXX）

### 12001 — 搜索成功

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12001-A | Tidal 搜索成功: keywords=`{keywords}` page=`{page}` hits=`{hits}`/`{total}` | Tidal search succeeded: keywords=`{keywords}` page=`{page}` hits=`{hits}`/`{total}` |

### 12002 — 搜索失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12002-A | Tidal 搜索失败: keywords=`{keywords}` | Tidal search failed: keywords=`{keywords}` |

### 12003 — 取流成功

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12003-A | Tidal 取流成功: trackId=`{trackId}` mimeType=`{mimeType}` bitDepth=`{bitDepth}` sr=`{sr}` | Tidal stream URL resolved: trackId=`{trackId}` mimeType=`{mimeType}` bitDepth=`{bitDepth}` sr=`{sr}` |

### 12004 — 取流失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12004-A | Tidal 取流失败: trackId=`{trackId}` | Tidal stream URL resolve failed: trackId=`{trackId}` |

### 12005 — manifest 解析失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12005-A | Tidal manifest 解析失败或无 url: trackId=`{trackId}` | Tidal manifest parse failed or no url: trackId=`{trackId}` |

### 12006 — 歌词未实现

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12006-A | Tidal 歌词未命中，待第三方源接入: trackId=`{trackId}` isrc=`{isrc}` | Tidal lyrics not found, awaiting third-party source: trackId=`{trackId}` isrc=`{isrc}` |

### 12021 — OAuth 启动

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12021-A | Tidal OAuth 流程已启动: state=`{state}`... verifier_len=`{len}` | Tidal OAuth flow started: state=`{state}`... verifier_len=`{len}` |

### 12022 — OAuth callback 等待超时

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12022-A | Tidal OAuth 等待 callback 失败/超时: `{message}` | Tidal OAuth callback wait failed/timed out: `{message}` |

### 12023 — token 交换

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12023-A | Tidal token 交换成功/失败: expires_in=`{expires_in}`s | Tidal token exchange succeeded/failed: expires_in=`{expires_in}`s |

### 12024 — token 刷新成功

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12024-A | Tidal token 刷新成功: expires_in=`{expires_in}`s | Tidal token refresh succeeded: expires_in=`{expires_in}`s |

### 12025 — token 刷新失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12025-A | Tidal token 刷新失败: `{err}` | Tidal token refresh failed: `{err}` |

### 12026 — token 加密落盘成功

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12026-A | Tidal token 已加密落盘: nickname=`{nickname}` subscription=`{subscription}` | Tidal token encrypted and saved: nickname=`{nickname}` subscription=`{subscription}` |

### 12027 — token 落盘失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12027-A | 写入 tidal.json 失败: `{err}` | Failed to write tidal.json: `{err}` |

### 12028 — token 清除

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12028-A | Tidal token 已清除 | Tidal token cleared |

### 12029 — token 清除失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12029-A | 删除 tidal.json 失败: `{err}` | Failed to delete tidal.json: `{err}` |

### 12030 — fetchStatus 成功

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12030-A | Tidal fetchStatus 成功: nickname=`{nickname}` subscription=`{subscription}` | Tidal fetchStatus succeeded: nickname=`{nickname}` subscription=`{subscription}` |

### 12031 — 401 token 失效

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12031-A | Tidal 401 token 失效，触发刷新重试 | Tidal 401 token invalid, triggering refresh retry |

### 12032 — 403 订阅等级不足

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12032-A | Tidal 403 订阅等级不足: trackId=`{trackId}` | Tidal 403 subscription tier insufficient: trackId=`{trackId}` |

### 12033 — HTTP 错误

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-12033-A | Tidal HTTP 错误: status=`{status}` | Tidal HTTP error: status=`{status}` |

---

## Internet Archive 模块（13XXX）

### 13001 — 搜索成功

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-13001-A | Archive 搜索成功: keywords=`{keywords}` page=`{page}` hits=`{hits}`/`{total}` | Archive search succeeded: keywords=`{keywords}` page=`{page}` hits=`{hits}`/`{total}` |

### 13002 — 搜索失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-13002-A | Archive 搜索失败: keywords=`{keywords}` | Archive search failed: keywords=`{keywords}` |

### 13003 — metadata 拉取成功

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-13003-A | Archive metadata 命中: trackId=`{trackId}` file=`{file}` size=`{size}` format=`{format}` | Archive metadata hit: trackId=`{trackId}` file=`{file}` size=`{size}` format=`{format}` |

### 13004 — metadata 拉取失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-13004-A | Archive metadata 拉取失败: trackId=`{trackId}` | Archive metadata fetch failed: trackId=`{trackId}` |

### 13005 — 无可用音频文件

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-13005-A | Archive 无可用音频文件: trackId=`{trackId}` files=`{files}` | Archive no playable audio file: trackId=`{trackId}` files=`{files}` |

### 13006 — 歌词未实现

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-13006-A | Archive 歌词未实现: trackId=`{trackId}` | Archive lyrics not implemented: trackId=`{trackId}` |

---

## 2L 模块（14XXX，14000-14099）

> 2L 是挪威 Hi-Res 厂牌，提供免费样品（DXD/DSD/FLAC），无需登录。
> 2L 仅个人试听模式，禁止曲库收录。

### 14001 — 搜索结果

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-14001-A | 2L 样品索引解析: keywords=`{keywords}` hits=`{hits}` | 2L sample index parsed: keywords=`{keywords}` hits=`{hits}` |
| ERR-14001-B | 2L Test Bench 已下线或解析失败: keywords=`{keywords}` | 2L Test Bench offline or parse failed: keywords=`{keywords}` |

### 14002 — 取流结果

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-14002-A | 2L 取流成功: trackId=`{trackId}` url=`{url}` | 2L stream resolved: trackId=`{trackId}` url=`{url}` |
| ERR-14002-B | 2L 取流失败: trackId=`{trackId}` | 2L stream failed: trackId=`{trackId}` |

---

## mora 模块（14XXX，14100-14199）

> mora.jp 是 Sony Music Japan 旗下 Hi-Res 商店，Nuxt.js SSR 应用。
> 试听路径（AAC）免登录；完整 Hi-Res 母带需在 mora.jp 购买后用 mora Downloader 客户端下载（D 级，不接入）。
> 可选付费登录：用户配置 cookie 后可访问购买曲目元数据。

### 14101 — 搜索结果

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-14101-A | mora 搜索成功: keywords=`{keywords}` hits=`{hits}` | mora search succeeded: keywords=`{keywords}` hits=`{hits}` |
| ERR-14101-B | mora 搜索失败（HTML/NUXT_DATA 解析异常）: keywords=`{keywords}` | mora search failed (HTML/NUXT_DATA parse error): keywords=`{keywords}` |

### 14102 — 取流结果

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-14102-A | mora 试听取流成功: trackId=`{trackId}` | mora preview stream resolved: trackId=`{trackId}` |
| ERR-14102-B | mora 已检测付费登录凭据，但完整流不接入（需 mora Downloader 客户端下载）: trackId=`{trackId}` | mora paid credentials detected, but full stream not supported (requires mora Downloader client): trackId=`{trackId}` |
| ERR-14102-C | mora 取流失败: trackId=`{trackId}` | mora stream failed: trackId=`{trackId}` |

---

## prostudiomasters 模块（14XXX，14200-14299）

> prostudiomasters.com 是专业母带商店，提供 24bit/96kHz+ FLAC。
> 试听路径（2 分钟 MP3）免登录；完整流需付费购买 + 用户配置 session token。
> AGPL 合规：用户自带凭据访问自己付费的内容，应用只做 HTTP 代理，不内置签名算法。
> 完整流端点 URL 通过多端点候选扫描策略覆盖常见 RESTful 风格（`/api/track/{id}`、`/api/track/get?id=`、`/api/v1/track/{id}`、`/api/v1/track/get?id=`），全部失败时自动回落到 2 分钟 MP3 试听。

### 14201 — 搜索结果

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-14201-A | prostudiomasters 搜索成功: keywords=`{keywords}` hits=`{hits}` | prostudiomasters search succeeded: keywords=`{keywords}` hits=`{hits}` |
| ERR-14201-B | prostudiomasters 搜索失败（HTML/API 解析异常）: keywords=`{keywords}` | prostudiomasters search failed (HTML/API parse error): keywords=`{keywords}` |

### 14202 — 取流结果

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-14202-A | prostudiomasters 试听取流成功: trackId=`{trackId}` | prostudiomasters preview stream resolved: trackId=`{trackId}` |
| ERR-14202-B | prostudiomasters 付费用户取流成功（完整 Hi-Res）: trackId=`{trackId}` | prostudiomasters paid user stream resolved (full Hi-Res): trackId=`{trackId}` |
| ERR-14202-C | prostudiomasters 取流失败: trackId=`{trackId}` | prostudiomasters stream failed: trackId=`{trackId}` |

---

## 视频渲染模块（70XXX）

### 70001 — 窗口创建/关闭

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70001-A | 复用已存在的渲染窗口 | Reusing existing renderer window |
| ERR-70001-B | 创建渲染窗口开始 | Creating renderer window |
| ERR-70001-C | dev 模式加载 URL: `{url}` | Dev mode loading URL: `{url}` |
| ERR-70001-D | 生产模式加载文件: `{file}` | Production mode loading file: `{file}` |
| ERR-70001-E | 渲染窗口已关闭 | Renderer window closed |
| ERR-70001-F | 重置 ready 标志失败: `{err}` | Failed to reset ready flag: `{err}` |
| ERR-70001-G | 创建渲染窗口完成 | Renderer window created |
| ERR-70001-H | 主动关闭渲染窗口 | Actively closing renderer window |
| ERR-70001-I | 启动渲染任务 taskId=`{taskId}` mode=`{mode}` tracks=`{count}` | Starting render task taskId=`{taskId}` mode=`{mode}` tracks=`{count}` |
| ERR-70001-J | 任务已入队 taskId=`{taskId}` queueLen=`{len}` | Task queued taskId=`{taskId}` queueLen=`{len}` |
| ERR-70001-K | 开始执行任务 taskId=`{taskId}` | Starting task execution taskId=`{taskId}` |
| ERR-70001-L | 开始渲染 taskId=`{taskId}` 总数=`{count}` 分辨率=`{res}` 帧率=`{fps}` | Rendering taskId=`{taskId}` total=`{count}` resolution=`{res}` fps=`{fps}` |
| ERR-70001-M | 下发配置到渲染窗口 taskId=`{taskId}` idx=`{i}` audioUrl=`{url}`... | Sending config to renderer taskId=`{taskId}` idx=`{i}` audioUrl=`{url}`... |
| ERR-70001-N | 等待曲目渲染完成 taskId=`{taskId}` idx=`{i}` | Waiting for track render taskId=`{taskId}` idx=`{i}` |
| ERR-70001-O | 曲目渲染完成 taskId=`{taskId}` idx=`{i}` | Track rendered taskId=`{taskId}` idx=`{i}` |
| ERR-70001-P | 任务全部完成 taskId=`{taskId}` 产物=`{count}` 首文件=`{path}` | Task completed taskId=`{taskId}` outputs=`{count}` first=`{path}` |
| ERR-70001-Q | 渲染窗口回报完成 taskId=`{taskId}` | Renderer reported finished taskId=`{taskId}` |
| ERR-70001-R | sendFinished 失败 taskId=`{taskId}` | sendFinished failed taskId=`{taskId}` |

### 70002 — 窗口加载/崩溃

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70002-A | 渲染窗口加载失败 code=`{code}` desc=`{desc}` url=`{url}` | Renderer load failed code=`{code}` desc=`{desc}` url=`{url}` |
| ERR-70002-B | 渲染进程崩溃 reason=`{reason}` exitCode=`{code}` | Renderer process crashed reason=`{reason}` exitCode=`{code}` |
| ERR-70002-C | 渲染进程无响应 | Renderer process unresponsive |

### 70003 — 窗口 ready 超时

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70003-A | 渲染窗口已就绪（复用） | Renderer ready (reused) |
| ERR-70003-B | 等待 did-finish-load... | Waiting for did-finish-load... |
| ERR-70003-C | did-finish-load 已触发 | did-finish-load triggered |
| ERR-70003-D | 等待 ready 信号（最多 `{ms}`ms）... | Waiting for ready signal (max `{ms}`ms)... |
| ERR-70003-E | 渲染窗口 ready 超时（`{ms}`ms） | Renderer window ready timeout after `{ms}`ms |
| ERR-70003-F | 渲染窗口已就绪 | Renderer window ready |
| ERR-70003-G | 收到渲染窗口 ready 信号 | Received renderer ready signal |
| ERR-70003-H | 重置渲染窗口 ready 标志 | Reset renderer ready flag |
| ERR-70003-I | 渲染窗口 onMounted 开始订阅 | Renderer onMounted subscribing |
| ERR-70003-J | 收到 config 事件 taskId=`{taskId}` track=`{title}` | Received config event taskId=`{taskId}` track=`{title}` |
| ERR-70003-K | 收到 cancel 事件 taskId=`{taskId}` | Received cancel event taskId=`{taskId}` |
| ERR-70003-L | 已发送 ready 信号 | Ready signal sent |

### 70004 — 音频 URL 解析/缺失

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70004-A | 曲目无音频 URL taskId=`{taskId}` idx=`{i}` | Track has no audio URL taskId=`{taskId}` idx=`{i}` |
| ERR-70004-B | 无法解析音频源：`{title}` | Cannot resolve audio source: `{title}` |

### 70005 — 音频加载失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70005-A | 渲染窗口回报错误 taskId=`{taskId}` → `{message}` | Renderer reported error taskId=`{taskId}` → `{message}` |
| ERR-70005-B | sendError 失败 taskId=`{taskId}` | sendError failed taskId=`{taskId}` |
| ERR-70005-C | 启动渲染 taskId=`{taskId}` audioUrl=`{url}`... track=`{title}` | Starting render taskId=`{taskId}` audioUrl=`{url}`... track=`{title}` |
| ERR-70005-D | audio 元素已创建 src=`{url}` | Audio element created src=`{url}` |
| ERR-70005-E | Audio element not created | Audio element not created |
| ERR-70005-F | 音频加载失败（`{detail}`） | Audio load failed (`{detail}`) |
| ERR-70005-G | 音频元数据已加载 | Audio metadata loaded |
| ERR-70005-H | AudioContext 已创建 sampleRate=`{rate}` | AudioContext created sampleRate=`{rate}` |
| ERR-70005-I | 音频播放结束 taskId=`{taskId}` | Audio playback ended taskId=`{taskId}` |
| ERR-70005-J | 音频开始播放 taskId=`{taskId}` | Audio started playing taskId=`{taskId}` |

### 70006 — MediaRecorder/Canvas 捕获失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70006-A | Canvas 2D context not available | Canvas 2D context not available |
| ERR-70006-B | Canvas 已创建 `{w}`x`{h}` 封面=`{state}` | Canvas created `{w}`x`{h}` cover=`{state}` |
| ERR-70006-C | MIME 类型不被支持: `{mime}` | MIME type not supported: `{mime}` |
| ERR-70006-D | MediaRecorder 创建失败: `{message}` | MediaRecorder creation failed: `{message}` |
| ERR-70006-E | MediaRecorder 已创建 mimeType=`{mime}` | MediaRecorder created mimeType=`{mime}` |
| ERR-70006-F | MediaRecorder 停止 taskId=`{taskId}` | MediaRecorder stopped taskId=`{taskId}` |
| ERR-70006-G | MediaRecorder 错误 taskId=`{taskId}` | MediaRecorder error taskId=`{taskId}` |
| ERR-70006-H | MediaRecorder 已启动 timeslice=`{ms}`ms | MediaRecorder started timeslice=`{ms}`ms |

### 70007 — 文件写入失败

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70007-A | 创建输出文件: `{path}` | Created output file: `{path}` |
| ERR-70007-B | 创建输出文件失败: `{path}` → `{message}` | Failed to create output file: `{path}` → `{message}` |
| ERR-70007-C | 文件写入错误: `{path}` → `{message}` | File write error: `{path}` → `{message}` |
| ERR-70007-D | 收到分片但无写入流 taskId=`{taskId}` final=`{final}` bytes=`{size}` | Chunk received but no write stream taskId=`{taskId}` final=`{final}` bytes=`{size}` |
| ERR-70007-E | 写入分片失败 taskId=`{taskId}` → `{message}` | Failed to write chunk taskId=`{taskId}` → `{message}` |
| ERR-70007-F | sendChunk 失败 taskId=`{taskId}` | sendChunk failed taskId=`{taskId}` |
| ERR-70007-G | sendProgress 失败 taskId=`{taskId}` | sendProgress failed taskId=`{taskId}` |
| ERR-70007-H | arrayBuffer 转换失败 taskId=`{taskId}` | arrayBuffer conversion failed taskId=`{taskId}` |

### 70008 — 任务取消

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70008-A | 取消任务 taskId=`{taskId}` status=`{status}` | Canceling task taskId=`{taskId}` status=`{status}` |
| ERR-70008-B | 队列中任务已取消 taskId=`{taskId}` | Queued task canceled taskId=`{taskId}` |
| ERR-70008-C | 跳过已取消任务 taskId=`{taskId}` | Skipping canceled task taskId=`{taskId}` |
| ERR-70008-D | 取消任务失败 | Failed to cancel task |

### 70009 — 任务已完成/不存在

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70009-A | 取消失败：任务不存在 taskId=`{taskId}` | Cancel failed: task not found taskId=`{taskId}` |
| ERR-70009-B | 队列任务记录丢失 taskId=`{taskId}` | Queue task record missing taskId=`{taskId}` |
| ERR-70009-C | 收到完成信号但无 pending taskId=`{taskId}` | Received finished signal but no pending taskId=`{taskId}` |
| ERR-70009-D | 收到错误信号但无 pending taskId=`{taskId}` | Received error signal but no pending taskId=`{taskId}` |

### 70010 — 渲染窗口不存在

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70010-A | 发送 `{channel}` 失败：渲染窗口不存在 | Failed to send `{channel}`: renderer window not found |
| ERR-70010-B | 取消时渲染窗口不存在 taskId=`{taskId}` | Renderer window not found during cancel taskId=`{taskId}` |

### 70011 — 输出目录

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70011-A | 输出目录已就绪: `{dir}` | Output directory ready: `{dir}` |
| ERR-70011-B | 用户选择输出目录: `{dir}` | User selected output directory: `{dir}` |
| ERR-70011-C | 设置输出目录: `{dir}` | Set output directory: `{dir}` |
| ERR-70011-D | 输出目录创建失败: `{dir}` → `{message}` | Failed to create output directory: `{dir}` → `{message}` |

### 70012 — 音频 URL 数量不匹配

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70012-A | 音频 URL 数量(`{urls}`)与曲目数(`{tracks}`)不匹配 | audioUrls length (`{urls}`) mismatch with tracks (`{tracks}`) |

### 70013 — 无曲目

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70013-A | 未提供任何曲目 | No tracks provided |

### 70014 — 任务已存在

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70014-A | 任务已存在 taskId=`{taskId}` | Task already exists taskId=`{taskId}` |

### 70015 — 未知异常

| 错误码 | 中文 | English |
|--------|------|---------|
| ERR-70015-A | 任务执行异常 taskId=`{taskId}` → `{message}` | Task execution error taskId=`{taskId}` → `{message}` |
| ERR-70015-B | 渲染启动失败 taskId=`{taskId}` → `{message}` | Render start failed taskId=`{taskId}` → `{message}` |

---

## 排查指南

### 渲染失败 "Renderer window ready timeout"

错误码：`ERR-70003-E`

**可能原因**：
1. 渲染窗口加载失败（查看 `ERR-70002-A` 日志）
2. 渲染进程崩溃（查看 `ERR-70002-B` 日志）
3. Vue 组件未挂载（查看渲染窗口控制台 `ERR-70003-I` 是否输出）
4. preload 未注入 `window.api.renderVideo`（查看 `ERR-70003-I` 是否抛 `Cannot read properties of undefined`）

**排查步骤**：
1. 查看主进程日志，确认 `ERR-70001-B` 到 `ERR-70001-G` 的窗口创建流程是否完整
2. 查看 `ERR-70002-*` 错误码，确认是否有加载失败或崩溃
3. 查看 `console-message` 日志（渲染窗口控制台转发），确认 `ERR-70003-I` 是否输出
4. 若 `ERR-70003-I` 未输出，说明 Vue 应用未挂载，可能是 preload 注入失败或 main.ts 执行出错

### 渲染失败 "Audio load failed"

错误码：`ERR-70005-F`

**可能原因**：
1. 音频 URL 不可访问（404/403/CORS）
2. 音频 URL 已过期（网易云等在线平台有时效性）
3. 本地文件不存在（path 错误）

**排查步骤**：
1. 查看 `ERR-70005-D` 日志中的 audioUrl
2. 用浏览器直接访问该 URL 验证可访问性
3. 若是网易云等在线 URL，可能是缓存过期，重新播放一次该曲目再尝试渲染
4. 若是本地文件，检查文件是否存在

### 渲染失败 "MediaRecorder 创建失败"

错误码：`ERR-70006-D`

**可能原因**：
1. 当前 Chromium 版本不支持所选 MIME 类型
2. 视频码率参数无效
3. 系统编解码器缺失

**排查步骤**：
1. 查看 `ERR-70006-C` 警告，确认 MIME 类型支持情况
2. 尝试切换格式（WebM ↔ MP4）
3. 降低码率预设
4. 更新显卡驱动和系统编解码器

---

## 维护说明

### 新增错误码

1. 在对应模块的范围内选号（参考「模块划分」）
2. 在本文档对应章节添加条目
3. 在代码中使用 `log.info/warn/error("[ERR-XXXXX-X] 描述")` 形式
4. 子场景字母从 A 开始递增，同一错误码在不同函数触发时使用不同字母

### 日志规范

- 所有 `[ERR-*]` 标记必须出现在日志消息开头
- 错误码后跟随人类可读的描述（中英都行，运行时不翻译）
- 关键参数（taskId、文件路径、错误消息）用反引号或括号包裹
- 不在 INFO 级别日志中使用 `[ERR-]` 前缀，INFO 用于流程节点（如 `ERR-70001-B 创建渲染窗口开始` 是允许的，因为它本质是流程追踪）

### 翻译规范

- 错误码本身的描述字段不需要运行时翻译（仅用于日志/排查）
- 用户可见的 toast 提示仍然走 i18n 系统（`renderVideo.toast.*`）
- 错误码仅作为排查工具，不直接展示给用户
