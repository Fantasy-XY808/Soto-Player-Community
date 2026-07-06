# SPlayer-Next 项目深度审查报告

> 审查日期：2026-07-02
> 审查范围：播放事件链路、persist 配置、频谱可视化、进度条

## 一、已修复问题

### P0-1: 进度条不动 + 频谱不显示（同根因）

**根因**：`initPlayer` 中 `onEvent` 注册位于函数末尾（第 928 行），前面有 ~20 个 `await` 调用。其中任何一个抛出异常都会导致 `onEvent` 永不注册，主进程的 `position` / `fftData` 事件无法到达渲染进程。由于 `initialized = true` 在函数开头已设置，`initPlayer` 不会重试。

**证据链**：

- 主进程日志确认 position/fftData 事件已通过 `webContents.send("player:event")` 发送，`mainVisible=true`
- 渲染进程 DevTools 中无任何 `[diag] handleEvent` / `[diag] onEvent IPC 回调触发` 日志
- `playbackTimeMs` 高达 172553（墙钟插值累积），但 `statusPosition` 恒为 0
- `status.state` 由 `load()` 乐观更新为 "playing"，并非由主进程事件驱动

**修复**：将 `onEvent` 注册移到 `initPlayer` 最前面（所有 `await` 之前），后续逻辑用 `try-catch` 包裹，即使后续步骤失败也不影响事件接收。

**涉及文件**：`src/core/player/index.ts`

### P0-2: persist key 污染导致频谱默认关闭

**根因**：新版 `settings` store 使用 `soto-player:settings` 前缀隔离，但项目初版未加前缀，原版 SPlayer-Next 的 `enableSpectrum: false` 等旧默认值被加载覆盖新代码。

**修复**：

- `afterHydrate` 中用 `_playerDefaultsV2` 标记位一次性回退频谱相关默认值
- 每次启动校验 `spectrumSensitivity`/`spectrumMaxHeight`/`spectrumSmoothing`/`spectrumBarWidth`/`spectrumStyle` 合法性
- `playerUI.ts` schema 中 `enableSpectrum` 的 `defaultValue` 从 `false` 改为 `true`

**涉及文件**：`src/stores/settings.ts`、`src/settings/categories/playerUI.ts`

### P1-1: BottomSpectrum canvas 颜色继承断裂

**根因**：canvas 元素无显式 `color` 样式，依赖 CSS 继承链从父级 `text-cover` 获取颜色。当 `--s-cover` CSS 变量未定义或继承链断裂时，`getComputedStyle(canvas).color` 返回空字符串，`ctx.fillStyle` 无效，频谱条透明不可见。

**修复**：`.spectrum-canvas` 显式设置 `color: rgb(var(--s-cover))`；`draw()` 中对 `getComputedStyle` 返回值加 `"rgb(255, 255, 255)"` 兜底。

**涉及文件**：`src/components/player/FullPlayer/BottomSpectrum.vue`

## 二、待处理问题（TODO）

### P1-2: initPlayer 缺乏错误恢复机制

**问题**：`initPlayer` 设置 `initialized = true` 后，如果后续逻辑抛出异常，播放器永远不会重新初始化。用户需要重启应用才能恢复。

**建议**：将 `initialized = true` 移到函数末尾（成功完成后），或在 catch 中设置 `initialized = false` 允许重试。已部分修复（try-catch 包裹），但 `initialized` 仍在开头设置。

**文件**：`src/core/player/index.ts`

### P1-3: HMR 可能导致 onEvent 重复注册

**问题**：`src/core/player/index.ts` 的模块级变量 `unsubscribe` 和 `initialized` 在 HMR 热重载时会被重置为初始值，导致 `initPlayer` 重新执行并注册新的 `onEvent` 监听器，而旧监听器不会被清除。

**建议**：使用 `import.meta.hot?.dispose()` 在 HMR 时清理旧监听器。

**文件**：`src/core/player/index.ts`

### P2-1: status store 的 playIndex 是恢复播放的关键字段

**问题**：`status` store 持久化 `playIndex`（默认 key 无前缀）。如果 localStorage 被清理或 key 被修改，`playIndex` 会重置为 -1，导致 `initPlayer` 中 `lastTrack = undefined`，播放器不恢复播放。

**建议**：在 `initPlayer` 中增加 `playIndex === -1` 时的降级处理（如从 IndexedDB queue 恢复）。

**文件**：`src/stores/status.ts`、`src/core/player/index.ts`

### P2-2: preload subscribe 函数缺乏错误边界

**问题**：`subscribe` 函数的 `handler` 直接调用 `callback(data)`，如果 callback 抛出异常，Electron 的 IPC 系统可能会静默吞掉错误，导致后续事件不再触发。虽然这不是当前问题的根因，但属于潜在风险。

**建议**：在 `handler` 中加 `try-catch`，异常时 `console.error` 而非静默。

**文件**：`electron/preload/index.ts`

### P2-3: create.ts 中 webgl 配置矛盾

**问题**：`create.ts` 默认 `webgl: false`，但 `main.ts` 传入 `webgl: true` 覆盖。两个文件对 webgl 的态度矛盾，容易混淆。

**建议**：统一 webgl 配置，在 `create.ts` 中移除 `webgl: false` 或在 `main.ts` 中不覆盖。

**文件**：`electron/main/window/create.ts`、`electron/main/window/main.ts`

### P2-4: AroundCoverSpectrum 缺少 fillStyle 兜底

**问题**：`AroundCoverSpectrum.vue` 的 `draw()` 函数中 `const fillStyle = getComputedStyle(canvas).color` 无兜底，与 BottomSpectrum 存在相同的颜色继承断裂风险。

**建议**：添加与 BottomSpectrum 相同的兜底逻辑：`const fillStyle = getComputedStyle(canvas).color || "rgb(255, 255, 255)"`。

**文件**：`src/components/player/FullPlayer/AroundCoverSpectrum.vue`

## 三、审查总结

| 优先级 | 问题                                    | 状态     |
| ------ | --------------------------------------- | -------- |
| P0     | initPlayer onEvent 注册位置导致事件丢失 | 已修复   |
| P0     | persist key 污染导致频谱默认关闭        | 已修复   |
| P1     | BottomSpectrum canvas 颜色继承断裂      | 已修复   |
| P1     | initPlayer 缺乏错误恢复机制             | 部分修复 |
| P1     | HMR 导致 onEvent 重复注册               | 待处理   |
| P2     | playIndex 丢失降级处理                  | 待处理   |
| P2     | preload subscribe 缺乏错误边界          | 待处理   |
| P2     | webgl 配置矛盾                          | 待处理   |
| P2     | AroundCoverSpectrum 缺少 fillStyle 兜底 | 待处理   |
