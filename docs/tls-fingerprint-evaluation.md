# TLS / JA3 / JA4 / HTTP2 指纹模拟 HTTP 代理集成评估

> 评估日期：2026-07-28
> 评估目标：将 x01n fork 的 `wreq + BoringSSL` TLS 指纹模拟 HTTP 代理集成到 Soto_Player
> 评估结论：**当前选择方案 C（占位模块 + 评估文档）**，待 BoringSSL 构建链就绪后升级到方案 A

---

## 1. 评估结论

### 1.1 总体结论

**当前环境下方案 A 与方案 B 均不可行，选择方案 C。**

核心阻塞：BoringSSL 在 Windows MSVC 上的构建链依赖 **NASM** 与 **Perl**，二者在当前开发环境均未安装。`wreq`（方案 A）与 `reqwest-impersonate`（方案 B）均通过 `boring-sys` crate 静态链接 BoringSSL，因此均受此阻塞。

### 1.2 关键证据

| 构建依赖 | 当前状态 | 用途 |
| --- | --- | --- |
| `cmake` 3.x | ✅ 已安装（4.2.1） | BoringSSL 构建系统 |
| `go` 1.x | ✅ 已安装（1.26.0） | BoringSSL 构建脚本（`boring-sys` 调用） |
| `nasm` | ❌ **未安装** | x86_64 汇编优化（BoringSSL 必需） |
| `perl` | ❌ **未安装** | BoringSSL 构建脚本（`boring-sys` 调用） |
| MSVC build tools | ✅ 已随 Rust toolchain 配置 | C/C++ 编译 |

### 1.3 决策依据

1. **任务描述明确指出**："BoringSSL 编译链复杂，跨平台构建困难（尤 Windows MSVC）"
2. **任务允许降级**："优先选择方案 A，如遇阻塞则降级到 B 或 C"
3. **方案 B 同样阻塞**：`reqwest-impersonate` 也依赖 BoringSSL，相同的 NASM/Perl 缺失问题
4. **避免破坏现有构建**：强行引入 BoringSSL 会导致 `cargo check` / `cargo build` 失败，
   影响所有贡献者的本机构建与 CI 流水线

---

## 2. 各方案对比

### 2.1 方案 A：完整集成 x01n 的 wreq + BoringSSL

**实现内容**：
- 新建 `native/audio-engine/src/http_proxy.rs`，移植 x01n fork 的实现
- `Cargo.toml` 添加 `wreq = "5.3.0"` + `wreq-util = "2.2.6"`
- `lib.rs` 注册 `mod http_proxy;` 并通过 `#[napi]` 暴露 `http_get` / `http_post`
- `index.d.ts` 声明 NAPI 接口
- `electron/main/utils/fetchProxy.ts` 集成调用

**优势**：
- 真正的 JA3/JA4/HTTP2 指纹模拟（BoringSSL ClientHello 完全可控）
- 已在 x01n fork 验证可行（Firefox 136 emulation 可绕过 QQ/网易反爬）
- 与现有 `ureq`（http_source.rs）职责正交，无冲突

**劣势**：
- **构建链复杂**：BoringSSL 需要 cmake + nasm + perl + go，Windows MSVC 上 nasm + perl 缺失
- **构建时间长**：首次 BoringSSL 编译 15-30 分钟，CI 流水线显著变慢
- **二进制体积增长**：+5-10 MB（BoringSSL 静态链接）+ 2 MB（wreq + tokio）≈ +7-12 MB
- **跨平台一致性风险**：macOS / Linux 也需要相应构建工具，CI 需为每个平台配置

**可行性**：当前环境**不可行**（nasm + perl 缺失）

### 2.2 方案 B：reqwest-impersonate 轻量替代

**实现内容**：
- 用 `reqwest-impersonate` 替代 `wreq`，仅启用 Chrome/Firefox 两种预设
- 同样通过 NAPI 暴露 `http_get` / `http_post`

**优势**：
- API 与 `reqwest` 兼容，迁移成本低
- 社区维护时间较长（尽管 2025 年后更新放缓）

