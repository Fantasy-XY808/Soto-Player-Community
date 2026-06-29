<div align="center">

<img alt="Soto-Player Community logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>Soto-Player Community</h2>

<p>🎵 A modern cross-platform desktop music player — a community-driven fork of SPlayer-Next with enhanced visuals and UX.</p>

<p>Based on <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a> · Visual inspiration from <a href="https://github.com/sxyazi/BetterLyrics">BetterLyrics</a></p>

[![Stars](https://img.shields.io/github/stars/Fantasy-XY808/Soto-Player-Community?style=flat)](https://github.com/Fantasy-XY808/Soto-Player-Community/stargazers)
[![Release](https://img.shields.io/github/v/release/Fantasy-XY808/Soto-Player-Community)](https://github.com/Fantasy-XY808/Soto-Player-Community/releases)
[![License](https://img.shields.io/github/license/Fantasy-XY808/Soto-Player-Community)](https://github.com/Fantasy-XY808/Soto-Player-Community/blob/main/LICENSE)
[![Issues](https://img.shields.io/github/issues/Fantasy-XY808/Soto-Player-Community)](https://github.com/Fantasy-XY808/Soto-Player-Community/issues)

**English** | [简体中文](./README.zh-CN.md)

</div>

---

## Features

- 🎵 **Broad format support** — MP3, FLAC, WAV, AAC, OGG, APE, and more, decoded via FFmpeg
- 📝 **Rich lyrics** — LRC / QRC / YRC / TTML, word-by-word highlighting and translations, with desktop, dynamic-island, and taskbar lyric windows
- 🌐 **Streaming servers** — Subsonic / Navidrome / Jellyfin / Emby (multi-server, auto-connect)
- 🖥️ **Cross-platform** — Windows / macOS / Linux
- 🎚️ **Audio spectrum** — real-time FFT visualization
- 🎨 **Fluid playback visuals** — cover-based fluid background, snow / fog / raindrop overlays
- 📊 **Music report** — play stats, hourly distribution, top artists / tracks
- 🖼️ **Lyric card export** — multiple card styles with cover-palette gradients
- 🏷️ **Metadata editing** — edit local track tags and cover art
- ⬇️ **Downloads** — built-in download manager
- 🎧 **System media integration** — Windows SMTC / Linux MPRIS / macOS Now Playing + Discord RPC
- ⚡ **High-performance audio engine** — FFmpeg + Rust (EQ, loudness normalization, super-resolution exciter)
- 📈 **Last.fm scrobbling**

## Development

### Requirements

- **Node.js** >= 22
- **pnpm** >= 10
- **Rust toolchain** (required to build the native modules; see below)

### Native Modules

Core performance features are powered by Rust-based native modules:

| Module          | Description                                                                        |
| --------------- | ---------------------------------------------------------------------------------- |
| `audio-engine`  | High-performance audio decoding (FFmpeg), playback, FFT spectrum, cover extraction |
| `media-ctrl`    | System media controls + Discord Rich Presence                                      |
| `taskbar-lyric` | Native Windows taskbar lyric rendering                                             |

`pnpm dev` and `pnpm build` compile the native modules automatically. To skip them (e.g. when working only on the UI), set `SKIP_NATIVE_BUILD=true`.

### Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Start the dev app (builds native modules in debug, then launches Electron)
pnpm dev
```

### Building

```bash
pnpm build         # Full build: clean → native → typecheck → electron-vite

pnpm build:win     # Package for Windows
pnpm build:mac     # Package for macOS
pnpm build:linux   # Package for Linux
```

> By default a build targets the current architecture only. To target specific
> architectures, append them, e.g. `pnpm build:win --x64 --arm64`.

### Other Scripts

```bash
pnpm typecheck        # tsc + vue-tsc (node + web targets)
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm build:native     # Build the Rust native modules only (add `--dev` for debug)
```

## Acknowledgements

This project is a fork of [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) by imsyy. The fluid playback visuals and lyric card design are inspired by [BetterLyrics](https://github.com/sxyazi/BetterLyrics). Special thanks to both projects and their authors.

- [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) — upstream project, modern desktop music player
- [BetterLyrics](https://github.com/sxyazi/BetterLyrics) — fluid background and lyric card visual inspiration
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) — Apple Music-style lyrics display component library
- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) — NetEase Cloud Music API (backup + enhanced)

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html).

- **Modification & distribution:** any modification or distribution must also be released under **AGPL-3.0**, with the complete source code provided.
- **Derivative works:** must adopt **AGPL-3.0** as well, and must retain this project's license and copyright notice in an appropriate place.
