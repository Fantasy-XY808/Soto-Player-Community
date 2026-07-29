<script setup lang="ts">
import IconLucideFlaskConical from "~icons/lucide/flask-conical";
import { useSettingModel } from "@/settings/useSettingModel";

/**
 * 专业/普通模式切换组件
 *
 * 双向绑定到 system.system.advancedMode（走 system.* IPC 通道持久化）。
 * SettingsSection / SettingsItem / SettingsSearch 读取同一字段统一过滤
 * 带 `advanced: true` 标记的 item / category。
 *
 * 视觉风格参考 SettingsItem 的 switch 渲染，但更紧凑以适配左侧栏 240px 可用宽度。
 */
const { t } = useI18n();
const model = useSettingModel({ store: "settings", path: "system.system.advancedMode" });
</script>

<template>
  <STooltip :content="t('settings.advancedMode.tooltip')" side="right">
    <div
      class="flex items-center justify-between gap-4 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel px-4 py-3.5 transition-all duration-300 hover:border-outline-variant/30 cursor-pointer select-none"
      @click="model = !model"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 text-xs font-medium text-on-surface">
          <IconLucideFlaskConical class="size-3.5 text-primary shrink-0" />
          <span>{{ t("settings.advancedMode.label") }}</span>
          <STag v-if="model" type="primary" size="tiny" round>Pro</STag>
        </div>
        <div class="text-xs text-on-surface-variant/70 mt-0.5 truncate">
          {{ t("settings.advancedMode.description") }}
        </div>
      </div>
      <!-- 阻止冒泡：SSwitch 自身的 toggle 与外层 click 二选一，避免双触发抵消 -->
      <div class="shrink-0" @click.stop>
        <SSwitch v-model="model" />
      </div>
    </div>
  </STooltip>
</template>
