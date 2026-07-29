/**
 * 代理探测工具
 */

export interface ProxyConfig {
  protocol: "http" | "https" | "socks5" | "socks4";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/** 解析代理 URL 为 ProxyConfig，无效返回 null */
export const parseProxyUrl = (url: string): ProxyConfig | null => {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(":", "") as ProxyConfig["protocol"];
    if (!["http", "https", "socks5", "socks4"].includes(protocol)) return null;
    const host = parsed.hostname;
    const port = parseInt(parsed.port, 10);
    if (!host || !port) return null;
    const config: ProxyConfig = { protocol, host, port };
    if (parsed.username) config.username = decodeURIComponent(parsed.username);
    if (parsed.password) config.password = decodeURIComponent(parsed.password);
    return config;
  } catch {
    return null;
  }
};

/** 格式化 ProxyConfig 为 URL 字符串 */
export const formatProxyUrl = (config: ProxyConfig): string => {
  const auth = config.username
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password ?? "")}@`
    : "";
  return `${config.protocol}://${auth}${config.host}:${config.port}`;
};

/** 检测代理是否可达（TCP 连接测试，超时 3s） */
export const isProxyReachable = async (config: ProxyConfig, timeoutMs = 3000): Promise<boolean> => {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
    socket.connect(config.port, config.host);
  });
};
