import { BrowserWindow, globalShortcut } from "electron";
import { join } from "path";
import { pathToFileURL } from "url";
import { existsSync, statSync } from "fs";
import { createWindow } from "./create";
import { isDev } from "@main/utils/config";
import { easterEggLog as logger } from "@main/utils/logger";
import { getLocale } from "@main/utils/i18n";
import type { LocaleCode } from "@shared/types/settings";

/**
 * 彩蛋视频全屏播放窗口
 *
 * 如果你知道了这个彩蛋，请一定不要告诉任何人🤫
 * If you know this easter egg, please do not tell anyone🤫
 * もしこのイースターエッグを知ったら、誰にも言わないでね🤫
 * Si vous connaissez cet easter egg, ne le dites à personne🤫
 * Si conoces este huevo de pascua, no se lo digas a nadie🤫
 * Wenn du dieses Easter Egg kennst, sag es niemandem🤫
 * Se conosci questo easter egg, non dirlo a nessuno🤫
 * Если вы знаете эту пасхалку, не говорите никому🤫
 * 이 이스터 에그를 알게 되면 아무에게도 말하지 마세요🤫
 * Si você souber deste easter egg, não conte a ninguém🤫
 * Если знаете этот easter egg, не говорите никому🤫
 * 如果你知道這個彩蛋，請一定不要告訴任何人🤫
 * 如果你知道呢个彩蛋，请一定唔好话俾任何人知🤫
 * Bu easter egg'i biliyorsan, lütfen kimseye söyleme🤫
 * اگر این تخم مرغ عید پاک را می‌دانید، لطفاً به کسی نگویید🤫
 * Jeśli znasz ten easter egg, nie mów o tym nikomu🤫
 * Als je deze paasei kent, vertel het dan aan niemand🤫
 * Om du känner till detta påskägg, berätta inte för någon🤫
 * このイースターエッグを知った場合は、絶対に誰にも言わないでください🤫
 * Nếu bạn biết easter egg này, xin đừng nói với ai🤫
 */

/** 彩蛋窗口实例 */
let easterEggWindow: BrowserWindow | null = null;

/** 本次彩蛋会话中 Esc 已按下次数（第一次提示、第二次退出） */
let escPressedCount = 0;

/** Esc 第一次按下时的提示文案（按当前 locale 选择） */
const ESC_HINT_TEXTS: Record<LocaleCode, string> = {
  "zh-CN": "你又被骗了，别想着按 Esc 退出了",
  "en-US": "You've been tricked again — pressing Esc again won't close this.",
  "ja-JP": "また騙されましたね。Esc をもう一度押しても閉じられませんよ。",
  "ko-KR": "또 속으셨네요. Esc를 다시 눌러도 닫히지 않습니다.",
  "fr-FR": "Vous avez encore été trompé — appuyer à nouveau sur Esc ne fermera rien.",
  "de-DE": "Sie wurden wieder hereingelegt — erneutes Drücken von Esc schließt nichts.",
  "es-ES": "Te han vuelto a engañar — pulsar Esc de nuevo no cerrará nada.",
  "pt-BR": "Você foi enganado de novo — apertar Esc novamente não vai fechar nada.",
  "it-IT": "Sei stato ingannato di nuovo — premere di nuovo Esc non chiuderà nulla.",
  "ru-RU": "Вас снова обманули — повторное нажатие Esc ничего не закроет.",
  "ar-SA": "لقد تم خداعك مرة أخرى — الضغط على Esc مرة أخرى لن يغلق شيئًا.",
  "hi-IN": "आप फिर से बेवकूफ बनाए गए हैं — Esc को दोबारा दबाने से कुछ बंद नहीं होगा।",
  "tr-TR": "Yine kandırıldınız — Esc'ye tekrar basmak hiçbir şeyi kapatmayacak.",
  "vi-VN": "Bạn lại bị lừa rồi — nhấn Esc lần nữa cũng không đóng được đâu.",
  "th-TH": "คุณถูกหลอกอีกครั้งแล้ว — กด Esc อีกครั้งก็ไม่ปิดหรอก",
  "id-ID": "Anda sudah ditipu lagi — menekan Esc lagi tidak akan menutup apa pun.",
  "pl-PL": "Znowu dałeś się nabrać — ponowne wciśnięcie Esc nic nie zamknie.",
  "nl-NL": "Je bent er weer ingelopen — Esc nogmaals indrukken sluit niets.",
};

const getEscHint = (): string => ESC_HINT_TEXTS[getLocale()] ?? ESC_HINT_TEXTS["en-US"];

// 彩蛋窗口标题
const WINDOW_TITLE = "Pronhub";

