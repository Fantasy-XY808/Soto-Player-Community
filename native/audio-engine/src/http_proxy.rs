//! TLS/JA3/JA4/HTTP2 指纹模拟 HTTP 代理（占位模块）
//!
//! ## 当前状态：未实现
//!
//! 本模块为占位实现，提供未来集成 TLS 指纹模拟 HTTP 代理的入口骨架。
//! 详细评估与实现路线图见 `docs/tls-fingerprint-evaluation.md`。
//!
//! ## 设计目标
//!
//! 通过 BoringSSL + wreq + wreq-util 模拟浏览器（Firefox 136 / Chrome 131 等）
//! 的 TLS ClientHello 指纹（JA3/JA4）与 HTTP/2 SETTINGS 帧指纹，绕过基于
//! TLS 指纹的反爬机制（如 QQ 音乐 / 网易云音乐高音质接口）。
//!
//! ## 与 `http_source.rs` 的职责区分
//!
//! - `http_source.rs`：基于 `ureq` 的 HTTP Range 流式读取，支持 seek / 重连 / 取消，
//!   服务于 ffmpeg_audio 解码器（按字节范围读取音频流）。**不模拟 TLS 指纹**。
//! - `http_proxy.rs`（本模块）：基于 `wreq` + BoringSSL 的指纹模拟 HTTP 客户端，
//!   服务于主进程的 API 调用（如获取歌曲 URL、歌词、封面等易被反爬拦截的接口）。
//!   **不支持 Range / seek**，一次性 GET/POST 返回完整响应。
//!
//! 两者职责正交，可共存于同一 binary。
//!
//! ## 阻塞原因
//!
//! BoringSSL 在 Windows MSVC 上的构建链要求：
//! - `cmake` 3.x（已安装：4.2.1）
//! - `nasm`（**未安装** — 用于 x86_64 汇编优化）
//! - `perl`（**未安装** — 用于 BoringSSL 构建脚本）
//! - `go`（已安装：1.26.0）
//! - MSVC build tools（已随 Rust toolchain 配置）
//!
//! NASM 与 Perl 缺失导致 `boring-sys` crate 无法在当前 Windows 环境构建，
//! 进而 `wreq` / `reqwest-impersonate` 等依赖 BoringSSL 的指纹模拟库均不可用。
//!
//! ## 未来实现路线（详见 docs/tls-fingerprint-evaluation.md）
//!
//! 1. 安装 NASM（https://www.nasm.us/）与 Strawberry Perl（https://strawberryperl.com/）
//! 2. 在 `Cargo.toml` 添加：
//!    ```toml
//!    wreq = "5.3.0"
//!    wreq-util = "2.2.6"
//!    ```
//! 3. 实现 `do_get` / `do_post` 异步函数（参考 x01n fork 的 http_proxy.rs）：
//!    - 全局 `OnceLock<Client>` 持有 `wreq::Client`，启用 `Emulation::Firefox136`
//!    - 接受 `HashMap<String, String>` 自定义请求头
//!    - 返回 `ProxyResponse { status, body, headers }`
//! 4. 在 `lib.rs` 通过 `#[napi]` 暴露 `http_get` / `http_post` 给 Node.js 主进程
//! 5. 在 `electron/main/utils/fetchProxy.ts` 集成：
//!    - 对需要 TLS 指纹模拟的接口（如 QQ/网易高音质）调用 NAPI 接口
//!    - 对普通接口保持原生 fetch + undici ProxyAgent 路径
//! 6. CI/CD：在 GitHub Actions 的 windows runner 上预装 nasm + perl，
//!    或考虑使用 `boring-sys` 的 `BORING_BSSL_PATH` 指向预编译库以缩短构建时间
//!
//! ## 替代方案（如果 BoringSSL 持续不可用）
//!
//! - **rustls + 自定义 TLS 扩展**：纯 Rust，无外部构建依赖，但无法真正匹配 JA3 指纹
//!   （rustls 的 cipher suite 排序与 BoringSSL 不同），仅能绕过粗粒度的 TLS 检测
//! - **Node.js 侧 `curl-impersonate` 子进程**：通过 child_process 调用 curl-impersonate
//!   二进制，避免在 Rust 侧引入 BoringSSL，但增加运行时依赖与 IPC 开销
//! - **预编译 BoringSSL 二进制**：通过 `boring-sys` 的 `BORING_BSSL_PATH` 环境变量
//!   指向预编译的静态库，跳过本机构建，但需要在 CI 上为每个目标平台产出预编译产物

// 占位常量，避免模块为空导致 dead_code 警告
#[allow(dead_code)]
const _MODULE_PLACEHOLDER: &str = "http_proxy module — see docs/tls-fingerprint-evaluation.md";
