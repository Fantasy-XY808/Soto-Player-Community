/**
 * 内置 TranslationProvider 扩展点注册
 *
 * 2 个翻译提供方：
 * - local-dict：本地词典翻译（占位实现，当前无翻译能力，返回 null）
 * - builtin-offline：离线翻译（占位实现，当前无翻译能力，返回 null）
 *
 * 阶段 4.5 仅注册扩展点骨架，不引入翻译服务依赖。
 * 后续接入真实翻译能力时，替换 translate 函数实现即可。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type { TranslationProviderDescriptor } from "../../../shared/types/plugin-extensions";
import { TranslationProviderRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

/** 内置翻译提供方元数据 */
interface BuiltinTranslationMeta {
  id: string;
  label: string;
  translate: (text: string, targetLangCode: string) => Promise<string | null>;
}

const BUILTIN_PROVIDERS: readonly BuiltinTranslationMeta[] = [
  {
    id: "local-dict",
    label: "本地词典",
    translate: async () => null,
  },
  {
    id: "builtin-offline",
    label: "离线翻译",
    translate: async () => null,
  },
];

/**
 * 注册内置翻译提供方
 *
 * 若某提供方已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerTranslationProviders = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_PROVIDERS) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (TranslationProviderRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: TranslationProviderDescriptor = {
      id: meta.id,
      label: meta.label,
      translate: meta.translate,
    };
    disposables.push(
      TranslationProviderRegistry.register({
        id: meta.id,
        pluginId: BUILTIN_PLUGIN_ID,
        priority: 0,
        implementation: descriptor,
      }),
    );
  }
  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
};