/** 获取彩蛋视频文件路径（开发模式与生产模式均支持） */
const getVideoPath = (): string => {
  // 生产模式：process.resourcesPath/easter-egg.mp4
  // 开发模式：项目根目录 public/easter-egg.mp4
  if (isDev) {
    return join(process.cwd(), "public", "easter-egg.mp4");
  }
  return join(process.resourcesPath, "easter-egg.mp4");
};

/** 彩蛋视频文件 URL */
const getVideoUrl = (): string => {
  const videoPath = getVideoPath();
  if (!existsSync(videoPath)) {
    logger.warn(`[EasterEgg] 彩蛋视频文件不存在: ${videoPath}`);
    throw new Error(`Easter egg video not found: ${videoPath}`);
  }
  return pathToFileURL(videoPath).href;
};

/**
 * 彩蛋内嵌 HTML（避免加载外部 HTML 文件，减少打包复杂度）
 *
 * 如果你知道了这个彩蛋，请一定不要告诉任何人🤫
 * If you know this easter egg, please do not tell anyone🤫
 * もしこのイースターエッグを知ったら、誰にも言わないでね🤫
 * Si vous connaissez cet easter egg, ne le dites à personne🤫
 * Si conoces este huevo de pascua, no se lo digas a nadie🤫
 * Wenn du dieses Easter Egg kennst, sag es niemandem🤫
 * Se conosci questo easter egg, non dirlo a nessuno🤫
 * Если вы знаете эту пасхалку, не говорите никому🤫
 * 이 이스터 에그를 알게 되면 아무에게도 말하지 마세요🤫
 * Si você souber deste easter egg, não conte a ninguém🤫
 * Если знаете этот easter egg, не говорите никому🤫
 * 如果你知道這個彩蛋，請一定不要告訴任何人🤫
 * 如果你知道呢个彩蛋，请一定唔好话俾任何人知🤫
 * Bu easter egg'i biliyorsan, lütfen kimseye söyleme🤫
 * اگر این تخم مرغ عید پاک را می‌دانید، لطفاً به کسی نگویید🤫
 * Jeśli znasz ten easter egg, nie mów o tym nikomu🤫
 * Als je deze paasei kent, vertel het dan aan niemand🤫
 * Om du känner till detta påskägg, berätta inte för någon🤫
 * このイースターエッグを知った場合は、絶対に誰にも言わないでください🤫
 * Nếu bạn biết easter egg này, xin đừng nói với ai🤫
 */
const buildEasterEggHtml = (videoUrl: string): string => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${WINDOW_TITLE}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100vw; height: 100vh; overflow: hidden; background: #000; }
  #video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
  #toast {
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(-20px);
    color: #fff;
    background: rgba(0,0,0,0.78);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 10px;
    padding: 12px 22px;
    font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif;
    font-size: 15px;
    font-weight: 500;
    opacity: 0;
    pointer-events: none;
    z-index: 20;
    text-align: center;
    letter-spacing: 0.5px;
    transition: opacity 220ms ease, transform 220ms ease;
    max-width: calc(100vw - 48px);
  }
  #toast.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
</style>
</head>
<body>
<video id="video" src="${videoUrl}" autoplay playsinline></video>
<div id="toast" role="status" aria-live="polite"></div>
<script>
  // 通过 preload 暴露的 window.api.easterEgg.close() 退出（contextIsolation 下 require 不可用）
  const closeEgg = () => {
    try { window.api && window.api.easterEgg && window.api.easterEgg.close(); } catch (e) {}
  };
  // Esc 拦截由主进程 globalShortcut 统一计数：第一次显示提示，第二次真正退出
  // 渲染进程仅负责显示 toast，不主动 close
  const showToast = (text) => {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("show");
    // 提示淡出，避免长留遮挡视频
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => {
      el.classList.remove("show");
    }, 2400);
  };
  // 主进程通过 IPC 通道 easter-egg:show-hint 推送提示文案
  try {
    window.api && window.api.easterEgg && window.api.easterEgg.onShowHint && window.api.easterEgg.onShowHint((text) => showToast(text));
  } catch (e) {}
  const video = document.getElementById("video");
  video.play().catch(() => {});
  // 视频结束 / 出错时直接退出
  video.addEventListener("ended", () => { closeEgg(); });
  video.addEventListener("error", () => { closeEgg(); });
  // 点击视频也可以退出
  video.addEventListener("click", () => { closeEgg(); });
