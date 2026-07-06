import type { RGB } from "@/utils/palette";
import { extractPalette, getDominantColor, getForegroundColor, rgbToHsl, hslToRgb } from "@/utils/palette";

/**
 * 提升调色板亮度与饱和度，确保流体背景着色器输出可见
 * 深色封面提取的颜色往往偏暗，直接传给着色器会导致输出接近纯黑
 * @param colors - 原始调色板
 * @returns 增强后的调色板
 */
const enhancePaletteColors = (colors: RGB[]): RGB[] =>
  colors.map((c) => {
    const hsl = rgbToHsl(c);
    const enhancedL = Math.min(0.72, hsl.l * 1.8 + 0.2);
    const enhancedS = Math.min(0.95, hsl.s * 1.5 + 0.15);
    return hslToRgb({ h: hsl.h, s: enhancedS, l: enhancedL });
  });

/**
 * 封面调色板提取 composable
 * 从封面图提取多色调色板，缓存机制避免重复提取
 * 跨域封面 fallback：canvas getImageData 抛错时，通过主进程 fetchRemoteBytes
 * 拉字节 → Blob URL（同源）→ 重新加载，绕过跨域 tainted 限制
 */
export function usePaletteExtractor() {
  const dominant = shallowRef<RGB>({ r: 128, g: 128, b: 128 });
  const palette = shallowRef<RGB[]>([{ r: 128, g: 128, b: 128 }]);
  const foreground = shallowRef<RGB>({ r: 255, g: 255, b: 255 });

  /** 上次提取的封面 URL */
  let lastUrl = "";
  /** 采样用 Canvas */
  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d")!;
  // 采样尺寸：64x64 足够提取主色
  sampleCanvas.width = 64;
  sampleCanvas.height = 64;

  /** 重置为默认灰色 */
  const resetToDefault = (): void => {
    palette.value = [{ r: 128, g: 128, b: 128 }];
    dominant.value = { r: 128, g: 128, b: 128 };
    foreground.value = { r: 255, g: 255, b: 255 };
  };

  /** 从已加载的 Image 提取调色板（成功更新 ref，失败抛错） */
  const extractFromImage = (img: HTMLImageElement): void => {
    sampleCtx.drawImage(img, 0, 0, 64, 64);
    const imageData = sampleCtx.getImageData(0, 0, 64, 64);
    const colors = extractPalette(imageData, 4);
    const enhanced = enhancePaletteColors(colors);
    palette.value = enhanced;
    dominant.value = getDominantColor(enhanced);
    foreground.value = getForegroundColor(dominant.value);
  };

  /**
   * 跨域 fallback：主进程拉字节 → Blob URL（同源）→ 重新加载提取
   * 仅对远程 http(s) URL 触发；cover:// 本地协议无跨域问题
   */
  const extractViaMainProcess = async (url: string): Promise<void> => {
    if (!/^https?:\/\//i.test(url)) {
      resetToDefault();
      return;
    }
    try {
      const result = await window.api.system.fetchRemoteBytes(url);
      if (!result?.success || !result.data) {
        resetToDefault();
        return;
      }
      // IPC 传输的 Buffer 在渲染端为 Uint8Array，转 Blob 再创同源 ObjectURL
      // cast 为 BlobPart：TS 5.7+ 严格区分 ArrayBuffer / SharedArrayBuffer，Uint8Array<ArrayBufferLike> 不再直接可赋值
      const bytes = result.data as unknown as Uint8Array;
      const blob = new Blob([bytes as BlobPart], { type: "image/*" });
      const blobUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          extractFromImage(img);
        } catch {
          resetToDefault();
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        resetToDefault();
      };
      img.src = blobUrl;
    } catch {
      resetToDefault();
    }
  };

  /**
   * 从封面 URL 提取调色板
   * @param url - 封面图 URL（cover:// 协议或远程 URL）
   */
  const extract = (url: string): void => {
    if (!url || url === lastUrl) return;
    lastUrl = url;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;

    img.onload = () => {
      try {
        extractFromImage(img);
      } catch {
        // 跨域图片无法读取像素，fallback 到主进程拉字节后重新加载
        void extractViaMainProcess(url);
      }
    };

    img.onerror = () => {
      lastUrl = "";
    };
  };

  /** 重置为默认色 */
  const reset = (): void => {
    lastUrl = "";
    resetToDefault();
  };

  return { dominant, palette, foreground, extract, reset };
}