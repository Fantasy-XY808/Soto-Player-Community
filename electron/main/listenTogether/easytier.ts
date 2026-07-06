/**
 * EasyTier P2P 内网穿透管理（全平台内嵌二进制版）
 *
 * 应用打包时已内嵌 Windows / macOS / Linux 全平台（x64 / arm64）
 * easytier-core 二进制，用户开箱即用，无需任何额外安装或配置。
 *
 * 主机端：startHost 自动生成网络名 + 密钥并启动 EasyTier，对外只暴露分享码。
 * 客户端：joinSession 解析分享码自动启动 EasyTier，连入同一虚拟网络后连接 ws。
 *
 * 一起听功能基于 EasyTier（https://github.com/EasyTier/EasyTier）实现。
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ltLog } from "@main/utils/logger";

/** EasyTier 运行时状态 */
export interface EasyTierStatus {
  running: boolean;
  virtualIp: string | null;
  networkName: string;
  networkSecret: string;
  error: string | null;
  /** 已连接的 peer 数量（含主机/中继节点）。UI 据此判断是否有房客接入 */
  peerCount: number;
  /** 客户端模式：本地 SOCKS5 代理是否已就绪（TCP 探测 127.0.0.1:51880 可连） */
  socks5Ready: boolean;
}

/** 运行中的 easytier-core 进程 */
let processRef: ChildProcess | null = null;
/** 最近一次解析到的虚拟 IP */
let currentVirtualIp: string | null = null;
/** 最近一次错误 */
let lastError: string | null = null;
/** 当前使用的网络名 */
let currentNetworkName = "soto-player";
/** 当前使用的网络密钥 */
let currentNetworkSecret = "";
/** stdout 环形缓冲区（用于解析跨行信息） */
let stdoutBuffer = "";
/** 已连接的 peer 数量（解析 stdout 维护，UI 据此判断房客是否接入） */
let currentPeerCount = 0;
/** 客户端模式：本地 SOCKS5 代理是否已就绪（TCP 探测 127.0.0.1:51880 可连） */
let currentSocks5Ready = false;
/** 客户端模式：SOCKS5 端口 TCP 探测定时器（每 200ms 探测一次直到成功或进程退出） */
let socks5ProbeTimer: NodeJS.Timeout | null = null;
/** 进程意外退出时的回调（client.ts 注册用于触发 exitClientMode） */
let exitHandler: ((code: number | null) => void) | null = null;

/**
 * 公共发现服务器列表，跨局域网通过它们互相发现
 * 按优先级排列，主服务器不可达时 EasyTier 会自动尝试后续节点
 *
 * 此前使用官方域名 public.easytier.cn / easytier.1ipv4.cn / ktyyu.easytier.cn，
 * 但这三个域名已于 2026 年某时点被官方下线（DNS 返回 NXDomain，父域 easytier.cn 的 SOA
 * serial 显示 2026-06-05 仍有更新，确认 DNS 解析正常工作，是子域确实不存在），
 * 导致所有跨局域网连接的客户端无法互相发现。
 *
 * 现改为社区维护的公共节点（来源：https://easytier.gd.nkbpal.cn/status/easytier，
 * 2026-07-05 检查时 uptime 均 ≥ 91%）。
 * EasyTier 是去中心化的，多节点列表能在单节点故障时自动 fallback。
 */
const PUBLIC_PEERS = [
  // 国内节点（低延迟，主用）
  "tcp://et1.fuis.top:11010", // 湖北武汉/火山云 100% uptime
  "tcp://mc.yqst.top:11010", // 湖南邵阳/电信 91.44% uptime
  "tcp://225284.xyz:11010", // 中国上海/电信 91.83% uptime
  "tcp://39.108.52.138:11010", // 广东深圳/阿里云 94.77% uptime
  // 海外节点（兜底，国内不可达时使用）
  "tcp://38.147.105.178:11010", // 美国盐湖城 100% uptime
];
/** 主机端固定虚拟 IP（客户端经 DHCP 自动从同子网获取） */
const HOST_VIRTUAL_IP = "10.144.144.1/24";
/** 主机端虚拟 IP（不含 CIDR），客户端经 SOCKS5 代理连接此地址 */
export const HOST_VIRTUAL_IP_ADDR = "10.144.144.1";
/**
 * 客户端 SOCKS5 代理监听端口
 *
 * 不使用 1080（Shadowsocks/V2Ray/Clash 等代理软件事实标准端口，常被占用导致 EasyTier
 * bind 失败）。51880 是 Soto Player 专属高位端口，冲突概率极低。
 */
