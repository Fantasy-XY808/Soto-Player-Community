# MusicFree 插件兼容

Soto Player 内置 MusicFreeDesktop 协议适配层，可**直接加载** [MusicFreeDesktop](https://github.com/maotoumao/MusicFreeDesktop) 生态的插件脚本，无需任何修改。

适配层在沙箱中注入 CommonJS 全局变量（`module` / `exports` / `require` / `env` / `process`），并把 MusicFree 插件实例的 14 个方法桥接成宿主侧的标准 action，对外通过 `window.api.plugins.mf*` 暴露给渲染端业务代码。

## 识别方式

无需在脚本头部显式声明 `@platform musicfree`，加载器按以下顺序识别：

1. 头部 JSDoc `@platform musicfree` 显式声明；
2. `gz_` 压缩脚本默认识别为 `lx`；
3. 启发式检测：源码包含 `module.exports =` 赋值 + `platform: 'xxx'` 字段 + 任一 MusicFree 特有方法名（`getMediaSource` / `getAlbumInfo` / `getMusicSheetInfo` / `getArtistWorks` / `importMusicSheet` / `getTopLists` / `getRecommendSheetTags` / `getMusicComments` 等），且不含 `splayer.on(` / `lx.send(` 特征；
4. 兜底识别为 `splayer`。

识别为 `musicfree` 后，沙箱会自动注入 CommonJS 全局变量与白名单 `require`。

## 白名单 require

MusicFree 插件常用以下 Node 模块，适配层把它们挂到沙箱内的 `require`：

| require 名                 | 实际指向                                                       |
| -------------------------- | -------------------------------------------------------------- |
| `cheerio`                  | 宿主打包的 cheerio（与 splayer-native 共享同一实现）           |
| `crypto-js`                | 宿主打包的 crypto-js                                           |
| `axios`                    | 宿主打包的 axios（已禁用本地 http agent，统一走 `splayer.request` 的安全通道以外的方式） |
| `dayjs`                    | 宿主打包的 dayjs                                               |
| `big-integer`              | 宿主打包的 big-integer                                         |
| `qs`                       | 宿主打包的 qs                                                  |
| `he`                       | 宿主打包的 he                                                  |
| `webdav`                   | 宿主打包的 webdav（WebDAV 客户端）                            |
| `musicfree/storage`        | 转发到 `splayer.storage`，与 splayer-native 共享命名空间       |
| `@react-native-cookies/cookies` | RN 专属 cookie 模块的 no-op polyfill（接口预留，实际无副作用） |

任何白名单以外的 `require` 会抛 `MODULE_NOT_FOUND`，避免沙箱逃逸。

## 14 个协议方法

| 方法                        | 入参                                         | 返回                                                | 用途                              |
| --------------------------- | -------------------------------------------- | --------------------------------------------------- | --------------------------------- |
| `search`                    | `{ query, page, type }`                      | `{ isEnd?, data: MfMusicItem[] \| ... }`           | 搜索曲目 / 专辑 / 歌手 / 歌单    |
| `getMediaSource`            | `{ musicItem, quality }`                    | `{ url?, headers?, userAgent?, quality? }`         | 解析播放地址（核心方法）          |
| `getLyric`                  | `{ musicItem }`                             | `{ lrc?, rawLrc?, translation? }`                  | 取歌词                            |
| `getMusicInfo`              | `{ musicBase: { id, platform, ... } }`      | `{ musicItem? }`                                    | 补全单曲详情                      |
| `getAlbumInfo`              | `{ albumItem, page }`                       | `{ isEnd?, albumItem?, musicList? }`               | 专辑详情 + 分页曲目               |
| `getMusicSheetInfo`         | `{ sheetItem, page }`                       | `{ isEnd?, sheetItem?, musicList? }`               | 歌单详情 + 分页曲目               |
| `getArtistWorks`            | `{ artistItem, page, type }`                | `{ isEnd?, data: MfMusicItem[] \| MfAlbumItem[] }` | 歌手作品（歌曲/专辑）             |
| `importMusicSheet`          | `{ url }`                                   | `{ musicList }`                                     | 从分享链接导入整张歌单            |
| `importMusicItem`           | `{ url }`                                   | `{ musicItem \| null }`                            | 从分享链接导入单曲                |
| `getTopLists`               | `{}`                                        | `{ data: MfSheetGroupItem[] }`                     | 排行榜分组列表                    |
| `getTopListDetail`          | `{ topListItem, page }`                     | `{ isEnd?, topListItem?, musicList? }`             | 排行榜详情 + 分页曲目             |
| `getRecommendSheetTags`      | `{}`                                        | `{ pinned?, data? }`                                | 推荐歌单标签分组                  |
| `getRecommendSheetsByTag`   | `{ tag, page? }`                            | `{ isEnd?, data? }`                                | 按标签取推荐歌单                  |
| `getMusicComments`           | `{ musicItem, page? }`                     | `{ isEnd?, data? }`                                 | 取评论（含回复）                  |

### 音质映射

MusicFree 的 `low / standard / high / super` 与宿主音质档位按以下表格互转：

| MusicFree  | 宿主        |
| ---------- | ----------- |
| `low`      | `lq`        |
| `standard` | `sq`        |
| `high`     | `hq`        |
| `super`    | `hi-res`    |

调用 `mfGetMediaSource` 时入参用 MusicFree 音质档位（如 `"high"`）；返回的 `quality` 字段同样按上表回传。

## 渲染端调用

```ts
// 列出所有 MusicFree 协议插件
const plugins = await window.api.plugins.mfListPlugins();
const pluginId = plugins[0].manifest.id;

// 搜索「周杰伦」第一页，类型 music
const { isEnd, data } = await window.api.plugins.mfSearch(
  pluginId, "周杰伦", 1, "music"
);

// 取播放地址（high = 320k 等档位）
const source = await window.api.plugins.mfGetMediaSource(
  pluginId,
  data[0] as MfMusicItem,
  "high"
);
// source.url 可直接喂给播放器
```

类型与返回值与 `shared/types/plugin.ts` 中导出的 `MfMusicItem` / `MfSearchRes` / `MfGetMediaSourceRes` 等一一对应。

## 订阅管理

MusicFreeDesktop 的「订阅」本质上是一组插件脚本 URL 书签，每条订阅直接指向一个 `.js` 脚本（不是清单 JSON）。Soto 在设置 → 插件管理中提供：

- **添加 / 删除订阅**：写入 `plugins.subscriptions` 持久化；
- **单条更新**：`window.api.plugins.mfInstallFromSubscription(srcUrl)`；
- **一键更新全部**：渲染端 `usePluginsStore().refreshAllSubscriptions()` 逐条拉取安装。

```ts
// 读取订阅
const subs = await window.api.plugins.mfListSubscriptions();
// 保存订阅（覆盖式）
await window.api.plugins.mfSaveSubscriptions([
  { title: "个人插件集", srcUrl: "https://example.com/my-plugin.js" }
]);
// 拉取并安装
await window.api.plugins.mfInstallFromSubscription(
  "https://example.com/my-plugin.js"
);
```

## 用户变量

部分 MusicFree 插件通过 `userVariables` 声明所需的配置项（如 cookie、token）。Soto 当前已把这些变量挂到沙箱中的 `env` 全局对象上；UI 端编辑入口将在后续版本补齐。在此之前，可手动写入 `__musicfree_user_variables__` 设置项：

```ts
// 临时写入：通过控制台或自定义脚本
await window.api.config.set(
  "plugins.perPlugin.__musicfree_user_variables__",
  { cookie: "KEY=VALUE; ..." }
);
```

## 与 splayer-native 的关系

| 维度     | splayer-native                        | MusicFree                              |
| -------- | ------------------------------------- | -------------------------------------- |
| 脚本格式 | 头部 JSDoc + `splayer.on/register`    | `module.exports = { platform, ... }`   |
| 全局对象 | `splayer`                              | `module` / `exports` / `require` / `env` |
| 网络      | `splayer.request`                      | `splayer.request`（同一实现）          |
| 存储      | `splayer.storage`                     | `require("musicfree/storage")` → 同一 storage |
| 暴露方法 | `musicUrl` 一个                       | 上述 14 个方法                          |

两类插件**可共存**：用户可同时安装 splayer-native 音源插件与 MusicFree 音源插件，互不影响。音源类仍按现有的「同类型互斥」规则——启用一个新的音源插件时，会先停用其他已启用的音源插件。
