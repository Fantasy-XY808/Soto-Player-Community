<script setup lang="ts">
import { useListenTogether } from "@/composables/useListenTogether";
import { toast } from "@/composables/useToast";
import HostDialog from "./HostDialog.vue";
import JoinDialog from "./JoinDialog.vue";
import IconLucideUsers from "~icons/lucide/users";
import IconLucideRadio from "~icons/lucide/radio";
import IconLucideLogIn from "~icons/lucide/log-in";
import IconLucideSignal from "~icons/lucide/signal";
import IconLucideAlertCircle from "~icons/lucide/alert-circle";

const { t } = useI18n();

const { status, hostAddress, clientUrl, stopHost, leaveSession } = useListenTogether();

const hostDialogOpen = ref(false);
const joinDialogOpen = ref(false);
const stopping = ref(false);
const leaving = ref(false);

/** EasyTier 状态（主机模式下轮询，用于显示虚拟 IP + 复制邀请文本时取分享码） */
const easyTierStatus = ref<{
  running: boolean;
  virtualIp: string | null;
  networkName: string;
  networkSecret: string;
  error: string | null;
  peerCount: number;
  socks5Ready: boolean;
}>({
  running: false,
  virtualIp: null,
  networkName: "soto-player",
  networkSecret: "",
  error: null,
  peerCount: 0,
  socks5Ready: false,
});
let easyTierStatusTimer: ReturnType<typeof setInterval> | null = null;
const refreshEasyTierStatus = async (): Promise<void> => {
  try {
    easyTierStatus.value = await window.api.listenTogether.getEasyTierStatus();
  } catch {
    // ignore
  }
};

/**
 * 主机模式下展示给房客的会话地址（IP:Port）
 *
 * 判断条件与 HostDialog.vue 的 sessionAddress 略有差异（设计意图不同）：
 * - HostDialog 用 `easyTierEnabled && virtualIp`：反映"用户意图启用 + 实际已分配"
 * - ListenTogetherPanel 用 `virtualIp && networkSecret`：更严格,要求"虚拟 IP + 分享码均就绪"
 *   （分享码存在才意味着跨网房客能加入,否则即便虚拟 IP 已分配也无意义）
 *
 * 两者在主机模式下行为收敛：stopEasyTier 会同时清空 virtualIp 和 networkSecret,
 * 所以停止后都 fallback 到 hostAddress(LAN IP)。
 *
 * 端口提取：hostAddress 已是 "IP:Port" 格式（由 useListenTogether 的 computed 拼接）。
 * parts.length >= 2 防御异常格式（无冒号时返回整个字符串作为端口的损坏输出）。
 * IPv6 场景：端口总是 URI 末尾片段,.pop() 对 "[::1]:58000" 也安全。
 */
const sessionAddress = computed<string>(() => {
  if (!hostAddress.value) return "";
  const virtualIp = easyTierStatus.value.virtualIp;
  const code = easyTierStatus.value.networkSecret;
  if (virtualIp && code) {
    const parts = hostAddress.value.split(":");
    const port = parts.length >= 2 ? parts[parts.length - 1] : "";
    return port ? `${virtualIp}:${port}` : hostAddress.value;
  }
  return hostAddress.value;
});

/** 当前角色 */
const role = computed(() => status.value.role);
/** 是否处于空闲态 */
const isIdle = computed(() => role.value === "idle");

/** 当前曲目展示（主机/客户端共用，主机同步本地播放器，客户端同步主机下发） */
const currentTrack = computed(() => status.value.currentTrack);
/** 是否处于活动会话（用于显示当前曲目卡片） */
const hasActiveSession = computed(
  () => role.value !== "idle" && currentTrack.value !== null,
);

/** 客户端模式：根据主机下发的权限生成禁用提示列表 */
const permissionNotices = computed<string[]>(() => {
  const perms = status.value.clientPermissions;
  if (!perms) return [];
  const notices: string[] = [];
  if (!perms.allowClientPause) notices.push(t("listenTogether.join.pauseDisabled"));
  if (!perms.allowClientSkip) notices.push(t("listenTogether.join.skipDisabled"));
  if (!perms.allowClientEditQueue) notices.push(t("listenTogether.join.editQueueDisabled"));
  return notices;
});

