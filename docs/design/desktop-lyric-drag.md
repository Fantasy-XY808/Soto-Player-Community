# 桌面歌词窗口拖拽：Windows 高 DPI 下尺寸漂移问题排查记录

## 一、问题现象

桌面歌词窗口在 Windows 系统缩放 ≠ 100%（如 125% / 150%）下，每次用户拖动窗口结束后，**宽度都会增加 1~2 像素**。重复拖动几次，窗口就明显变宽。高度始终稳定。

> 触发条件：`transparent: true` + `frame: false` + `resizable: true` + 系统 DPI 缩放非 100%。

## 二、为什么这是个经典问题

Electron / Chromium 对外暴露的窗口坐标是**逻辑像素 DIP（device-independent pixels）**，允许小数；Windows 原生 `SetWindowPos` / `GetWindowRect` 走的是**物理像素**，必须整数。两者在非 100% 缩放下是**非整数比换算**：

```
DIP × scale → 物理像素 (向上取整)
物理像素 ÷ scale → DIP (再次有损舍入)
```

每次 `setBounds` 把 DIP 转物理像素，每次 `getBounds` 把物理像素转回 DIP，**每来回一次就可能多 1 DIP**。如果代码里高频出现 `getBounds() → 加工 → setBounds(...)` 这个回环，宽高会肉眼可见地缓慢增大。

相关 Electron Issue（均处于 open 状态，官方未修）：