export const SOCKS5_PORT = 51880;

/** 平台 + 架构对应的子目录名（与 electron-builder ${os}-${arch} 一致） */
const getPlatformDir = (): string => {
  const platform =
    process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${platform}-${arch}`;
};

/** 平台对应的可执行文件名 */
const BINARY_NAME = process.platform === "win32" ? "easytier-core.exe" : "easytier-core";

/**
 * 解析内嵌 easytier-core 二进制路径
 *
 * 生产环境：resources/native/easytier/easytier-core[.exe]
 * 开发环境：项目根目录 native/easytier/<platform-arch>/easytier-core[.exe]
 */
const resolveBundledBinary = (): string | null => {
  const platformDir = getPlatformDir();

  // 生产环境：process.resourcesPath/native/easytier/easytier-core[.exe]
  if (process.env.NODE_ENV === "production" || !process.env.ELECTRON_RENDERER_URL) {
    const resourcesPath = process.resourcesPath ?? "";
    const prodPath = path.join(resourcesPath, "native", "easytier", BINARY_NAME);
    if (existsSync(prodPath)) return prodPath;
    // electron-builder asarUnpack 的另一种路径
    const altPath = path.join(
      resourcesPath,
      "app.asar.unpacked",
      "native",
      "easytier",
      BINARY_NAME,
    );
    if (existsSync(altPath)) return altPath;
  }

  // 开发环境：native/easytier/<platform-arch>/easytier-core[.exe]
  const devCandidates = [
    path.join(process.cwd(), "native", "easytier", platformDir, BINARY_NAME),
    path.join(__dirname, "..", "..", "..", "..", "native", "easytier", platformDir, BINARY_NAME),
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "native",
      "easytier",
      platformDir,
      BINARY_NAME,
    ),
  ];
  for (const candidate of devCandidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(resolved)) return resolved;
  }

  return null;
};

/**
 * 查找 easytier-core 可执行文件（仅内嵌）
 * @returns 可执行文件绝对路径；找不到返回 null
 */
export const findEasyTierBinary = (): string | null => {
  const bundled = resolveBundledBinary();
  if (bundled) {
    ltLog.info(`[easytier] 使用内嵌二进制: ${bundled}`);
    return bundled;
  }
  return null;
};

/**
 * 从文本中匹配 EasyTier 虚拟 IP
 *
 * 实测 EasyTier v2.6.4 输出格式（按优先级匹配）：
 * 1. 客户端 DHCP 分配事件：
 *    `dhcp ip changed old=None new=Some(10.126.126.1/24)`
 *    同时也会触发 OSPF 事件：`DhcpIpv4Changed(None, Some(10.126.126.1/24))`
 * 2. 主机静态 IP 启动行（首条日志）：
 *    `ipv4: AtomicCell { value: Some(10.144.144.1/24) }`
 * 3. 兜底：任意 10.x.x.x（带或不带 CIDR）— 用于未知输出格式兜底
 */
const extractVirtualIp = (text: string): string | null => {
  // 客户端 DHCP 分配事件（最权威）
  const dhcp = text.match(
    /dhcp ip changed\s+old=\S+\s+new=Some\((\d{1,3}(?:\.\d{1,3}){3})\/\d{1,2}\)/,
  );
  if (dhcp) return dhcp[1];
  // OSPF DhcpIpv4Changed 事件（与上面同时触发，作为冗余备份）
  const ospfDhcp = text.match(
    /DhcpIpv4Changed\([^,]+,\s*Some\((\d{1,3}(?:\.\d{1,3}){3})\/\d{1,2}\)\)/,
  );
  if (ospfDhcp) return ospfDhcp[1];
  // 主机静态 IP 启动行（AtomicCell 内部值）
  const atomic = text.match(
    /ipv4:\s*AtomicCell\s*\{\s*value:\s*Some\((\d{1,3}(?:\.\d{1,3}){3})\/\d{1,2}\)\s*\}/,
  );
  if (atomic) return atomic[1];
  // 兜底：任意 10.x.x.x（带或不带 CIDR）
  const any = text.match(/\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:\/\d{1,2})?\b/);
  return any ? any[1] : null;
};

/**
 * 解析单块输出，提取虚拟 IP / peer 数 / 错误信息 / 端口转发就绪状态
 *
 * peer 数维护：EasyTier 输出 "peer added" / "Connected to peer" 表示新增 peer，
 * "peer removed" / "peer disconnected" 表示 peer 离开。这里做粗略计数——
 * 解析每条事件并增减 currentPeerCount，UI 据此判断是否有房客接入。
 *
 * 成功事件清空 lastError：当看到 "dhcp ip changed" 或 "Connected to peer"
 * 说明虚拟网络工作正常，清掉陈旧错误避免 UI 误显示。
 */
const parseOutput = (chunk: string): void => {
  stdoutBuffer += chunk;
  const lines = chunk.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) ltLog.info(`[easytier:out] ${trimmed}`);
    // peer 计数：匹配 EasyTier 实际输出格式
    if (/peer added|connected to peer|peer connected/i.test(trimmed)) {
      currentPeerCount++;
      // 连接成功说明虚拟网络正常，清掉陈旧错误
      lastError = null;
    } else if (/peer removed|peer disconnected|peer lost/i.test(trimmed)) {
      if (currentPeerCount > 0) currentPeerCount--;
    }
    // SOCKS5 任务创建：EasyTier v2.6.4 启动 SOCKS5 时输出 `origin="Socks5ServerNet"`
    // 仅表示任务已创建，不代表端口已 bind 成功（实测 bind 完成晚于该日志约 100-500ms）。
    // 真正的就绪检测由 startSocks5Probe 中的 TCP 探测保证（127.0.0.1:51880 可连即就绪）。
    // 此处仅作为日志信号，不更新 currentSocks5Ready（避免过早标记导致首连接失败）。
    if (/Socks5ServerNet|socks5.*listening|socks5.*bound/i.test(trimmed)) {
      ltLog.info("[easytier] SOCKS5 任务已创建，等待 TCP 探测确认监听就绪");
    }
  }
  const ip = extractVirtualIp(stdoutBuffer);
  if (ip && ip !== currentVirtualIp) {
    currentVirtualIp = ip;
    ltLog.info(`[easytier] 虚拟 IP: ${ip}`);
    // 拿到虚拟 IP 说明虚拟网络工作正常，清掉陈旧错误
    lastError = null;
  }
  // 持续扫描最新错误行：取最后一条匹配，便于反映"当前"失败状态
  // （此前 !lastError 守卫导致首次错误后无法被后续更具体的错误覆盖）
  const lower = stdoutBuffer.toLowerCase();
  if (lower.includes("error") || lower.includes("failed") || lower.includes("panic")) {
    let lastErrLine: string | null = null;
    for (const l of lines) {
      if (!/error|failed|panic/i.test(l)) continue;
      // 跳过非致命警告（这些 EasyTier 自身会自动 fallback，不影响功能）：
      // - connect to peer error / ConnectError / connect timeout：单 peer 连接
      //   失败/超时，EasyTier 自动尝试后续 peer（PUBLIC_PEERS 列表中多个节点）
      // - stun.*failed / udp recv_from error：STUN NAT 检测中单个 UDP socket
      //   接收失败，EasyTier 有多个 STUN socket 兜底
      // - bind addr fail + 含 169.254：本地源地址绑定失败，链路本地地址
      //   （来自系统中无 DHCP 的虚拟网卡如 VirtualBox/Hyper-V/VMware），Windows
      //   不允许绑定到不可路由地址，EasyTier 会改用其他本地地址（如 192.168.x.x）
      //   重试，连接仍能成功
      //   注意：仅当含 169.254 时才跳过；其他 "bind addr fail"（如端口转发监听
      //   端口被占用）是真实错误，必须报给 UI
      if (/connect to peer error/i.test(l)) continue;
      if (/connecterror/i.test(l)) continue;
      if (/connect timeout/i.test(l)) continue;
      if (/stun.*failed/i.test(l)) continue;
      if (/udp recv_from error/i.test(l)) continue;
      if (/bind addr fail/i.test(l) && /169\.254\./i.test(l)) continue;
      lastErrLine = l.trim();
    }
    if (lastErrLine) lastError = lastErrLine;
  }
  // 截断时保留末尾 8KB（最新输出），避免 DHCP 事件被覆盖丢失
  if (stdoutBuffer.length > 16_000) {
    stdoutBuffer = stdoutBuffer.slice(-8_000);
  }
};

/**
 * 生成 6 位易读分享码：大写字母 + 数字，去除易混淆字符（0/O/I/1）
 * 分享码同时作为 EasyTier 网络密钥，主机与客户端输入同一码即可连入同一虚拟网络。
 */
const SHARE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const generateShareCode = (): string => {
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += SHARE_CODE_ALPHABET[bytes[i]! % SHARE_CODE_ALPHABET.length];
  }
  return out;
};

/**
 * 校验分享码合法性：6 位，字符 ∈ SHARE_CODE_ALPHABET
 */
export const isValidShareCode = (code: string): boolean => {
  if (code.length !== 6) return false;
  for (const ch of code) {
    if (!SHARE_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
};

// --no-tun 模式下无需管理员权限、无需提权、无需清理 WinTUN 适配器
// 这些函数已移除，避免与用户 VPN 的 TUN 模块冲突

/**
 * 启动 EasyTier
 *
 * 基于 EasyTier 官方文档 https://easytier.cn/guide/network/no-root.html 的途径 B：
 * 两端均使用 --no-tun 模式（免管理员权限），客户端通过 SOCKS5 代理访问主机虚拟 IP。
 *
 * 官方文档原文：
 * > 使用无 TUN 模式组网时，节点可以通过虚拟 IP 被访问（TCP、UDP 和 ICMP 都支持），
 * > 也可以做子网代理（使用 -n 参数）。但是无法主动发起对其他节点的访问。
 * > 为了在无 TUN 模式下主动访问其他节点，可使用 EasyTier 的 SOCKS5 服务器功能。
 *
 * - 主机端：`--no-tun -i 10.144.144.1/24 --no-listener`。EasyTier 让主机虚拟 IP
 *   （10.144.144.1）可被其他节点通过虚拟 IP 入站访问（TCP/UDP/ICMP），主机本机
 *   WebSocket 服务监听 0.0.0.0:port 即可被客户端经虚拟 IP:port 访问。无需 -n 子网代理。
 * - 客户端：`--no-tun --dhcp --socks5 51880 --no-listener`。EasyTier 在本地
 *   0.0.0.0:51880 启动 SOCKS5 代理（注意：源码硬编码监听 0.0.0.0 而非 127.0.0.1，
 *   同局域网其他机器可访问；SocksProxyAgent 仅连 127.0.0.1 保证本机使用）。
 *   客户端 WebSocket 通过 SocksProxyAgent 经此代理连接 ws://10.144.144.1:<port>，
 *   由 EasyTier 虚拟网络送达主机 TcpProxy。
 *
 * `--no-listener` 由官方文档 configurations.md 明确推荐用于禁用节点间监听器
 * （旧实现 `--listeners 0` 实际被解析为端口 0 = OS 分配随机端口仍在监听，与意图不符）。
 *
 * 该方案无需管理员权限、不创建 TUN 设备，避免与用户 VPN 的 TUN 模块冲突。
 *
 * @param networkName - 网络名（空值时使用默认）
 * @param networkSecret - 网络密钥（空值时自动生成 6 位分享码）
 * @param mode - "host" 用静态 IP（10.144.144.1/24）；"client" 用 DHCP 自动获取
 * @returns 启动是否成功
 */
export const startEasyTier = async (
  networkName: string,
  networkSecret: string,
  mode: "host" | "client" = "host",
): Promise<boolean> => {
  // 先同步停止旧实例（包括等待进程退出），避免端口/资源冲突
  await stopEasyTier();
  stdoutBuffer = "";
  currentVirtualIp = null;
  lastError = null;
  currentPeerCount = 0;
  currentSocks5Ready = false;
  currentNetworkName = networkName || "soto-player";
  currentNetworkSecret = networkSecret || generateShareCode();

  const binary = findEasyTierBinary();
  if (!binary) {
    lastError = "EasyTier 二进制文件缺失，请重新安装应用";
    ltLog.warn("[easytier] 未找到 easytier-core 二进制");
    // 失败路径清理：避免 currentNetworkSecret 残留导致 UI 显示失效邀请
    currentNetworkSecret = "";
    currentNetworkName = "soto-player";
    return false;
  }

  // --no-tun 模式下不创建 WinTUN 虚拟网卡，无需 wintun.dll 也无需管理员权限，
  // 避免与用户 VPN 的 TUN 模块冲突。DHCP 仍会分配虚拟 IP，但不参与 OS 路由。
  // 跨网穿透通过 EasyTier 内置 TcpProxy（主机入站）+ SOCKS5 代理（客户端出站）实现。

  // 必须有 -i 或 --dhcp 才会分配虚拟 IP；双方都通过公共发现服务器互相发现
  // --no-listener：禁用节点间 peer 监听器（不监听任何端口，仅作为发起方连接到 -p 节点）。
  // 此前用 `--listeners 0`，但官方源码 core.rs:811-816 显示 "0" 被解析为端口 0
  // （OS 分配随机端口），EasyTier 仍在 0.0.0.0:0 监听，与意图不符。
  // 官方文档 configurations.md 明确推荐 `--no-listener` 用于真正禁用监听。
  const args = [
    "--network-name",
    currentNetworkName,
    "--network-secret",
    currentNetworkSecret,
    "--console-log-level",
    "info",
    "--no-tun",
    "--no-listener",
  ];
  // 添加所有公共发现服务器（多个 -p 参数，EasyTier 会依次尝试）
  for (const peer of PUBLIC_PEERS) {
    args.push("-p", peer);
  }
  if (mode === "host") {
    // 主机端：固定虚拟 IP 10.144.144.1，--no-tun 模式下 TcpProxy 自动处理入站流量
    // 无需 -n 子网代理（主机本机服务通过虚拟 IP 直接可达）
    args.unshift("-i", HOST_VIRTUAL_IP);
    // 主机端虚拟 IP 已知（静态配置），立即写入避免依赖 stdout 解析
    // （实测 v2.6.4 主机模式不输出 "dhcp ip changed"，依赖 AtomicCell 行正则匹配，
    //  但 AtomicCell 行可能在首条日志之前被缓冲区切片丢弃，立即写入更可靠）
    currentVirtualIp = HOST_VIRTUAL_IP_ADDR;
  } else {
    // 客户端：DHCP 自动获取虚拟 IP
    args.push("--dhcp");
    // SOCKS5 代理：EasyTier 在本地 0.0.0.0:<SOCKS5_PORT> 启动 SOCKS5 服务器
    // （官方源码 core.rs:1028 硬编码 socks5://0.0.0.0:<port>，监听所有接口；
    //  SocksProxyAgent 仅连 127.0.0.1 保证本机使用，避免对外暴露）
    // 客户端 WebSocket 通过 SocksProxyAgent 经此代理连接主机虚拟 IP:port
    // （--no-tun 模式下无法主动发起对其他节点的访问，必须走 SOCKS5 代理）
    args.push("--socks5", String(SOCKS5_PORT));
  }

  ltLog.info(`[easytier] 启动 (${mode}): ${binary} ${args.join(" ")}`);

  try {
    // --no-tun 模式下不创建 TUN 设备，无需管理员权限，直接启动即可
    const child = spawn(binary, args, {
      detached: false,
      windowsHide: true,
    });
    processRef = child;

    child.stdout?.on("data", (data: Buffer) => parseOutput(data.toString()));
    child.stderr?.on("data", (data: Buffer) => parseOutput(data.toString()));

    child.on("error", (err) => {
      ltLog.error("[easytier] 进程错误:", err);
      lastError = err.message;
      processRef = null;
    });

    child.on("exit", (code) => {
      ltLog.warn(`[easytier] 进程退出: code=${code}`);
      const wasRunning = processRef === child;
      if (wasRunning) {
        processRef = null;
        currentVirtualIp = null;
        currentPeerCount = 0;
        currentSocks5Ready = false;
        // 停止 SOCKS5 TCP 探测定时器（进程已退出，探测无意义）
        stopSocks5Probe();
      }
      if (!lastError && code !== 0 && code !== null) {
        lastError = `easytier-core 异常退出 (code ${code})`;
      }
      // 通知 client.ts 进程意外退出（用于触发 exitClientMode + 避免无限重连）
      if (wasRunning && exitHandler) {
        try {
          exitHandler(code);
        } catch (err) {
          ltLog.warn("[easytier] exitHandler 执行异常:", err);
        }
      }
    });

    // 客户端模式：启动 SOCKS5 端口 TCP 探测定时器
    // 不依赖 stdout 文本（Socks5ServerNet 仅表示任务创建，不代表端口 bind 成功），
    // 真正就绪以 TCP 探测 127.0.0.1:51880 可连为准。client.ts 在 connect() 前
    // 调用 waitForSocks5Ready() 等待此信号，避免首连接因 SOCKS5 未就绪而失败。
    if (mode === "client") {
      startSocks5Probe();
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ltLog.error("[easytier] 启动失败:", err);
    lastError = msg;
    return false;
  }
};

/**
 * 注册 EasyTier 进程意外退出回调
 *
 * client.ts 在 joinSession 时注册，用于在 EasyTier 崩溃时主动 exitClientMode，
 * 避免客户端 WebSocket 无限重连已失效的 127.0.0.1 端口转发。
 *
 * 主动 stopEasyTier 不触发此回调（仅 processRef === child 时才触发），
 * 避免客户端主动离开时被回调打扰。
 *
 * @param handler - 进程退出回调，参数为退出码（null 表示被信号杀死）
 */
export const onProcessExit = (handler: ((code: number | null) => void) | null): void => {
  exitHandler = handler;
};

/**
 * 停止 EasyTier 进程
 *
 * 改为 async 以便等待进程真正退出（避免重启时旧实例仍占用端口/资源）。
 * Windows 下仅按 PID 杀整个进程树，不再用 `/IM easytier-core.exe` 杀全部同名进程
 * ——后者会误杀其他应用（或用户其他会话）的 easytier-core.exe，造成连带故障。
 *
 * Windows SIGKILL 兜底：taskkill 失败（PID 已回收 / 权限不足 / UAC 拒绝）时
 * 进程未被真正杀死。Node.js 在 Windows 上 child.kill("SIGKILL") 会调
 * TerminateProcess，可作跨平台兜底。此前 `process.platform !== "win32"` 守卫
 * 跳过 Windows 的 SIGKILL，导致进程残留。改为统一兜底。
 *
 * processRef 时机：移到 await 之后置 null，避免 2s 等待窗口内 getEasyTierStatus
 * 返回 running:false 但实际进程仍存活的状态错乱。
 */
export const stopEasyTier = async (): Promise<void> => {
  const child = processRef;
  // 清掉 exitHandler 避免主动停止时触发回调
  exitHandler = null;
  // 停止 SOCKS5 TCP 探测定时器（无论有无进程都清，防止跨次启动残留）
  stopSocks5Probe();
  if (!child) {
    currentVirtualIp = null;
    currentPeerCount = 0;
    currentSocks5Ready = false;
    // 无进程时也清掉残留的 network 配置，避免下次 getEasyTierStatus 返回脏数据
    // （此前 stopEasyTier 未重置 currentNetworkSecret / currentNetworkName / lastError，
    //  停止后 HostDialog 仍能拿到上一次的分享码，可能引导用户复制失效邀请）
    currentNetworkSecret = "";
    currentNetworkName = "soto-player";
    lastError = null;
    return;
  }
  // 标记停止中（仅清空 currentVirtualIp，processRef 留到 await 之后才置 null）
  currentVirtualIp = null;
  currentPeerCount = 0;
  currentSocks5Ready = false;
  try {
    // removeAllListeners 后 exit 事件不会触发，wasRunning 守卫已无意义，但保留 try 内的清理
    child.removeAllListeners();
    if (!child.killed) {
      if (process.platform === "win32" && typeof child.pid === "number") {
        // 检查 taskkill 返回码：非 0 表示失败，需要后续 SIGKILL 兜底
        const res = spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
          windowsHide: true,
          stdio: "ignore",
        });
        if (res.status !== 0) {
          ltLog.warn(`[easytier] taskkill 退出码 ${res.status}，将走 SIGKILL 兜底`);
        }
      } else {
        child.kill("SIGTERM");
      }
    }
    // 等待最多 2s 让进程退出；超时则强制 SIGKILL 兜底（跨平台）
    // 修复：此前 `!child.killed || !taskkillOk` 守卫中 child.killed 在 Windows 上
    // 永远为 false（taskkill 是外部命令不更新 Node 内部 killed 标志），导致 SIGKILL
    // 兜底总是执行，2s 等待形同虚设。改为用 done 标志判断 exit 是否已触发。
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      child.once("exit", finish);
      setTimeout(() => {
        if (!done) {
          // 2s 内未 exit，强制 SIGKILL 兜底
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
        finish();
      }, 2000);
    });
  } catch (err) {
    ltLog.warn("[easytier] 停止进程异常:", err);
  } finally {
    // await 完成后才置 null，期间 getEasyTierStatus 可正确返回 running 状态
    processRef = null;
    // 同步清理 network 配置与错误，避免下次 getEasyTierStatus 返回脏数据
    // （此前仅清 currentVirtualIp，停止后 HostDialog 仍能拿到上一次的分享码，
    //  用户复制失效邀请给房客，房客用旧分享码加入虚拟网络会失败）
    currentNetworkSecret = "";
    currentNetworkName = "soto-player";
    lastError = null;
  }
};

/**
 * 等待虚拟 IP 分配（带超时）
 *
 * 默认 15s（此前 30s 偏长：实际 EasyTier 启动后 1-3s 内即可拿到虚拟 IP，
 * 二进制缺失或公共节点全部不可达时 30s 让用户等待过久）。
 */
export const waitForVirtualIp = (timeoutMs = 15_000): Promise<string | null> =>
  new Promise((resolve) => {
    if (currentVirtualIp) {
      resolve(currentVirtualIp);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      if (currentVirtualIp) {
        clearInterval(timer);
        resolve(currentVirtualIp);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 300);
  });

/**
 * 单次 TCP 探测 127.0.0.1:<SOCKS5_PORT> 是否可连
 *
 * EasyTier v2.6.4 启动 SOCKS5 时输出的 `origin="Socks5ServerNet"` 仅表示任务创建，
 * 实测 bind 完成晚于该日志约 100-500ms。直接以 stdout 文本作为就绪信号会导致
 * 首个 WebSocket 连接因 SOCKS5 端口未 bind 而失败（ECONNREFUSED），触发 8s 握手
 * 超时 + 指数退避重连，用户感知"加入失败"。
 *
 * 本函数用 net.createConnection 做真实 TCP 三次握手，可连即代表 SOCKS5 已就绪。
 * 超时 500ms 避免单次探测卡住（端口未 bind 时 OS 通常立即返回 ECONNREFUSED）。
 *
 * @returns true=可连(SOCKS5 已就绪); false=不可连(未就绪或已停止)
 */
const probeSocks5 = (): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port: SOCKS5_PORT,
    });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });

/**
 * 启动 SOCKS5 TCP 探测定时器
 *
 * 每 200ms 探测一次 127.0.0.1:<SOCKS5_PORT>，探测成功后：
 * 1. 设置 currentSocks5Ready = true（UI 与 client.ts 据此判断就绪）
 * 2. 停止定时器（无需继续探测，直到进程退出由 stopEasyTier 清理）
 *
 * 由 startEasyTier 客户端模式在 spawn 成功后调用。
 * 即便 stdout 一直不输出 Socks5ServerNet（不同 EasyTier 版本输出可能变化），
 * TCP 探测也能可靠判断真实就绪状态，跨版本兼容性更好。
 *
 * 并发安全：probeInFlight 标志防止 setInterval 在前一次 probe 未完成时堆积。
 * await 后再次检查 processRef，避免 await 期间进程退出导致 in-flight probe
 * 在 currentSocks5Ready=false 后又覆盖为 true（race condition）。
 */
let probeInFlight = false;
const startSocks5Probe = (): void => {
  stopSocks5Probe();
  currentSocks5Ready = false;
  probeInFlight = false;
  socks5ProbeTimer = setInterval(async () => {
    // 防止 setInterval 并发堆积（probe 慢于 200ms 时）
    if (probeInFlight) return;
    // await 前检查 processRef，进程已退出则停止探测
    if (!processRef) {
      stopSocks5Probe();
      return;
    }
    probeInFlight = true;
    try {
      const ok = await probeSocks5();
      // await 后再次检查 processRef，防止 race（进程在 await 期间退出）
      if (!processRef) return;
      if (ok) {
        currentSocks5Ready = true;
        stopSocks5Probe();
        ltLog.info(`[easytier] SOCKS5 代理已就绪 (127.0.0.1:${SOCKS5_PORT} 可连)`);
      }
    } finally {
      probeInFlight = false;
    }
  }, 200);
};

/**
 * 停止 SOCKS5 TCP 探测定时器
 *
 * 由 stopEasyTier / 进程 exit 回调 / startSocks5Probe 自身（探测成功后）调用。
 * 不重置 currentSocks5Ready（由调用方按场景决定：stopEasyTier 重置为 false，
 * 进程 exit 回调重置为 false，startSocks5Probe 调用前重置为 false）。
 */
const stopSocks5Probe = (): void => {
  if (socks5ProbeTimer) {
    clearInterval(socks5ProbeTimer);
    socks5ProbeTimer = null;
  }
};

/**
 * 等待 SOCKS5 代理就绪（带超时）
 *
 * client.ts 在 joinSession 中调用：在 waitForVirtualIp() 之后、connect() 之前等待。
 * 默认 15s 超时（与 waitForVirtualIp 一致），实测 EasyTier 启动后 1-3s 内 SOCKS5
 * 即可就绪。超时返回 false 由调用方决定是否继续（client.ts 当前选择继续连接让
 * OS 返回 ECONNREFUSED，触发重连——超时本身就是异常情况，应少见）。
 *
 * @returns true=已就绪; false=超时未就绪
 */
export const waitForSocks5Ready = (timeoutMs = 15_000): Promise<boolean> =>
  new Promise((resolve) => {
    if (currentSocks5Ready) {
      resolve(true);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      if (currentSocks5Ready) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (!processRef) {
        // 进程已退出，无需继续等待
        clearInterval(timer);
        resolve(false);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });

/**
 * 获取当前 EasyTier 状态
 */
export const getEasyTierStatus = (): EasyTierStatus => ({
  running: processRef !== null && !processRef.killed,
  virtualIp: currentVirtualIp,
  networkName: currentNetworkName,
  networkSecret: currentNetworkSecret,
  error: lastError,
  peerCount: currentPeerCount,
  socks5Ready: currentSocks5Ready,
});