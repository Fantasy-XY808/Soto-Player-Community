import type { Directive } from "vue";

/**
 * v-ripple 涟漪指令
 *
 * 用法：
 *   v-ripple          — 启用涟漪
 *   v-ripple="false"  — 禁用
 */

const RIPPLE_HANDLER = Symbol("rippleHandler");

interface RippleElement extends HTMLElement {
  [RIPPLE_HANDLER]?: (e: PointerEvent) => void;
}

const setupRipple = (el: RippleElement) => {
  if (el[RIPPLE_HANDLER]) return;

  const position = getComputedStyle(el).position;
  if (!position || position === "static") {
    el.style.position = "relative";
  }
  el.style.overflow = "hidden";

  const handler = (e: PointerEvent) => {
    const rect = el.getBoundingClientRect();
    const radius = Math.sqrt(rect.width ** 2 + rect.height ** 2);
    const size = radius * 2;
    const x = e.clientX - rect.left - radius;
    const y = e.clientY - rect.top - radius;

    const ripple = document.createElement("span");
    Object.assign(ripple.style, {
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      backgroundColor: "currentColor",
      opacity: "0.2",
      transform: "scale(0)",
      pointerEvents: "none",
      transition: "transform 0.8s cubic-bezier(0.2, 0, 0, 1), opacity 0.6s ease",
    });

    el.appendChild(ripple);

    requestAnimationFrame(() => {
      ripple.style.transform = "scale(1)";
    });

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      ripple.style.opacity = "0";
      ripple.addEventListener("transitionend", () => ripple.remove(), { once: true });
      setTimeout(() => ripple.remove(), 1000);
    };
    el.addEventListener("pointerup", remove, { once: true });
    el.addEventListener("pointerleave", remove, { once: true });
  };

  el.addEventListener("pointerdown", handler);
  el[RIPPLE_HANDLER] = handler;
};

const teardownRipple = (el: RippleElement) => {
  if (!el[RIPPLE_HANDLER]) return;
  el.removeEventListener("pointerdown", el[RIPPLE_HANDLER]);
  delete el[RIPPLE_HANDLER];
};

export const vRipple: Directive<RippleElement, unknown> = {
  mounted(el, binding) {
    if (binding.value !== false) setupRipple(el);
  },
  updated(el, binding) {
    if (binding.value !== false) {
      setupRipple(el);
    } else {
      teardownRipple(el);
    }
  },
  unmounted(el) {
    teardownRipple(el);
  },
};
