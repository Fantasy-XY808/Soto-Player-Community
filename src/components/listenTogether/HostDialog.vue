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

const { refreshLocalUser, startHost } = useListenTogether();

/** 主机显示名（默认取网易云昵称） */
const hostName = ref("");
/** 会话口令 */
const password = ref("");
/** 监听端口（绑定 settings.system.listenTogether.port） */
const port = computed<number>({
  get: () => settings.system.listenTogether.port,
  set: (v) => settings.setSystem("listenTogether.port", v),
});

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
    const result = await startHost(hostName.value.trim(), password.value);
    if (result.ok) {
      toast.success(t("listenTogether.host.started", { address: result.address ?? "" }));
      emit("update:open", false);
    } else {
      toast.error(result.error ?? t("listenTogether.host.startFailed"));
    }
  } finally {
    starting.value = false;
  }
};

watch(
  () => props.open,
  (v) => {
    if (v) void checkLogin();
  },
  { immediate: true },
);
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

      <!-- 端口 -->
      <SFormItem
        :label="t('listenTogether.host.portLabel')"
        :description="t('listenTogether.host.portHint')"
      >
        <SNumberInput v-model="port" :min="1024" :max="65535" />
      </SFormItem>

      <!-- 穿透提示 -->
      <div
        class="rounded-lg bg-surface-panel px-3 py-2.5 text-xs text-on-surface-variant/80 leading-relaxed"
      >
        {{ t("listenTogether.host.tunnelHint") }}
      </div>
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" :loading="starting" :disabled="!localUser" @click="handleStart">
        {{ t("listenTogether.host.start") }}
      </SButton>
    </template>
  </SDialog>
</template>
