/**
 * 内置 TransliterationProvider 扩展点注册
 *
 * 2 个音译提供方：
 * - local-romaji：本地罗马音（占位实现，当前无音译能力，返回 null）
 * - builtin-pinyin：内置拼音（占位实现，当前无音译能力，返回 null）
 *
 * 阶段 4.6 仅注册扩展点骨架，不引入音译服务依赖。
 * 后续接入真实音译能力时，替换 transliterate 函数实现即可。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type { TransliterationProviderDescriptor } from "../../../shared/types/plugin-extensions";
import { TransliterationProviderRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

/** 内置音译提供方元数据 */
interface BuiltinTransliterationMeta {
  id: string;
  label: string;
  transliterate: (text: string, targetLangCode: string) => Promise<string | null>;
}

const BUILTIN_PROVIDERS: readonly BuiltinTransliterationMeta[] = [
  {
    id: "local-romaji",
    label: "本地罗马音",
    transliterate: async () => null,
  },
  {
    id: "builtin-pinyin",
    label: "内置拼音",
    transliterate: async () => null,
  },
];

/**
 * 注册内置音译提供方
 *
 * 若某提供方已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerTransliterationProviders = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_PROVIDERS) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (TransliterationProviderRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: TransliterationProviderDescriptor = {
      id: meta.id,
      label: meta.label,
      transliterate: meta.transliterate,
    };
    disposables.push(
      TransliterationProviderRegistry.register({
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