**劣势**：
- **同样依赖 BoringSSL**：`reqwest-impersonate` 内部通过 `boring-sys` 链接 BoringSSL，
  与方案 A **相同的构建链阻塞**
- **维护活跃度下降**：上游 `4esnog/reqwest-impersonate` fork 在 2025 年后更新放缓
- **二进制体积**：与方案 A 相当（+5-10 MB）

**可行性**：当前环境**不可行**（相同的 BoringSSL 构建链问题）

### 2.3 方案 C：占位模块 + 评估文档（当前选择）

**实现内容**：
- 新建 `native/audio-engine/src/http_proxy.rs` 作为占位模块（含详细 TODO 注释）
- 在 `lib.rs` 注册 `mod http_proxy;`（占位模块可正常编译）
- 新建本评估文档 `docs/tls-fingerprint-evaluation.md`

**优势**：
- **零构建风险**：不引入新依赖，`cargo check` / `cargo build` 不受影响
- **零运行时风险**：不改变任何现有功能，`fetchProxy.ts` 保持原状
- **未来可升级**：占位模块明确标注了实现路线，后续可平滑升级到方案 A
- **文档完备**：评估结论、对比分析、路线图、依赖冲突分析全部沉淀

**劣势**：
- **不解决反爬问题**：QQ/网易高音质接口仍可能被 JA3 指纹拦截
- **需要后续工作**：待构建链就绪后才能落地真实功能

**可行性**：当前环境**完全可行**，已执行

### 2.4 方案对比矩阵

| 维度 | 方案 A (wreq+BoringSSL) | 方案 B (reqwest-impersonate) | 方案 C (占位+文档) |
| --- | --- | --- | --- |
| 反爬效果 | ✅ 完整 JA3/JA4/HTTP2 模拟 | ✅ 完整 JA3/JA4/HTTP2 模拟 | ❌ 无 |
| 当前环境可行性 | ❌ nasm/perl 缺失 | ❌ nasm/perl 缺失 | ✅ 零依赖 |
| 构建链复杂度 | 🔴 高（4 个外部工具） | 🔴 高（4 个外部工具） | 🟢 零 |
| 二进制体积增长 | +7-12 MB | +7-12 MB | 0 |
| CI/CD 影响 | 显著变慢（15-30 min） | 显著变慢 | 无 |
| 跨平台一致性 | 风险高 | 风险高 | 无风险 |
| 维护活跃度 | wreq 较新 | 放缓 | N/A |
| 未来升级路径 | 已是终态 | 已是终态 | 可升级到 A |

---

## 3. 未来实现路线图

### 3.1 短期（1-2 周）：环境就绪

1. **开发环境补齐**：
   - 安装 NASM：`winget install nasm` 或从 https://www.nasm.us/ 下载
   - 安装 Strawberry Perl：从 https://strawberryperl.com/ 下载
   - 验证：`nasm -v` 与 `perl --version` 均可执行
2. **CI 配置**：在 `.github/workflows/ci.yml` 的 windows runner 上预装 nasm + perl
   ```yaml
   - name: Install BoringSSL build deps (Windows)
     if: runner.os == 'Windows'
     run: |
       choco install nasm strawberryperl -y
       echo "C:\Program Files\NASM" >> $env:GITHUB_PATH
   ```
3. **可行性验证**：在新分支上尝试 `cargo add wreq wreq-util && cargo check`，
   确认 BoringSSL 可构建

### 3.2 中期（2-4 周）：方案 A 落地

1. **移植 http_proxy.rs**：
   - 从 `参考项目/SPlayer-Next-forks/x01n/native/audio-engine/src/http_proxy.rs` 移植
   - 适配 Soto_Player 的日志系统（`tracing::debug` 已对齐）
   - 全局 `OnceLock<Client>` 持有 `wreq::Client`，启用 `Emulation::Firefox136`

2. **NAPI 暴露**：在 `lib.rs` 添加
   ```rust
   #[napi]
   pub async fn http_get(url: String, headers: HashMap<String, String>) -> Result<JsHttpResponse> { ... }

   #[napi]
   pub async fn http_post(url: String, headers: HashMap<String, String>, body: String) -> Result<JsHttpResponse> { ... }
   ```