/** 当前角色对应的标题文案 */
const roleTitle = computed(() => {
  switch (role.value) {
    case "host":
      return t("listenTogether.role.host");
    case "client":
      return t("listenTogether.role.client");
    default:
      return t("listenTogether.role.idle");
  }
});

/** 复制完整邀请文本（地址 + 分享码）
 *
 * 地址用 sessionAddress（虚拟 IP 优先，fallback 到 LAN IP），与显示一致。
 * 分享码从 easyTierStatus.networkSecret 取（轮询已保持最新，无需再次 IPC 调用）。
 */
const copyHostAddress = async (): Promise<void> => {
  if (!sessionAddress.value) return;
  const address = sessionAddress.value;
  const code = easyTierStatus.value.networkSecret;
  const text = code
    ? t("listenTogether.host.inviteText", { address, code })
    : address;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("listenTogether.host.shareCodeCopied"));
  } catch (err) {
    console.warn("clipboard.writeText failed:", err);
    toast.error(t("listenTogether.host.copyFailed"));
  }
};

/** 停止主机 */
const handleStopHost = async (): Promise<void> => {
  stopping.value = true;
  try {
    await stopHost();
    toast.success(t("listenTogether.host.stopped"));
  } finally {
    stopping.value = false;
  }
};

/** 离开会话 */
const handleLeave = async (): Promise<void> => {
  leaving.value = true;
  try {
    await leaveSession();
    toast.success(t("listenTogether.join.left"));
  } finally {
    leaving.value = false;
  }
};

/**
 * EasyTier 状态轮询管理
 *
 * 仅主机模式下轮询（用于刷新虚拟 IP + 分享码，供 sessionAddress computed 与
 * copyHostAddress 使用）。客户端模式不需要轮询（客户端的 EasyTier 状态由
 * joinSession 内部管理，UI 不展示）。
 */
const startEasyTierStatusPolling = (): void => {
  stopEasyTierStatusPolling();
  void refreshEasyTierStatus();
  easyTierStatusTimer = setInterval(refreshEasyTierStatus, 1000);
};
const stopEasyTierStatusPolling = (): void => {
  if (easyTierStatusTimer) {
    clearInterval(easyTierStatusTimer);
    easyTierStatusTimer = null;
  }
};

