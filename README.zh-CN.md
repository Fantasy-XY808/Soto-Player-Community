<div align="center">

<img alt="Soto-Player Community logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>Soto-Player Community · 水芸音乐播放器</h2>

<p>🎵 跨平台桌面音乐播放器，基于 SPlayer-Next 二次开发，增强播放界面视觉与社区体验</p>

<p>上游 <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a></p>

[![Stars](https://img.shields.io/github/stars/Fantasy-XY808/Soto-Player-Community?style=flat)](https://github.com/Fantasy-XY808/Soto-Player-Community/stargazers)
[![Release](https://img.shields.io/github/v/release/Fantasy-XY808/Soto-Player-Community)](https://github.com/Fantasy-XY808/Soto-Player-Community/releases)
[![License](https://img.shields.io/github/license/Fantasy-XY808/Soto-Player-Community)](https://github.com/Fantasy-XY808/Soto-Player-Community/blob/main/LICENSE)
[![Issues](https://img.shields.io/github/issues/Fantasy-XY808/Soto-Player-Community)](https://github.com/Fantasy-XY808/Soto-Player-Community/issues)

[English](./README.md) | **简体中文**

</div>

---

## 功能特性

- 🎵 **广泛的格式支持** —— MP3、FLAC、WAV、AAC、OGG、APE 等，基于 FFmpeg 解码
- 📝 **丰富的歌词** —— LRC / QRC / YRC / TTML，逐字高亮与翻译，支持桌面、灵动岛、任务栏歌词窗口
- 🌐 **流媒体服务** —— Subsonic / Navidrome / Jellyfin / Emby（多服务器、自动连接）
- 🖥️ **跨平台** —— Windows / macOS / Linux
- 🎚️ **音乐频谱** —— 实时 FFT 可视化
- 🎨 **流体播放视觉** —— 基于封面主色的流体背景、雪花 / 雾气 / 雨滴叠加层
- 📊 **音乐报告** —— 听歌统计、24 小时分布、高频艺人 / 曲目
- 🖼️ **歌词卡片导出** —— 多种卡片样式，自动提取封面主色渐变
- 🏷️ **元信息编辑** —— 编辑本地曲目标签与封面
- ⬇️ **下载** —— 内置下载管理器
- 🎧 **系统媒体集成** —— Windows SMTC / Linux MPRIS / macOS Now Playing + Discord RPC
- ⚡ **高性能音频引擎** —— FFmpeg + Rust（均衡器、响度归一化、超分激励器）
- 📈 **Last.fm Scrobble**

## 开发

### 环境要求

- **Node.js** >= 22
- **pnpm** >= 10
- **Rust 工具链**（构建原生模块所需，见下）

### 原生模块

核心性能特性由 Rust 编写的原生模块提供：

| 模块            | 说明                                               |
| --------------- | -------------------------------------------------- |
| `audio-engine`  | 高性能音频解码（FFmpeg）、播放、FFT 频谱、封面提取 |
| `media-ctrl`    | 系统媒体控制 + Discord Rich Presence               |
| `taskbar-lyric` | Windows 任务栏歌词原生渲染                         |

`pnpm dev` 与 `pnpm build` 会自动编译原生模块。若只做 UI 开发想跳过，可设置 `SKIP_NATIVE_BUILD=true`。

### 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发（先以 debug 构建原生模块，再启动 Electron）
pnpm dev
```

### 构建

```bash
pnpm build         # 完整构建：清理 → 原生模块 → 类型检查 → electron-vite

pnpm build:win     # 打包 Windows
pnpm build:mac     # 打包 macOS
pnpm build:linux   # 打包 Linux
```

> 默认仅构建当前架构。如需指定架构，可追加参数，例如 `pnpm build:win --x64 --arm64`。

### 其他脚本

```bash
pnpm typecheck        # tsc + vue-tsc（node + web 双目标）
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm build:native     # 仅构建 Rust 原生模块（加 `--dev` 为 debug 构建）
```

## 致谢

本项目是 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next)（作者 imsyy）的二次开发版本，在此致谢上游项目与作者。

- [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) —— 本项目上游，现代化桌面音乐播放器
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) —— 类 Apple Music 歌词显示组件库
- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) —— 网易云音乐 API 备份 + 增强

> 视觉灵感部分参考 [BetterLyrics](https://github.com/sxyazi/BetterLyrics) 等社区开源项目。

## 开源许可

本项目基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可开源。

- **修改与分发：** 任何修改或分发都必须同样基于 **AGPL-3.0**，并一并提供完整源代码。
- **派生作品：** 必须同样采用 **AGPL-3.0**，并在适当位置保留本项目的许可与版权信息。
- **署名：** 必须保留原作者及版权信息。可为二次开发添加你自己的署名，但不得移除或篡改原始信息。