3. **TypeScript 集成**：在 `electron/main/utils/fetchProxy.ts` 添加
   ```typescript
   import { httpGet, httpPost } from "../../native/audio-engine";

   export const fetchWithTlsImpersonation = async (url: string, init?: RequestInit) => {
     // 调用 NAPI http_get / http_post
   };
   ```
   仅对需要 TLS 指纹模拟的接口（QQ/网易高音质）启用，其他接口保持原生 fetch。

4. **测试验证**：
   - 单元测试：使用 `httpmock` 验证请求头与响应解析
   - 集成测试：对 QQ 音乐 / 网易云高音质接口做端到端验证
   - 性能测试：对比原生 fetch 与 wreq 的延迟差异

### 3.3 长期（1-2 月）：优化与稳定

1. **预编译 BoringSSL**：通过 `boring-sys` 的 `BORING_BSSL_PATH` 环境变量指向
   预编译静态库，将 CI 构建时间从 30 min 降至 < 5 min
2. **多浏览器指纹切换**：暴露 `emulation` 参数，支持运行时切换 Firefox/Chrome/Safari
3. **HTTP/2 指纹调优**：根据实际反爬策略调整 SETTINGS 帧参数
4. **fallback 策略**：TLS 指纹模拟失败时自动回退到原生 fetch + undici 代理

### 3.4 替代方案（若 BoringSSL 持续不可用）

| 替代方案 | 反爬效果 | 实现复杂度 | 备注 |
| --- | --- | --- | --- |
| rustls + 自定义 TLS 扩展 | 🟡 部分 | 中 | 无法真正匹配 JA3，仅绕过粗粒度检测 |
| Node.js 侧 curl-impersonate 子进程 | ✅ 完整 | 低 | 增加 IPC 开销与运行时二进制依赖 |
| 预编译 BoringSSL 二进制分发 | ✅ 完整 | 高 | 需为每个目标平台产出预编译产物 |

---

## 4. 依赖冲突分析

### 4.1 现有依赖（Soto_Player `native/audio-engine/Cargo.toml`）

| 类别 | 依赖 | 用途 |
| --- | --- | --- |
| NAPI | `napi = "3.8"`, `napi-derive = "3.5"` | Node.js 原生模块 |
| HTTP | `ureq = "2"` | http_source.rs 的 Range 流式读取 |
| 音频 | `ffmpeg_audio = "0.2"`, `rodio = "0.20"`, `cpal = "0.15"` | 解码与播放 |
| 加密 | `aes`, `cbc`, `ecb`, `cipher`, `md-5`, `hex` | NCM/QMC 等加密格式解密 |
| 推理 | `ort = "2.0.0-rc.12"`, `ndarray`, `rubato` | 神经网络上采样 |
| 异步 | `tokio = { version = "1", features = ["rt"] }` | NAPI async runtime |
| 日志 | `tracing`, `tracing-subscriber`, `tracing-appender` | 结构化日志 |
| Windows | `windows = "0.62"` (target-gated) | 进程优先级 |

### 4.2 方案 A 新增依赖

| 依赖 | 版本 | 用途 | 冲突风险 |
| --- | --- | --- | --- |
| `wreq` | `5.3.0` | HTTP 客户端（reqwest fork，支持 BoringSSL） | 🟡 低 — 与 `ureq` 共存，API 隔离 |
| `wreq-util` | `2.2.6` | 浏览器指纹 emulation 预设 | 🟢 无 — 纯辅助 crate |
| `boring-sys`（间接） | 由 wreq 传递依赖 | BoringSSL C 绑定 | 🔴 高 — 构建 chain 阻塞 |

### 4.3 潜在冲突点

