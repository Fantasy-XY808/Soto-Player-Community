/**
 * 渲染端扩展点 reactive 钩子
 *
 * - 订阅 Registry 本地 version 变化（同进程注册/注销立即触发 refresh）
 * - 通过 preload 的 extensions.subscribe 订阅主进程广播（跨进程变更）
 * - onScopeDispose 自动清理订阅
 */
import { shallowRef, onScopeDispose, type ShallowRef } from "vue";
import type { ExtensionRegistry } from "@shared/extensions/registry";

const globalVersion = { value: 0 };

let globalSubscribed = false;
const listeners = new Set<() => void>();

const ensureGlobalSubscription = (): void => {
  if (globalSubscribed) return;
  globalSubscribed = true;
  // window.api 由 preload 注入；在非渲染端环境（如 tsx 测试）下为 undefined，跳过订阅
  const api = (globalThis as unknown as { window?: { api?: { extensions?: { subscribe: (cb: () => void) => () => void } } } }).window?.api;
  if (api?.extensions?.subscribe) {
    api.extensions.subscribe(() => {
      globalVersion.value++;
      for (const fn of listeners) {
        try {
          fn();
        } catch {
          /* 单个监听器异常不影响其他 */
        }
      }
    });
  }
};

export function useExtensionRegistry<T>(
  registry: ExtensionRegistry<T>,
): ShallowRef<T[]> {
  const data = shallowRef<T[]>(registry.resolve());

  const refresh = (): void => {
    data.value = registry.resolve();
  };

  const localSub = registry.subscribe(refresh);

  ensureGlobalSubscription();
  listeners.add(refresh);

  onScopeDispose(() => {
    localSub.dispose();
    listeners.delete(refresh);
  });

  return data;
}

export const useExtensionsVersion = (): { value: number } => globalVersion;
