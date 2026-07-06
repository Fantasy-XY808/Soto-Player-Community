/**
 * 图片预加载 composable
 *
 * 用 HTMLImageElement + decode() Promise 提前解码，避免首次显示时的闪烁与布局抖动。
 * src 变化时自动重新加载，旧加载结果通过 token 失效；卸载时释放 Image 引用。
 *
 * 适用场景：详情页大封面、MV 海报、电台头部图等"先解码再淡入"的视觉关键元素。
 * 列表小图（SImg）已自带 lazy + decode + fallback，不需要走这里。
 */
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";

export interface UseImagePreloadReturn {
  /** 是否已成功加载并完成解码 */
  loaded: Ref<boolean>;
  /** 是否加载失败 */
  error: Ref<boolean>;
  /** 解码完成后的 HTMLImageElement，可用于 canvas 绘制或直接展示 */
  img: Ref<HTMLImageElement | null>;
}

/**
 * 预加载单张图片
 * @param source - 响应式图片地址；空值/null/undefined 时回到初始状态
 * @returns loaded / error / img 三个响应式状态
 */
export function useImagePreload(
  source: Ref<string | undefined | null>,
): UseImagePreloadReturn {
  const loaded = ref(false);
  const error = ref(false);
  const img = shallowRef<HTMLImageElement | null>(null);

  /** src 切换时自增，旧 Promise resolve 后比对 token 决定是否丢弃 */
  let token = 0;

  const reset = (): void => {
    token++;
    loaded.value = false;
    error.value = false;
    img.value = null;
  };

  watch(
    () => source.value,
    (next) => {
      reset();
      if (!next) return;
      const myToken = token;
      const image = new Image();
      image.decoding = "async";
      image.onload = (): void => {
        if (myToken !== token) return;
        // decode() 返回 Promise；解码完成才算真正可显示，避免首帧卡顿
        const decoded =
          typeof image.decode === "function" ? image.decode() : Promise.resolve();
        decoded
          .then(() => {
            if (myToken !== token) return;
            img.value = image;
            loaded.value = true;
          })
          .catch(() => {
            if (myToken !== token) return;
            error.value = true;
          });
      };
      image.onerror = (): void => {
        if (myToken !== token) return;
        error.value = true;
      };
      image.src = next;
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    token++;
  });

  return { loaded, error, img };
}