// 监听角色变化：进入主机模式时启动轮询，离开时停止
watch(
  role,
  (v) => {
    if (v === "host") {
      startEasyTierStatusPolling();
    } else {
      stopEasyTierStatusPolling();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopEasyTierStatusPolling();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶部标题区 -->
    <div class="px-8 pt-8 pb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div
          class="size-12 rounded-2xl bg-primary/12 text-primary flex items-center justify-center"
        >
          <IconLucideUsers class="size-6" />
        </div>
        <div>
          <h1 class="text-2xl font-semibold leading-tight">
            {{ t("listenTogether.title") }}
          </h1>
          <div class="text-sm text-on-surface-variant/70 mt-0.5">
            {{ t("listenTogether.subtitle") }}
          </div>
        </div>
      </div>
      <STag :type="role === 'idle' ? 'default' : 'primary'" size="medium" round>
        {{ roleTitle }}
      </STag>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 overflow-y-auto px-8 pb-8">
      <!-- 空闲态：选择角色 -->
      <div v-if="isIdle" class="grid grid-cols-2 gap-6 max-w-4xl mx-auto mt-6">
        <!-- 主机卡片 -->
        <div
          class="flex flex-col p-6 rounded-2xl border border-solid border-outline-variant/20 bg-surface-panel/50 hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer"
          @click="hostDialogOpen = true"
        >
          <div
            class="size-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-4"
          >
            <IconLucideRadio class="size-6" />
          </div>
          <h2 class="text-lg font-medium mb-2">
            {{ t("listenTogether.host.cardTitle") }}
          </h2>
          <p class="text-sm text-on-surface-variant/70 leading-relaxed flex-1">
            {{ t("listenTogether.host.cardDesc") }}
          </p>
          <SButton type="primary" class="mt-4 self-start">
            {{ t("listenTogether.host.cardAction") }}
          </SButton>
        </div>

        <!-- 客户端卡片 -->
        <div
          class="flex flex-col p-6 rounded-2xl border border-solid border-outline-variant/20 bg-surface-panel/50 hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer"
          @click="joinDialogOpen = true"
        >
          <div
            class="size-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-4"
          >
            <IconLucideLogIn class="size-6" />
          </div>
          <h2 class="text-lg font-medium mb-2">
            {{ t("listenTogether.join.cardTitle") }}
          </h2>
          <p class="text-sm text-on-surface-variant/70 leading-relaxed flex-1">
            {{ t("listenTogether.join.cardDesc") }}
          </p>
          <SButton type="primary" class="mt-4 self-start">
            {{ t("listenTogether.join.cardAction") }}
          </SButton>
        </div>
      </div>

      <!-- 主机模式：成员列表 -->
      <div v-else-if="role === 'host'" class="max-w-4xl mx-auto mt-4 flex flex-col gap-4">
        <!-- 当前曲目卡片（主机同步本地播放器状态） -->
        <div
          v-if="hasActiveSession"
          class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
        >
          <div class="text-sm text-on-surface-variant/70 mb-1">
            {{ t("listenTogether.host.currentTrackLabel") }}
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-base font-medium truncate">
                {{ currentTrack?.title || "—" }}
              </div>
              <div class="text-xs text-on-surface-variant/60 truncate mt-0.5">
                {{ currentTrack?.artist || "—" }}
              </div>
            </div>
            <div class="text-xs text-on-surface-variant/60 shrink-0">
              {{ status.currentState === "playing" ? "▶" : status.currentState === "paused" ? "⏸" : "" }}
              {{ Math.round((status.currentPosition ?? 0) / 1000) }}s
            </div>
          </div>
        </div>

        <!-- 地址条 -->
        <div
          class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
        >
          <div class="min-w-0 flex-1">
            <div class="text-sm text-on-surface-variant/70">
              {{ t("listenTogether.host.addressLabel") }}
            </div>
            <div class="text-base font-medium mt-1 flex items-center gap-2">
              <span class="inline-block size-2 rounded-full bg-green-500 shrink-0" />
              <span class="truncate">{{ sessionAddress || "—" }}</span>
            </div>
            <div class="text-xs text-on-surface-variant/60 mt-1">
              {{ t("listenTogether.host.addressHint") }}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <SButton
              variant="tertiary"
              size="small"
              :disabled="!sessionAddress"
              @click="copyHostAddress"
            >
              {{ t("listenTogether.host.copy") }}
            </SButton>
            <SButton variant="secondary" size="small" :loading="stopping" @click="handleStopHost">
              {{ t("listenTogether.host.stop") }}
            </SButton>
          </div>
        </div>

        <!-- 成员列表 -->
        <div
          class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
        >
          <div class="flex items-center justify-between mb-3">
            <div class="text-base font-medium">
              {{ t("listenTogether.host.membersTitle") }}
            </div>
            <STag type="default" size="small" round>
              {{ t("listenTogether.host.membersCount", { count: status.members.length }) }}
            </STag>
          </div>
          <div
            v-if="status.members.length === 0"
            class="text-sm text-on-surface-variant/50 py-6 text-center"
          >
            {{ t("listenTogether.host.membersEmpty") }}
          </div>
          <div v-else class="flex flex-col gap-1.5">
            <div
              v-for="member in status.members"
              :key="member.id"
              class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-variant/30 transition-colors"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <div
                  class="size-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-medium shrink-0"
                >
                  {{ member.name.slice(0, 1).toUpperCase() }}
                </div>
                <div class="min-w-0">
                  <div class="text-sm truncate">{{ member.name }}</div>
                  <div class="text-xs text-on-surface-variant/60 truncate">
                    {{
                      member.level === "vip"
                        ? t("listenTogether.level.vip")
                        : t("listenTogether.level.default")
                    }}
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-1.5 text-xs text-on-surface-variant/60 shrink-0">
                <IconLucideSignal class="size-3.5" />
                <span class="tabular-nums">{{ member.latency }}ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 客户端模式：连接信息 -->
      <div v-else class="max-w-4xl mx-auto mt-4 flex flex-col gap-4">
        <!-- 当前曲目卡片（客户端同步主机下发） -->
        <div
          v-if="hasActiveSession"
          class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
        >
          <div class="text-sm text-on-surface-variant/70 mb-1">
            {{ t("listenTogether.join.currentTrackLabel") }}
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-base font-medium truncate">
                {{ currentTrack?.title || "—" }}
              </div>
              <div class="text-xs text-on-surface-variant/60 truncate mt-0.5">
                {{ currentTrack?.artist || "—" }}
              </div>
            </div>
            <div class="text-xs text-on-surface-variant/60 shrink-0">
              {{ status.currentState === "playing" ? "▶" : "⏸" }}
              {{ Math.round((status.currentPosition ?? 0) / 1000) }}s
            </div>
          </div>
        </div>

        <!-- 连接信息条 -->
        <div
          class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
        >
          <div class="min-w-0 flex-1">
            <div class="text-sm text-on-surface-variant/70">
              {{ t("listenTogether.join.connectedTo") }}
            </div>
            <div class="text-base font-medium mt-1 flex items-center gap-2">
              <span class="inline-block size-2 rounded-full bg-green-500 shrink-0" />
              <span class="truncate">{{ status.hostName ?? clientUrl ?? "—" }}</span>
            </div>
            <div class="text-xs text-on-surface-variant/60 mt-1">
              {{ t("listenTogether.join.hostUrl") }}: {{ clientUrl ?? "—" }}
            </div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="flex flex-col items-end">
              <div class="text-xs text-on-surface-variant/60">
                {{ t("listenTogether.join.latency") }}
              </div>
              <div class="text-sm font-medium tabular-nums">{{ status.latency }}ms</div>
            </div>
            <SButton variant="secondary" size="small" :loading="leaving" @click="handleLeave">
              {{ t("listenTogether.join.leave") }}
            </SButton>
          </div>
        </div>

        <!-- 房客权限提示 -->
        <div
          v-if="status.clientPermissions && permissionNotices.length > 0"
          class="rounded-xl bg-amber-500/8 border border-solid border-amber-500/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-300 flex items-start gap-2"
        >
          <IconLucideAlertCircle class="size-4 shrink-0 mt-0.5" />
          <div class="flex flex-col gap-1">
            <div
              v-for="(notice, idx) in permissionNotices"
              :key="idx"
              class="text-xs leading-relaxed"
            >
              {{ notice }}
            </div>
          </div>
        </div>

        <!-- 成员列表 -->
        <div
          class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
        >
          <div class="flex items-center justify-between mb-3">
            <div class="text-base font-medium">
              {{ t("listenTogether.join.membersTitle") }}
            </div>
            <STag type="default" size="small" round>
              {{ t("listenTogether.host.membersCount", { count: status.clientMembers.length }) }}
            </STag>
          </div>
          <div
            v-if="status.clientMembers.length === 0"
            class="text-sm text-on-surface-variant/50 py-6 text-center"
          >
            {{ t("listenTogether.join.membersLoading") }}
          </div>
          <div v-else class="flex flex-col gap-1.5">
            <div
              v-for="member in status.clientMembers"
              :key="member.id"
              class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-variant/30 transition-colors"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <div
                  class="size-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-medium shrink-0"
                >
                  {{ member.name.slice(0, 1).toUpperCase() }}
                </div>
                <div class="min-w-0">
                  <div class="text-sm truncate">{{ member.name }}</div>
                  <div class="text-xs text-on-surface-variant/60 truncate">
                    {{
                      member.level === "vip"
                        ? t("listenTogether.level.vip")
                        : t("listenTogether.level.default")
                    }}
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-1.5 text-xs text-on-surface-variant/60 shrink-0">
                <IconLucideSignal class="size-3.5" />
                <span class="tabular-nums">{{ member.latency }}ms</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 错误提示 -->
        <div
          v-if="status.lastError"
          class="rounded-xl bg-error/8 border border-solid border-error/20 px-4 py-3 text-sm text-error flex items-center gap-2"
        >
          <IconLucideAlertCircle class="size-4 shrink-0" />
          <span>{{ status.lastError }}</span>
        </div>
      </div>
    </div>

    <!-- 弹窗 -->
    <HostDialog v-model:open="hostDialogOpen" />
    <JoinDialog v-model:open="joinDialogOpen" />
  </div>
</template>
