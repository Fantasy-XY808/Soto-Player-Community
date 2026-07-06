<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";
import { useListenTogether } from "@/composables/useListenTogether";

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const settings = useSettingsStore();
const userStore = useUserStore();

const { refreshLocalUser, startHost, status: ltStatus } = useListenTogether();

/** 主机显示名（默认取网易云昵称） */
const hostName = ref("");
/** 会话口令 */
const password = ref("");
/** 房客权限：暂停/播放 */
const allowClientPause = ref(true);
/** 房客权限：切歌 */
const allowClientSkip = ref(true);
/** 房客权限：编辑播放列表 */
const allowClientEditQueue = ref(true);
/** 监听端口（绑定 settings.system.listenTogether.port） */
const port = computed<number>({
  get: () => settings.system.listenTogether.port,
  set: (v) => settings.setSystem("listenTogether.port", v),
});
/** 仅限同局域网（开启时不启动 EasyTier；UI 与 easyTierEnabled 反向） */
const lanOnly = computed<boolean>({
  get: () => !settings.system.listenTogether.easyTierEnabled,
  set: (v) => settings.setSystem("listenTogether.easyTierEnabled", !v),
});

/** EasyTier 状态（主机启动后由主进程填充分享码 / 虚拟 IP） */
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

/** 轮询 EasyTier 状态 */
let easyTierStatusTimer: ReturnType<typeof setInterval> | null = null;
const refreshEasyTierStatus = async (): Promise<void> => {
  try {
    easyTierStatus.value = await window.api.listenTogether.getEasyTierStatus();
  } catch {
    // ignore
  }
};
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

/** 本地账号状态 */
const localUser = ref<{ name: string; level: "default" | "vip" } | null>(null);
const checking = ref(false);
const starting = ref(false);

/** 当前网易云昵称 */
const defaultName = computed(() => userStore.profile?.nickname ?? "");

/** 自动用昵称填充主机名 */
watch(
  defaultName,
  (v) => {
    if (!hostName.value && v) hostName.value = v;
  },
  { immediate: true },
);

/** 自检：查询本地网易云登录态 */
const checkLogin = async (): Promise<void> => {
  checking.value = true;
  try {
    localUser.value = await refreshLocalUser();
  } finally {
    checking.value = false;
  }
};

/**
 * 当前会话地址（IP:Port）
 *
 * 基于官方文档 no-root.html 途径 B：
 * - EasyTier 启用且虚拟 IP 已分配：用虚拟 IP（10.144.144.1），跨网房客经
 *   EasyTier SOCKS5 代理连接此地址。
 * - 否则：用 LAN IP，仅同局域网房客可连（EasyTier 启动中/失败时的 fallback）。
 */
const sessionAddress = computed<string>(() => {
  const easyTierEnabled = settings.system.listenTogether.easyTierEnabled;
  const virtualIp = easyTierStatus.value.virtualIp;
  const hostAddress = ltStatus.value.hostAddress;
  const portValue = port.value;
  // EasyTier 启用且虚拟 IP 已分配：用虚拟 IP（跨网房客）
  if (easyTierEnabled && virtualIp) {
    return `${virtualIp}:${portValue}`;
  }
  // 否则：用 LAN IP（同局域网房客，或 EasyTier 启动中/失败的 fallback）
  if (hostAddress) {
    return `${hostAddress}:${portValue}`;
  }
  return "";
});

/** 复制完整邀请文本到剪贴板 */
const copyShareCode = async (): Promise<void> => {
  const code = easyTierStatus.value.networkSecret;
  const address = sessionAddress.value;
  if (!code || !address) return;
  const text = t("listenTogether.host.inviteText", { address, code });
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("listenTogether.host.shareCodeCopied"));
  } catch {
    toast.error(t("listenTogether.host.copyFailed"));
  }
};

/** 启动主机 */
const handleStart = async (): Promise<void> => {
  if (!hostName.value.trim()) {
    toast.warning(t("listenTogether.host.nameRequired"));
    return;
  }
  if (!localUser.value) {
    toast.warning(t("listenTogether.host.needLogin"));
    return;
  }
  starting.value = true;
  try {
    const result = await startHost(hostName.value.trim(), password.value, {
      allowClientPause: allowClientPause.value,
      allowClientSkip: allowClientSkip.value,
      allowClientEditQueue: allowClientEditQueue.value,
    });
    if (result.ok) {
      toast.success(t("listenTogether.host.started", { address: result.address ?? "" }));
      // 立即刷新 EasyTier 状态拿到分享码，保持 dialog 打开让用户复制邀请文本
      await refreshEasyTierStatus();
    } else {
      toast.error(result.error ?? t("listenTogether.host.startFailed"));
    }
  } catch (err) {
    // IPC 框架异常（main 崩溃 / 序列化失败等）时显示兜底错误
    // 此前 try/finally 无 catch，reject 向上抛未捕获，用户看不到任何 toast
    console.error("startHost IPC reject:", err);
    toast.error(t("listenTogether.host.startFailed"));
  } finally {
    starting.value = false;
  }
};

/** 主机已运行（用于切换 footer 按钮文案与状态展示） */
const isHostRunning = computed(() => ltStatus.value.role === "host");