- [#27651](https://github.com/electron/electron/issues/27651) `setBounds` makes BrowserWindows larger every time on Windows
- [#10659](https://github.com/electron/electron/issues/10659) Cannot accurately set BrowserWindow position / size when DPI scaling is not 100%
- [#9477](https://github.com/electron/electron/issues/9477) `setPosition` changed window size with non-default scaleLevel
- [#10862](https://github.com/electron/electron/issues/10862) Per-monitor DPI awareness causes positioning issues

## 三、走过的三个弯路

### 弯路 1：用 `setMaximumSize` clamp 住宽度

> 思路：每帧 `setBounds({x, y, width, height})` 时，提前 `setMaximumSize(width, height)` 卡死最大尺寸，让 Chromium 自动 clamp 漂移。

**为什么失败**：`setMaximumSize` 设的边界本身就被 DPI 回环污染——传入的 width 在内部转物理像素时取整，clamp 边界可能就比"原本的尺寸"大 1。每次拖动 max 边界都长 1 DIP。

### 弯路 2：拖拽期间用 `setPosition`，结束时 `setBounds` snap-back

> 思路：拖拽期间用 `setPosition(x, y)`（理论上只改位置），结束时显式 `setBounds({width: cached, height: cached})` 把尺寸"snap 回去"。

**为什么失败**：

1. `BrowserWindow.setPosition` 在 Electron 内部其实是 `SetBounds(x, y, current_size.width, current_size.height)`——它**会读当前尺寸再写回**，照样走回环。
2. snap-back 那次 `setBounds({width, height})` 自己就是 #27651 的锤点，每次 +1。

### 弯路 3：`min === max` 完全钉死尺寸

> 思路：拖拽期间 `setMinimumSize(w, h)` + `setMaximumSize(w, h)`，让 Chromium 物理上无法改尺寸。

**为什么失败**：constraint 设置本身的 DIP→物理换算就有舍入。当 current_width 在内部是 800.4 DIP，setMaximumSize(800, h) 之后 Chromium 觉得"哎超了" 触发一次内部尺寸调整，调整后又是 +1 DIP。

## 四、根本原因 + 真正的解法

**根本原因一句话**：只要代码里存在「getBounds 读出的尺寸 → setBounds 写回」这个回环，就一定会漂移。**所有解决思路都必须斩断这个回环**。

参考 PentaTea 的方案（[原文](https://zhuanlan.zhihu.com/p/1980462518976680377)），最终方案的核心：

> **主进程持有"权威 cachedSize"，所有 `setBounds` 写宽高时都用它，绝不从 `getBounds` 读尺寸回写自己。**

权威值的更新时机**严格限制为三个**：

1. 窗口 `ready-to-show` 时初始化一次（首次真值）
2. 用户**手动拖边 resize** 后（`resized` 事件，仅用户操作触发，程序 `setBounds` 不触发）
3. 字号驱动高度变化时（`applyDesktopLyricHeight` 主动写入新 height）

其他任何时刻——尤其是高频的拖拽 `move` IPC——主进程的 setBounds 都从 cachedSize 取宽高写回。

```ts
// electron/main/window/desktopLyric.ts

const cachedSize = { width: 0, height: 0 };

// 拖拽每帧：位置由渲染端传入，尺寸用权威 cachedSize 强制写回
export const moveDesktopLyricWindow = (x: number, y: number): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  win.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: cachedSize.width, // ← 关键：永远用 cachedSize，不读 getBounds
    height: cachedSize.height,
  });
};

// 字号驱动的高度变化：直接更新权威 cachedSize.height
export const applyDesktopLyricHeight = (height: number): void => {
  const win = getDesktopLyricWindow();
  if (!win) return;
  const h = Math.round(height);
  cachedSize.height = h;
  win.setMinimumSize(MIN_WIDTH, h);
  win.setMaximumSize(MAX_WIDTH, h);
  const { x, y } = win.getBounds(); // 位置可以读，瞬时值不累积
  win.setBounds({ x, y, width: cachedSize.width, height: h });
};

// 用户手动拖边 resize：吸纳为新的权威值（只此一处更新）
desktopLyricWindow.on("resized", () => {
  const b = desktopLyricWindow.getBounds();
  cachedSize.width = b.width;
  cachedSize.height = b.height;
  saveWindowState();
});
```

> **关键观察**：`resized` 事件**只对用户操作触发**，程序 `setBounds` 不触发。所以即便我们每帧 `setBounds`，也不会把脏值循环吸纳进 cachedSize。这是整个方案能成立的前提。

渲染端拖拽逻辑同步精简——彻底移除任何窗口尺寸缓存：

```ts
// windows/desktop-lyric/App.vue

let dragOffsetX = 0;
let dragOffsetY = 0;

const onRootPointerDown = (event: PointerEvent): void => {
  // 关键：用 clientX/Y 作为"鼠标在窗口客户区内的偏移"
  // 之后无论窗口怎么动，targetX = screenX - offsetX 永远算出窗口左上角应该在的屏幕绝对坐标
  dragOffsetX = event.clientX;
  dragOffsetY = event.clientY;

  // 捕获指针：拖拽期间即便鼠标移出窗口（透明区 / 边界外）也能持续派发事件
  target.setPointerCapture(event.pointerId);

  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
};

const onPointerMove = (event: PointerEvent): void => {
  // 绝对坐标算法，不依赖任何"上一帧窗口位置"
  pendingX = Math.round(event.screenX - dragOffsetX);
  pendingY = Math.round(event.screenY - dragOffsetY);
  // rAF 节流降低 IPC 频率
  if (!moveRafPending) {
    moveRafPending = true;
    requestAnimationFrame(flushMove);
  }
};
```

## 五、容易踩的暗雷

排查过程中还发现几个隐藏污染源，记一下：

| 暗雷                                                                         | 后果                                                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 渲染端用 `useWindowSize()` 实时同步 `window.innerWidth` 到 cachedBounds      | innerWidth 也是经过 DIP 回环的，写回 cachedBounds 就把脏值带进了下次拖拽起点 |
| pointerup 后调用 `updateCachedBounds()` 从 IPC 读 getBounds 回写本地缓存     | 每次拖拽结束都把脏值固化进本地缓存                                           |
| `applyDesktopLyricHeight` 里 `setBounds({ ...bounds, height })`              | spread 把 getBounds 的脏 width 也写回了                                      |
| `BrowserWindow.setPosition(x, y)` 内部其实是 `SetBounds(x, y, current_size)` | "只改位置"是错觉，照样走 setBounds 回环                                      |
| `setBounds({ x, y })` 想用 Partial Rectangle 跳过尺寸                        | Electron 内部还是 fill 满 current_size 再调原生 API                          |

## 六、为什么 height 不漂、width 漂

排查中段一直困惑这个：高度从来稳定，宽度持续变大。

**答案**：高度的"权威值"每次都从 `config.fontSize` **重新推导**（`computeWindowHeight(fontSize)`），不经过 getBounds 回环。而宽度——在引入 cachedSize 方案前——的"权威值"全靠 `useWindowSize()` 持续吸纳 innerWidth，本身就是脏的。

所以整改的方向就明确了：把宽度也变成"有独立权威源、不从 getBounds 读"。

## 七、可复用的通用原则

写 Electron 桌面应用涉及窗口几何时，记住这几条：

1. **DIP↔物理像素是有损操作。** 永远假设 round-trip 会差 1 像素。
2. **不要把 `getBounds()` 的返回值喂回 `setBounds()`。** 这是漂移的唯一来源。
3. **如果必须高频 `setBounds`，尺寸必须用程序持有的"权威值"，不是从窗口读出来的。**
4. **`setPosition` 不是"只改位置"。** 它内部会读当前尺寸再写回。
5. **`resized` / `moved` 事件只在用户操作时触发**，程序 `setBounds` 不触发——这正是把"用户意图"和"程序操作"分开的钩子。
6. **拖拽逻辑用绝对坐标 `screenX - clientX`，不用增量累加。** 增量法依赖上一帧的窗口位置，IPC 延迟会引入抖动；绝对坐标法是无状态的。
7. **拖拽用 `setPointerCapture`**，否则鼠标快速移出窗口区域会脱轨（pointer events 默认只在元素内派发）。
8. **透明 frameless 窗口加上 `webPreferences.zoomFactor: 1.0` + `did-finish-load` 后再 `setZoomFactor(1.0)`**，避免主窗口缩放被继承。

## 八、参考资料

- [Electron 无边框窗口在高 DPI 下的稳定拖拽实现 - PentaTea](https://zhuanlan.zhihu.com/p/1980462518976680377)
- [electron/electron#27651](https://github.com/electron/electron/issues/27651) setBounds 累积变大 bug
- [electron/electron#10659](https://github.com/electron/electron/issues/10659) 非 100% DPI 下精度问题
- [electron/electron#9477](https://github.com/electron/electron/issues/9477) setPosition 改变尺寸 bug
- [Electron screen API 文档](https://www.electronjs.org/docs/latest/api/screen)（提供 `dipToScreenRect` / `screenToDipRect` 用于手动绕过转换）
