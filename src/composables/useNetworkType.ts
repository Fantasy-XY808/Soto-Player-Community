import type { Ref } from "vue";

/**
 * 网络类型 composable
 *
 * 用于 prefetch 动态阈值（C-1）：
 * - 'mobile' / 'weak'：阈值 × 1.5（移动网络 / 弱网提前预加载，避免切歌时长时间等待）
 * - 'wifi'：与 CPU 负载联动（cpuLoad < 0.5 时再 × 0.8）
 * - 'unknown'：dynamicFactor = 1.0（保守不调整）
 *
 * 数据源：
 * - 优先 `navigator.connection`（Chromium 支持，Electron renderer 可用）
 * - 兜底 `navigator.onLine`：离线时视为 'weak'，在线但无 connection 信息时 'unknown'
 * - 监听 `change` / `online` / `offline` 事件，reactive 更新
 *
 * 模块级共享：多组件订阅同一份状态，仅注册一次事件监听
 */

/** 网络类型分类（用于 prefetch 动态阈值） */
export type NetworkType = "wifi" | "mobile" | "weak" | "unknown";

/** 模块级共享网络类型 */
const networkType = ref<NetworkType>("unknown");

/** 是否已初始化 */
let initialized = false;

/**
 * navigator.connection 类型定义（Chromium 私有 API，TS lib.dom 未覆盖）
 *
 * - type: 'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'wimax' | 'none' | 'other' | 'unknown'
 * - effectiveType: 'slow-2g' | '2g' | '3g' | '4g'
 * - saveData: boolean（用户开启了数据节省模式）
 * - downlink: number（Mbps，10ms 采样窗口）
 * - rtt: number（ms，往返时延）
 */
interface NetworkInformationLike {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
  rtt?: number;
  addEventListener: (type: "change", listener: () => void) => void;
  removeEventListener: (type: "change", listener: () => void) => void;
}

/**
 * 推断网络类型
 *
 * 优先级：
 * 1. 离线 → 'weak'（断网必然加载缓慢）
 * 2. connection.type 显式为 'wifi' / 'ethernet' → 'wifi'
 * 3. connection.type 显式为 'cellular' / 'wimax' → 'mobile'
 * 4. effectiveType 'slow-2g' / '2g' → 'weak'
 * 5. effectiveType '3g' → 'mobile'
 * 6. effectiveType '4g' 且 type 未知 → 'wifi'（4G 通常等同 wifi 体验）
 * 7. saveData 启用 → 'weak'（用户主动请求省流量）
 * 8. rtt > 1500 或 downlink < 0.5 → 'weak'（极慢链路兜底）
 * 9. 兜底 → 'unknown'
 */
const inferNetworkType = (): NetworkType => {
  // 离线优先
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "weak";
  }

  const conn = (navigator as unknown as { connection?: NetworkInformationLike }).connection;
  if (!conn) return "unknown";

  // 显式 type 优先（Chromium 在 Electron 桌面端通常返回 'wifi' / 'ethernet'）
  if (conn.type === "wifi" || conn.type === "ethernet") return "wifi";
  if (conn.type === "cellular" || conn.type === "wimax") return "mobile";
  if (conn.type === "none") return "weak";

  // effectiveType 兜底（移动热点 / 蜂窝网络场景）
  const eff = conn.effectiveType;
  if (eff === "slow-2g" || eff === "2g") return "weak";
  if (eff === "3g") return "mobile";
  if (eff === "4g" && !conn.type) return "wifi";

  // saveData 启用：用户主动请求省流量，视为弱网
  if (conn.saveData) return "weak";

  // 链路指标兜底：RTT 极高或下行极低 → weak
  if (typeof conn.rtt === "number" && conn.rtt > 1500) return "weak";
  if (typeof conn.downlink === "number" && conn.downlink > 0 && conn.downlink < 0.5) {
    return "weak";
  }

  return "unknown";
};

/** 重新计算并更新 networkType */
const refresh = (): void => {
  networkType.value = inferNetworkType();
};

/**
 * 初始化：首次推断 + 注册事件监听
 *
 * 多次调用幂等。
 */
const init = (): void => {
  if (initialized) return;
  initialized = true;

  refresh();

  // navigator.connection change：Chromium 在网络切换时触发
  const conn = (navigator as unknown as { connection?: NetworkInformationLike }).connection;
  if (conn) {
    conn.addEventListener("change", refresh);
  }

  // online / offline：兜底，所有浏览器都支持
  if (typeof window !== "undefined") {
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
  }
};

/**
 * 网络类型 composable
 *
 * @returns networkType: 'wifi' | 'mobile' | 'weak' | 'unknown'
 */
export const useNetworkType = (): { networkType: Ref<NetworkType> } => {
  init();
  return { networkType };
};
