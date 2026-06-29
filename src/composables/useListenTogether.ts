import type {
  ListenTogetherDiscoveredSession,
  ListenTogetherLocalUser,
  ListenTogetherStatus,
} from "@shared/types/settings";

/** 默认状态（idle） */
const DEFAULT_STATUS: ListenTogetherStatus = {
  role: "idle",
  hostAddress: null,
  hostPort: null,
  hasPassword: false,
  members: [],
  clientUrl: null,
  hostName: null,
  latency: 0,
  lastError: null,
};

/** 模块级单例状态：所有组件共享同一份订阅，避免重复 IPC */
const status = ref<ListenTogetherStatus>({ ...DEFAULT_STATUS });
const localUser = ref<ListenTogetherLocalUser | null>(null);
const discoveredSessions = ref<ListenTogetherDiscoveredSession[]>([]);

let unsubStatus: (() => void) | null = null;
let unsubDiscovered: (() => void) | null = null;
/** 引用计数：状态订阅 */
let statusRefCount = 0;
/** 引用计数：发现订阅 */
let discoveryRefCount = 0;

/** 主机模式：监听地址 */
const hostAddress = computed(() =>
  status.value.role === "host" && status.value.hostAddress && status.value.hostPort
    ? `${status.value.hostAddress}:${status.value.hostPort}`
    : null,
);

/** 客户端模式：连接的主机 URL */
const clientUrl = computed(() => (status.value.role === "client" ? status.value.clientUrl : null));

/** 订阅状态（首次调用时建立 IPC 订阅，引用计数归零时释放） */
const subscribeStatus = async (): Promise<void> => {
  statusRefCount++;
  if (unsubStatus) return;
  status.value = await window.api.listenTogether.getStatus();
  unsubStatus = window.api.listenTogether.onStatus((next) => {
    status.value = next;
  });
};

/** 取消状态订阅（引用计数） */
const unsubscribeStatus = (): void => {
  if (statusRefCount > 0) statusRefCount--;
  if (statusRefCount === 0 && unsubStatus) {
    unsubStatus();
    unsubStatus = null;
  }
};

/** 开始 mDNS 浏览（引用计数） */
const startBrowse = (): void => {
  discoveryRefCount++;
  if (unsubDiscovered) return;
  unsubDiscovered = window.api.listenTogether.onDiscovered((sessions) => {
    discoveredSessions.value = sessions;
  });
  window.api.listenTogether.browseSessions();
  void window.api.listenTogether.getDiscoveredSessions().then((sessions) => {
    discoveredSessions.value = sessions;
  });
};

/** 停止浏览（引用计数） */
const stopBrowse = (): void => {
  if (discoveryRefCount > 0) discoveryRefCount--;
  if (discoveryRefCount === 0) {
    if (unsubDiscovered) {
      unsubDiscovered();
      unsubDiscovered = null;
    }
    window.api.listenTogether.stopBrowse();
    discoveredSessions.value = [];
  }
};

/** 一起听运行时状态与操作
 *
 * 单例模式：所有组件共享同一份 IPC 订阅与 ref 状态，
 * 内部用引用计数管理生命周期，避免重复订阅。
 */
export const useListenTogether = () => {
  /** 查询本地网易云登录态 */
  const refreshLocalUser = async (): Promise<ListenTogetherLocalUser | null> => {
    localUser.value = await window.api.listenTogether.getLocalUserInfo();
    return localUser.value;
  };

  /** 启动主机模式 */
  const startHost = (
    name: string,
    password: string,
  ): Promise<{ ok: boolean; address: string | null; error?: string }> =>
    window.api.listenTogether.startHost(name, password);

  /** 停止主机模式 */
  const stopHost = (): Promise<void> => window.api.listenTogether.stopHost();

  /** 加入会话 */
  const joinSession = (url: string, password: string): Promise<{ ok: boolean; error?: string }> =>
    window.api.listenTogether.joinSession(url, password);

  /** 离开会话 */
  const leaveSession = (): Promise<void> => window.api.listenTogether.leaveSession();

  /** 主机端：通知队列更新 */
  const notifyQueueUpdate = (queue: unknown[], currentIndex: number): void => {
    window.api.listenTogether.notifyQueueUpdate(queue as never, currentIndex);
  };

  onMounted(() => {
    void subscribeStatus();
  });

  onBeforeUnmount(() => {
    unsubscribeStatus();
  });

  return {
    status,
    localUser,
    discoveredSessions,
    hostAddress,
    clientUrl,
    refreshLocalUser,
    startHost,
    stopHost,
    joinSession,
    leaveSession,
    startBrowse,
    stopBrowse,
    notifyQueueUpdate,
  };
};