watch(
  () => props.open,
  (v) => {
    if (v) {
      void checkLogin();
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
  <SDialog
    :open="open"
    :title="t('listenTogether.host.title')"
    width="520px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4 py-2">
      <!-- 登录态提示 -->
      <div
        class="rounded-lg px-3 py-2.5 text-sm flex items-center gap-2"
        :class="localUser ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'"
      >
        <span
          class="inline-block size-2 rounded-full"
          :class="localUser ? 'bg-green-500' : 'bg-amber-500'"
        />
        <span v-if="checking">{{ t("listenTogether.host.checking") }}</span>
        <span v-else-if="localUser">
          {{
            t("listenTogether.host.loggedInAs", {
              name: localUser.name,
              level:
                localUser.level === "vip"
                  ? t("listenTogether.level.vip")
                  : t("listenTogether.level.default"),
            })
          }}
        </span>
        <span v-else>{{ t("listenTogether.host.needLogin") }}</span>
      </div>

      <!-- 主机名 -->
      <SFormItem :label="t('listenTogether.host.nameLabel')">
        <SInput v-model="hostName" :placeholder="t('listenTogether.host.namePlaceholder')" />
      </SFormItem>

      <!-- 口令 -->
      <SFormItem
        :label="t('listenTogether.host.passwordLabel')"
        :description="t('listenTogether.host.passwordHint')"
      >
        <SInput
          v-model="password"
          type="text"
          :placeholder="t('listenTogether.host.passwordPlaceholder')"
        />
      </SFormItem>

      <!-- 房客权限 -->
      <SFormItem :label="t('listenTogether.host.permissionsLabel')">
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="text-sm">{{ t("listenTogether.host.allowClientPause") }}</span>
            <SSwitch v-model:model-value="allowClientPause" />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm">{{ t("listenTogether.host.allowClientSkip") }}</span>
            <SSwitch v-model:model-value="allowClientSkip" />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm">{{ t("listenTogether.host.allowClientEditQueue") }}</span>
            <SSwitch v-model:model-value="allowClientEditQueue" />
          </div>
        </div>
      </SFormItem>

      <!-- 端口 -->
      <SFormItem
        :label="t('listenTogether.host.portLabel')"
        :description="t('listenTogether.host.portHint')"
      >
        <SNumberInput v-model="port" :min="1024" :max="65535" />
      </SFormItem>

      <!-- EasyTier P2P 内网穿透（已内嵌，默认开启） -->
      <div class="rounded-lg bg-surface-panel px-3 py-3 flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <div class="flex flex-col gap-0.5 pr-3">
            <span class="text-sm font-medium text-on-surface">
              {{ t("listenTogether.host.easyTierTitle") }}
            </span>
            <span class="text-xs text-on-surface-variant/70">
              {{ t("listenTogether.host.easyTierHint") }}
            </span>
          </div>
          <!-- 仅限同局域网开关：与 easyTierEnabled 反向 -->
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-xs text-on-surface-variant/80">
              {{ t("listenTogether.host.lanOnlyLabel") }}
            </span>
            <SSwitch v-model:model-value="lanOnly" />
          </div>
        </div>
        <!-- 分享码 / 状态行：lanOnly 开启时隐藏（无虚拟网络，无需分享码） -->
        <template v-if="!lanOnly">
          <!-- 分享码 -->
          <div class="flex items-center gap-2">
            <div class="flex-1 flex items-center gap-2 px-3 py-2 rounded-md bg-surface-variant/30">
              <span class="text-xs text-on-surface-variant/70 shrink-0">
                {{ t("listenTogether.host.shareCodeLabel") }}
              </span>
              <span
                class="font-mono text-base font-semibold tracking-[0.2em] text-on-surface truncate"
                :class="easyTierStatus.networkSecret ? '' : 'text-on-surface-variant/40'"
              >
                {{ easyTierStatus.networkSecret || "------" }}
              </span>
            </div>
            <SButton
              variant="secondary"
              size="small"
              :disabled="!easyTierStatus.networkSecret || !sessionAddress"
              @click="copyShareCode"
            >
              {{ t("listenTogether.host.copy") }}
            </SButton>
          </div>
          <!-- 状态行 -->
          <div class="text-xs text-on-surface-variant/80 leading-relaxed">
            <span v-if="easyTierStatus.error" class="text-red-500/85">
              {{ easyTierStatus.error }}
            </span>
            <span v-else-if="easyTierStatus.virtualIp" class="text-green-600">
              {{ t("listenTogether.host.easyTierVirtualIp", { ip: easyTierStatus.virtualIp }) }}
            </span>
            <span v-else-if="easyTierStatus.running">
              {{ t("listenTogether.host.easyTierWaitingIp") }}
            </span>
            <span v-else>{{ t("listenTogether.host.easyTierNotStarted") }}</span>
          </div>
        </template>
        <!-- lanOnly 开启时显示提示 -->
        <div v-else class="text-xs text-on-surface-variant/80 leading-relaxed">
          {{ t("listenTogether.host.lanOnlyHint") }}
        </div>
      </div>

      <!-- 穿透提示 -->
      <div
        class="rounded-lg bg-surface-panel px-3 py-2.5 text-xs text-on-surface-variant/80 leading-relaxed"
      >
        {{ t("listenTogether.host.tunnelHint") }}
      </div>
    </div>
    <template #footer="{ close }">
      <template v-if="isHostRunning">
        <SButton
          variant="tertiary"
          :disabled="!easyTierStatus.networkSecret || !sessionAddress"
          @click="copyShareCode"
        >
          {{ t("listenTogether.host.copy") }}
        </SButton>
        <SButton type="primary" @click="close">{{ t("common.confirm") }}</SButton>
      </template>
      <template v-else>
        <SButton variant="tertiary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton type="primary" :loading="starting" :disabled="!localUser" @click="handleStart">
          {{ t("listenTogether.host.start") }}
        </SButton>
      </template>
    </template>
  </SDialog>
</template>