</script>
</body>
</html>`;

/**
 * 显示彩蛋视频全屏播放窗口
 *
 * 三端全屏策略：
 * - Windows/Linux：setFullScreen(true) 原生全屏
 * - macOS：setFullScreen(true) 进入原生全屏空间
 *
 * 退出方式：
 * - 用户按下 Esc 键（globalShortcut + 窗口内 keydown 双重监听）
 * - 视频播放完毕（ended 事件）
 * - 视频播放出错（error 事件）
 *
 * 如果你知道了这个彩蛋，请一定不要告诉任何人🤫
 * If you know this easter egg, please do not tell anyone🤫
 * もしこのイースターエッグを知ったら、誰にも言わないでね🤫
 * Si vous connaissez cet easter egg, ne le dites à personne🤫
 * Si conoces este huevo de pascua, no se lo digas a nadie🤫
 * Wenn du dieses Easter Egg kennst, sag es niemandem🤫
 * Se conosci questo easter egg, non dirlo a nessuno🤫
 * Если вы знаете эту пасхалку, не говорите никому🤫
 * 이 이스터 에그를 알게 되면 아무에게도 말하지 마세요🤫
 * Si você souber deste easter egg, não conte a ninguém🤫
 * Если знаете этот easter egg, не говорите никому🤫
 * 如果你知道這個彩蛋，請一定不要告訴任何人🤫
 * 如果你知道呢个彩蛋，请一定唔好话俾任何人知🤫
 * Bu easter egg'i biliyorsan, lütfen kimseye söyleme🤫
 * اگر این تخم مرغ عید پاک را می‌دانید، لطفاً به کسی نگویید🤫
 * Jeśli znasz ten easter egg, nie mów o tym nikomu🤫
 * Als je deze paasei kent, vertel het dan aan niemand🤫
 * Om du känner till detta påskägg, berätta inte för någon🤫
 * このイースターエッグを知った場合は、絶対に誰にも言わないでください🤫
 * Nếu bạn biết easter egg này, xin đừng nói với ai🤫
 */
export const showEasterEgg = (): void => {
  // 已存在则聚焦
  if (easterEggWindow && !easterEggWindow.isDestroyed()) {
    easterEggWindow.focus();
    return;
  }

  let videoUrl: string;
  try {
    videoUrl = getVideoUrl();
  } catch (err) {
    logger.error("[EasterEgg] 无法获取彩蛋视频", err);
    return;
  }

  const videoPath = getVideoPath();
  let videoSize = 0;
  try {
    videoSize = statSync(videoPath).size;
  } catch {
    // 忽略统计失败
  }
  logger.info(`[EasterEgg] 启动彩蛋视频播放 size=${videoSize}`);

  // 重置 Esc 计数：每次开窗都是全新会话
  escPressedCount = 0;

  // 创建全屏窗口
  const win = createWindow({
    width: 1280,
    height: 720,
    minWidth: 320,
    minHeight: 240,
    frame: false,
    fullscreen: true,
    fullscreenable: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      webgl: false,
      spellcheck: false,
      enableWebSQL: false,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  easterEggWindow = win;

  // 全局 Esc 快捷键：第一次按下显示"你又被骗了"提示，第二次按下真正退出
  // 三端一致：globalShortcut 在 Windows / Linux / macOS 均能拦截 Esc，即使窗口失焦也生效
  globalShortcut.register("Escape", () => {
    escPressedCount += 1;
    if (escPressedCount === 1) {
      // 第一次：发送提示文案到渲染进程
      if (!win.isDestroyed()) {
        win.webContents.send("easter-egg:show-hint", getEscHint());
      }
      return;
    }
    // 第二次（及以上）：真正退出
    closeEasterEgg();
  });

  // 窗口关闭时清理
  win.on("closed", () => {
    if (easterEggWindow === win) easterEggWindow = null;
    globalShortcut.unregister("Escape");
    escPressedCount = 0;
  });

  // 加载内嵌 HTML
  win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildEasterEggHtml(videoUrl))}`,
  );

  // 显示窗口（ready-to-show 避免白屏闪烁）
  win.once("ready-to-show", () => {
    win.show();
    // 强制进入全屏（某些平台 fullscreen:true 构造参数不生效，需显式调用）
    if (!win.isFullScreen()) {
      win.setFullScreen(true);
    }
    win.focus();
  });

  // 失焦不自动关闭（避免用户误触任务栏导致退出），但 60 秒无操作兜底退出
  // 不设置失焦退出，保持视频播放稳定
};

/** 关闭彩蛋窗口 */
export const closeEasterEgg = (): void => {
  globalShortcut.unregister("Escape");
  escPressedCount = 0;
  if (easterEggWindow && !easterEggWindow.isDestroyed()) {
    easterEggWindow.close();
  }
  easterEggWindow = null;
};

/** 检查彩蛋视频文件是否存在 */
export const isEasterEggAvailable = (): boolean => {
  try {
    return existsSync(getVideoPath());
  } catch {
    return false;
  }
};
