<script setup lang="ts">
import type { ListenTogetherDiscoveredSession } from "@shared/types/settings";
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/composables/useToast";
import { useListenTogether } from "@/composables/useListenTogether";

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const settings = useSettingsStore();

const { refreshLocalUser, joinSession, startBrowse, stopBrowse, discoveredSessions } =
  useListenTogether();

/** 主机地址（手动输入或选中条目填充） */
const hostUrl = ref("");
/** 会话口令 */
const password = ref("");
/** 本地账号状态 */
const localUser = ref<{ name: string; level: "default" | "vip" } | null>(null);
const checking = ref(false);
const joining = ref(false);

/** 上次连接地址（用于快速重连） */
const lastHostUrl = computed<string>({
  get: () => settings.system.listenTogether.lastHostUrl,
  set: (v) => settings.setSystem("listenTogether.lastHostUrl", v),
});

/** 自动发现列表（按最近发现时间倒序） */
const sortedSessions = computed<ListenTogetherDiscoveredSession[]>(() =>
  [...discoveredSessions.value].sort((a, b) => b.lastSeen - a.lastSeen),
);

/** 自检 + 启动 mDNS 浏览 */
const init = async (): Promise<void> => {
  checking.value = true;
  try {
    localUser.value = await refreshLocalUser();
  } finally {
    checking.value = false;
  }
  // 自动填充上次地址
  if (lastHostUrl.value && !hostUrl.value) hostUrl.value = lastHostUrl.value;
  startBrowse();
};

/** 选中某个发现条目 */
const selectDiscovered = (session: ListenTogetherDiscoveredSession): void => {
  hostUrl.value = `${session.host}:${session.port}`;
};

/** 加入会话 */
const handleJoin = async (): Promise<void> => {
  if (!hostUrl.value.trim()) {
    toast.warning(t("listenTogether.join.urlRequired"));
    return;
  }
  if (!localUser.value) {
    toast.warning(t("listenTogether.join.needLogin"));
    return;
  }
  joining.value = true;
  try {
    // 补全协议前缀
    let url = hostUrl.value.trim();
    if (!/^wss?:\/\//.test(url)) {
      url = `ws://${url}`;
    }
    const result = await joinSession(url, password.value);
    if (result.ok) {
      lastHostUrl.value = hostUrl.value.trim();
      toast.success(t("listenTogether.join.joined"));
      emit("update:open", false);
    } else {
      toast.error(result.error ?? t("listenTogether.join.failed"));
    }
  } finally {
    joining.value = false;
  }
};

watch(
  () => props.open,
  (v) => {
    if (v) void init();
    else stopBrowse();
  },
  { immediate: true },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('listenTogether.join.title')"
    width="560px"
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
        <span v-if="checking">{{ t("listenTogether.join.checking") }}</span>
        <span v-else-if="localUser">
          {{ t("listenTogether.join.loggedInAs", { name: localUser.name }) }}
        </span>
        <span v-else>{{ t("listenTogether.join.needLogin") }}</span>
      </div>

      <!-- 自动发现列表 -->
      <SFormItem :label="t('listenTogether.join.discoveredLabel')">
        <div class="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
          <div
            v-if="sortedSessions.length === 0"
            class="text-xs text-on-surface-variant/50 px-2 py-3 text-center"
          >
            {{ t("listenTogether.join.discoveredEmpty") }}
          </div>
          <button
            v-for="session in sortedSessions"
            :key="`${session.host}:${session.port}`"
            type="button"
            class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-solid border-outline-variant/20 hover:border-primary hover:bg-primary/5 transition-colors text-left"
            :class="
              hostUrl === `${session.host}:${session.port}` ? 'border-primary bg-primary/10' : ''
            "
            @click="selectDiscovered(session)"
          >
            <div class="min-w-0">
              <div class="text-sm truncate">{{ session.name }}</div>
              <div class="text-xs text-on-surface-variant/60 truncate">
                {{ session.host }}:{{ session.port }}
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <STag v-if="session.txt.hasPassword" type="default" size="small">
                {{ t("listenTogether.join.locked") }}
              </STag>
              <STag :type="session.txt.level === 'vip' ? 'primary' : 'default'" size="small">
                {{
                  session.txt.level === "vip"
                    ? t("listenTogether.level.vip")
                    : t("listenTogether.level.default")
                }}
              </STag>
            </div>
          </button>
        </div>
      </SFormItem>

      <!-- 主机地址 -->
      <SFormItem
        :label="t('listenTogether.join.urlLabel')"
        :description="t('listenTogether.join.urlHint')"
      >
        <SInput v-model="hostUrl" :placeholder="t('listenTogether.join.urlPlaceholder')" />
      </SFormItem>

      <!-- 口令 -->
      <SFormItem :label="t('listenTogether.join.passwordLabel')">
        <SInput
          v-model="password"
          type="text"
          :placeholder="t('listenTogether.join.passwordPlaceholder')"
        />
      </SFormItem>
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" :loading="joining" :disabled="!localUser" @click="handleJoin">
        {{ t("listenTogether.join.join") }}
      </SButton>
    </template>
  </SDialog>
</template>
