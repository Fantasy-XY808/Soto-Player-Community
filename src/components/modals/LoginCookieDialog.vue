<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { useUserStore } from "@/stores/user";
import { useQqUserStore } from "@/stores/qqUser";
import { useKugouUserStore } from "@/stores/kugouUser";

type CookiePlatform = "netease" | "qqmusic" | "kugou";

const props = withDefaults(defineProps<{ open: boolean; platform?: CookiePlatform }>(), {
  platform: "netease",
});
const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 登录成功，附带平台标识 */
  success: [platform: CookiePlatform];
}>();

const { t } = useI18n();
const user = useUserStore();
const qqUser = useQqUserStore();
const kugouUser = useKugouUserStore();

const raw = ref("");
const loading = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      raw.value = "";
      loading.value = false;
    }
  },
);

/** 平台 → 校验关键字段的正则；任一不匹配即拒绝 */
const validator: Record<CookiePlatform, RegExp> = {
  netease: /MUSIC_U\s*=/i,
  qqmusic: /uin\s*=/i,
  kugou: /kg_mid\s*=/i,
};

/** 平台 → 是否同时要求第二个关键字段 */
const secondaryKey: Record<CookiePlatform, RegExp | null> = {
  netease: null,
  qqmusic: /qm_keyst\s*=/i,
  kugou: /vip_token\s*=/i,
};

/** 平台 → i18n 错误 key */
const errorKey: Record<CookiePlatform, string> = {
  netease: "login.cookieInvalid",
  qqmusic: "login.cookieInvalidQq",
  kugou: "login.cookieInvalidKugou",
};

/** 平台 → 输入提示 i18n key */
const hintKey: Record<CookiePlatform, string> = {
  netease: "login.cookieHint",
  qqmusic: "login.cookieHintQq",
  kugou: "login.cookieHintKugou",
};

/** 平台 → placeholder i18n key */
const placeholderKey: Record<CookiePlatform, string> = {
  netease: "login.cookiePlaceholder",
  qqmusic: "login.cookiePlaceholderQq",
  kugou: "login.cookiePlaceholderKugou",
};

/** 平台 → 标题 i18n key */
const titleKey: Record<CookiePlatform, string> = {
  netease: "login.manualCookie",
  qqmusic: "login.platformQQMusic",
  kugou: "login.platformKugou",
};

const validate = (value: string): boolean => {
  if (!validator[props.platform].test(value)) return false;
  const secondary = secondaryKey[props.platform];
  return !secondary || secondary.test(value);
};

const submit = async (): Promise<void> => {
  const value = raw.value.trim();
  if (!value || !validate(value)) {
    toast.error(t(errorKey[props.platform]));
    return;
  }
  loading.value = true;
  try {
    let ok = false;
    if (props.platform === "netease") {
      const res = await window.api.apis.setCookie("netease", value);
      if (!res.ok) {
        toast.error(t(errorKey.netease));
        return;
      }
      ok = await user.fetchStatus();
    } else if (props.platform === "qqmusic") {
      const res = await window.api.qqmusic.setCookie(value);
      if (!res.ok) {
        toast.error(t(errorKey.qqmusic));
        return;
      }
      ok = await qqUser.fetchStatus();
    } else {
      const res = await window.api.kugou.setCookie(value);
      if (!res.ok) {
        toast.error(t(errorKey.kugou));
        return;
      }
      ok = await kugouUser.fetchStatus();
    }
    if (!ok) {
      toast.error(t("login.failed"));
      return;
    }
    toast.success(t("login.success"));
    emit("success", props.platform);
    emit("update:open", false);
  } finally {
    loading.value = false;
  }
};

const onOpenUpdate = (value: boolean): void => emit("update:open", value);
</script>

<template>
  <SDialog :open="open" :title="t(titleKey[platform])" width="420px" @update:open="onOpenUpdate">
    <div class="flex flex-col gap-3">
      <SAlert>{{ t(hintKey[platform]) }}</SAlert>
      <SInput
        v-model="raw"
        type="textarea"
        :rows="4"
        clearable
        :placeholder="t(placeholderKey[platform])"
        :disabled="loading"
      />
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" :disabled="loading" @click="close">
        {{ t("common.cancel") }}
      </SButton>
      <SButton type="primary" :loading="loading" @click="submit">
        {{ t("login.cookieConfirm") }}
      </SButton>
    </template>
  </SDialog>
</template>
