/**
 * 播放界面控件可见性增强
 *
 * 三种方案：
 * 1. background — 控件背景（blur/acrylic/mica）
 * 2. outline — 描边（thin/shadow/glow）
 * 3. auto — 智能推演：根据封面色亮度动态调整文字对比度
 *
 * 通过 CSS class 挂在 FullPlayer 根容器上，由 CSS 变量驱动具体效果。
 * 所有 .s-button[type=cover] 和 .text-cover 元素自动继承增强效果。
 */

import { computed } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";

/** 增强模式是否生效 */
export const useControlEnhance = () => {
  const settings = useSettingsStore();
  const theme = useThemeStore();

  /** 增强模式 class */
  const enhanceClass = computed(() => {
    const mode = settings.player.controlEnhanceMode;
    if (mode === "none") return "";
    if (mode === "background") {
      return `enhance-bg enhance-bg-${settings.player.controlBackgroundStyle}`;
    }
    if (mode === "outline") {
      return `enhance-outline enhance-outline-${settings.player.controlOutlineStyle}`;
    }
    if (mode === "auto") {
      return "enhance-auto";
    }
    return "";
  });

  /**
   * auto 模式：根据封面色亮度 + 主题明暗推算 CSS 变量
   *
   * --s-cover 文字色由 computeCoverForegroundColor(coverColor, isDark) 决定：
   *   深色主题 → tone 90（亮色文字）
   *   浅色主题 → tone 20（深色文字）
   *
   * 问题场景：
   *   深色主题 + 浅色封面 → 亮文字在浅背景上看不清 → 切换为深色文字
   *   浅色主题 + 深色封面 → 深文字在深背景上看不清 → 切换为亮色文字
   *
   * 通过对比背景亮度与当前文字亮度，对比度不足时切换。
   */
  const autoStyleVars = computed(() => {
    if (settings.player.controlEnhanceMode !== "auto") return {};
    const coverHex = theme.coverColor;
    // 无封面色时不干预
    if (!coverHex) return { "--ce-auto-active": "0" };
    const r = parseInt(coverHex.slice(1, 3), 16);
    const g = parseInt(coverHex.slice(3, 5), 16);
    const b = parseInt(coverHex.slice(5, 7), 16);
    // 感知亮度（ITU-R BT.601）
    const bgLuminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const isDark = theme.isDark;
    // 当前 --s-cover 文字色：深色主题→亮色(tone 90)，浅色主题→深色(tone 20)
    const textIsLight = isDark; // 深色主题文字亮，浅色主题文字暗
    // 对比度不足：背景亮 + 文字亮，或背景暗 + 文字暗
    const bgIsLight = bgLuminance > 0.5;
    if (bgIsLight && textIsLight) {
      // 浅色背景 + 亮色文字 → 切换为深色文字
      return {
        "--ce-auto-active": "1",
        "--ce-auto-text": "rgb(20, 20, 28)",
        "--ce-auto-shadow": "0 1px 3px rgba(0,0,0,0.4)",
      };
    }
    if (!bgIsLight && !textIsLight) {
      // 深色背景 + 深色文字 → 切换为亮色文字
      return {
        "--ce-auto-active": "1",
        "--ce-auto-text": "rgb(244, 244, 245)",
        "--ce-auto-shadow": "0 1px 3px rgba(0,0,0,0.3)",
      };
    }
    // 对比度足够，不干预
    return { "--ce-auto-active": "0" };
  });

  return { enhanceClass, autoStyleVars };
};
