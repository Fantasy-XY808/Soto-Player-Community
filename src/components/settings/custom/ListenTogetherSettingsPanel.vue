<script setup lang="ts">
import { useListenTogether } from "@/composables/useListenTogether";
import { toast } from "@/composables/useToast";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();

const { status, hostAddress, clientUrl, stopHost, leaveSession } = useListenTogether();

/** 当前角色对应的提示 */
const roleHint = computed(() => {
  switch (status.value.role) {
    case "host":
      return t("settings.listenTogether.runningAsHost", { address: hostAddress.value ?? "" });
    case "client":
      return t("settings.listenTogether.runningAsClient", { url: clientUrl.value ?? "" });
    default:
      return t("settings.listenTogether.idle");
  }
});

/** 一键退出当前会话 */
const handleExit = async (): Promise<void> => {
  if (status.value.role === "host") {
    await stopHost();
    toast.success(t("listenTogether.host.stopped"));
  } else if (status.value.role === "client") {
    await leaveSession();
    toast.success(t("listenTogether.join.left"));
  }
};
</script>

<template>
  <div
    class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5 flex items-center justify-between gap-4"
  >
    <div class="min-w-0 flex-1">
      <div class="text-base flex items-center gap-2">
        {{ t("settings.listenTogether.panelTitle") }}
      </div>
      <div class="text-sm mt-1 flex items-center gap-1.5">
        <span
          class="inline-block size-2 shrink-0 rounded-full"
          :class="status.role === 'idle' ? 'bg-on-surface-variant/40' : 'bg-green-500'"
        />
        <span class="text-on-surface-variant/80 truncate">{{ roleHint }}</span>
      </div>
      <div class="text-xs text-on-surface-variant/60 mt-0.5">
        {{ t("settings.listenTogether.panelHint") }}
      </div>
    </div>
    <div class="shrink-0 flex items-center gap-2">
      <SButton v-if="status.role !== 'idle'" variant="secondary" size="small" @click="handleExit">
        {{ t("settings.listenTogether.exit") }}
      </SButton>
    </div>
  </div>
</template>