1. **TLS 后端冲突**：
   - `ureq` 默认使用 `rustls`（`features = ["tls"]`）
   - `wreq` 强制使用 `boring`（BoringSSL）
   - 两者在同一个 binary 中共存技术上可行（不同 symbol），但二进制体积会包含
     **两套 TLS 实现**（rustls + BoringSSL），约 +12 MB
   - **缓解**：可考虑将 `http_source.rs` 也迁移到 `wreq`，统一 TLS 后端，
     但 `wreq` 不支持 `Read + Seek` 流式接口，迁移成本高，**不推荐**

2. **tokio runtime 冲突**：
   - 现有 `tokio = { version = "1", features = ["rt"] }` 仅启用 rt feature
   - `wreq` 需要 `tokio` 的 `net` / `io-util` / `time` 等 feature
   - **缓解**：将 `tokio` features 扩展为 `["rt", "net", "io-util", "time"]`，
     或依赖 `wreq` 传递启用

3. **tracing 版本冲突**：
   - 现有 `tracing = "0.1"`
   - `wreq` 也依赖 `tracing = "0.1"`
   - 🟢 无冲突

4. **napi 版本冲突**：
   - `wreq` 不依赖 `napi`
   - 🟢 无冲突

5. **openssl-sys vs boring-sys**：
   - 现有依赖中**无** `openssl-sys` 或 `native-tls`
   - 🟢 无冲突

### 4.4 二进制体积影响估算

| 组件 | 体积增长 | 说明 |
| --- | --- | --- |
| BoringSSL 静态库 | +5-8 MB | 静态链接到 .node |
| wreq + tokio + hyper | +2-3 MB | HTTP 客户端栈 |
| wreq-util | +0.1 MB | 指纹预设 |
| **合计** | **+7-11 MB** | 占当前 audio-engine.node 体积的 15-25% |

### 4.5 构建时间影响估算

| 阶段 | 当前 | 方案 A 后 | 增量 |
| --- | --- | --- | --- |
| 首次 `cargo build` (debug) | ~8 min | ~25-35 min | +15-25 min（BoringSSL 编译） |
| 增量 `cargo build` (debug) | ~30 s | ~30 s | 无变化（BoringSSL 已缓存） |
| CI `cargo build --release` | ~12 min | ~30-45 min | +15-30 min |

---

## 5. 风险与缓解

### 5.1 已识别风险

1. **构建链脆弱**：BoringSSL 版本升级可能破坏 `boring-sys` 构建
   - **缓解**：在 `Cargo.lock` 锁定 `boring-sys` 版本，CI 定期验证升级
2. **跨平台差异**：macOS 上 BoringSSL 需要 `go` 但不需要 `nasm`（使用系统汇编器）
   - **缓解**：CI 矩阵为每个平台单独配置构建依赖
3. **反爬策略升级**：QQ/网易可能升级指纹检测，导致 emulation 失效
   - **缓解**：定期跟进 `wreq-util` 的 emulation 版本更新
4. **二进制分发体积**：electron-builder 产物体积增长可能影响下载体验
   - **缓解**：使用 `brotli` 压缩，或考虑将 BoringSSL 作为外部动态库

### 5.2 回滚策略

若方案 A 落地后发现构建链问题持续影响开发：
1. 通过 `#[cfg(feature = "tls-impersonate")]` 将 `http_proxy.rs` 设为 feature-gated
2. 默认构建不启用该 feature，`http_proxy.rs` 编译为占位模块
3. 仅在专门构建（如 release with impersonation）时启用

---

## 6. 参考资源

- x01n fork 实现：`参考项目/SPlayer-Next-forks/x01n/native/audio-engine/src/http_proxy.rs`
- x01n fork Cargo.toml：`参考项目/SPlayer-Next-forks/x01n/native/audio-engine/Cargo.toml`
- BoringSSL 构建文档：https://boringssl.googlesource.com/boringssl/+/HEAD/BUILDING
- `boring-sys` crate：https://crates.io/crates/boring-sys
- `wreq` crate：https://crates.io/crates/wreq
- NASM 下载：https://www.nasm.us/
- Strawberry Perl：https://strawberryperl.com/
- `reqwest-impersonate`：https://crates.io/crates/reqwest-impersonate

---

## 7. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-07-28 | 初版评估，选择方案 C，创建占位模块与本评估文档 |
