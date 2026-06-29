<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/composables/useToast";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideTrash2 from "~icons/lucide/trash-2";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();

const open = ref(false);
const tab = ref<"keywords" | "regexes">("keywords");
const keywords = ref<string[]>([]);
const regexes = ref<string[]>([]);
const newKeyword = ref("");
const newRegex = ref("");

watch(open, (val) => {
  if (val) {
    keywords.value = [...settings.lyric.excludeLyricsUserKeywords];
    regexes.value = [...settings.lyric.excludeLyricsUserRegexes];
    newKeyword.value = "";
    newRegex.value = "";
    tab.value = "keywords";
  }
});

const addKeyword = () => {
  const v = newKeyword.value.trim();
  if (!v) return;
  if (keywords.value.includes(v)) {
    toast.warning(t("settings.excludeLyricsRules.duplicate"));
    return;
  }
  keywords.value.push(v);
  newKeyword.value = "";
};

const addRegex = () => {
  const v = newRegex.value.trim();
  if (!v) return;
  try {
    new RegExp(v);
  } catch {
    toast.error(t("settings.excludeLyricsRules.invalidRegex"));
    return;
  }
  if (regexes.value.includes(v)) {
    toast.warning(t("settings.excludeLyricsRules.duplicate"));
    return;
  }
  regexes.value.push(v);
  newRegex.value = "";
};

const removeKeyword = (idx: number) => {
  keywords.value.splice(idx, 1);
};

const removeRegex = (idx: number) => {
  regexes.value.splice(idx, 1);
};

const clearActive = () => {
  if (tab.value === "keywords") keywords.value = [];
  else regexes.value = [];
};

const handleConfirm = () => {
  settings.lyric.excludeLyricsUserKeywords = [...keywords.value];
  settings.lyric.excludeLyricsUserRegexes = [...regexes.value];
  open.value = false;
};

const tabs = computed(() => [
  { key: "keywords", label: t("settings.excludeLyricsRules.tabKeywords") },
  { key: "regexes", label: t("settings.excludeLyricsRules.tabRegexes") },
]);
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="open = true">
    {{ t("settings.excludeLyricsRules.button") }}
  </SButton>
  <SDialog
    v-model:open="open"
    :title="t('settings.excludeLyricsRules.label')"
    :description="t('settings.excludeLyricsRules.hint')"
    width="540px"
  >
    <STabs v-model="tab" :tabs="tabs" type="segment" animated>
      <!-- 关键词 -->
      <template #keywords>
        <div class="flex flex-col gap-3 pt-3">
          <p class="text-sm text-on-surface-variant/70">
            {{ t("settings.excludeLyricsRules.keywordHint") }}
          </p>
          <div class="flex gap-2">
            <SInput
              v-model="newKeyword"
              :placeholder="t('settings.excludeLyricsRules.keywordPlaceholder')"
              class="flex-1"
              @keydown.enter="addKeyword"
            />
            <SButton type="primary" variant="secondary" :size="34" @click="addKeyword">
              <template #icon><IconLucidePlus /></template>
              {{ t("settings.excludeLyricsRules.add") }}
            </SButton>
          </div>
          <div class="flex flex-wrap gap-1.5 max-h-[40vh] pb-4 overflow-y-auto">
            <p v-if="keywords.length === 0" class="text-sm text-on-surface-variant/60">
              {{ t("settings.excludeLyricsRules.empty") }}
            </p>
            <STag
              v-for="(kw, idx) in keywords"
              :key="`${idx}-${kw}`"
              size="medium"
              closable
              @close="removeKeyword(idx)"
            >
              {{ kw }}
            </STag>
          </div>
        </div>
      </template>

      <!-- 正则 -->
      <template #regexes>
        <div class="flex flex-col gap-3 pt-3">
          <p class="text-sm text-on-surface-variant/70">
            {{ t("settings.excludeLyricsRules.regexHint") }}
          </p>
          <div class="flex gap-2">
            <SInput
              v-model="newRegex"
              :placeholder="t('settings.excludeLyricsRules.regexPlaceholder')"
              class="flex-1"
              @keydown.enter="addRegex"
            />
            <SButton type="primary" variant="secondary" :size="34" @click="addRegex">
              <template #icon><IconLucidePlus /></template>
              {{ t("settings.excludeLyricsRules.add") }}
            </SButton>
          </div>
          <div class="flex flex-wrap gap-1.5 max-h-[40vh] pb-4 overflow-y-auto">
            <p v-if="regexes.length === 0" class="text-sm text-on-surface-variant/60">
              {{ t("settings.excludeLyricsRules.empty") }}
            </p>
            <STag
              v-for="(re, idx) in regexes"
              :key="`${idx}-${re}`"
              size="medium"
              closable
              @close="removeRegex(idx)"
            >
              <code class="font-mono">{{ re }}</code>
            </STag>
          </div>
        </div>
      </template>
    </STabs>

    <template #footer="{ close }">
      <SButton variant="secondary" @click="clearActive">
        <template #icon><IconLucideTrash2 /></template>
        {{ t("settings.excludeLyricsRules.clear") }}
      </SButton>
      <div class="flex-1" />
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="handleConfirm">{{ t("common.save") }}</SButton>
    </template>
  </SDialog>
</template>
