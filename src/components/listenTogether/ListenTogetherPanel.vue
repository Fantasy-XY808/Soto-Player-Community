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

/** 当前角色 */
const role = computed(() => status.value.role);
/** 是否处于空闲态 */
const isIdle = computed(() => role.value === "idle");

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

/** 复制主机地址 */
const copyHostAddress = async (): Promise<void> => {
  if (!hostAddress.value) return;
  try {
    await navigator.clipboard.writeText(hostAddress.value);
    toast.success(t("listenTogether.host.copied"));
  } catch {
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
              <span class="truncate">{{ hostAddress ?? "—" }}</span>
            </div>
            <div class="text-xs text-on-surface-variant/60 mt-1">
              {{ t("listenTogether.host.addressHint") }}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <SButton
              variant="tertiary"
              size="small"
              :disabled="!hostAddress"
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
