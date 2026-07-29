import { ElectronAPI } from "@electron-toolkit/preload";
import { PlayerApi, TrackSource, Track } from "@shared/types/player";
import {
  ConfigApi,
  ExternalApiStatus,
  LocaleCode,
  ListenTogetherStatus,
  ListenTogetherLocalUser,
  ListenTogetherDiscoveredSession,
  ListenTogetherPermissions,
} from "@shared/types/settings";
import type { EasyTierStatus } from "@main/listenTogether";
import { LibraryApi } from "@shared/types/library";
import { NowPlayingApi } from "@shared/types/nowPlaying";
import { PluginsApi } from "@shared/types/plugin";
import { ApisApi } from "@shared/types/apis";
import { LyricsApi } from "@shared/types/lyrics";
import { DownloadApi } from "@shared/types/download";
import {
  WindowApi,
  DesktopLyricApi,
  DynamicIslandApi,
  TaskbarLyricApi,
} from "@shared/types/window";
import { HotkeyApi } from "@shared/types/hotkey";
import { StreamingApi } from "@shared/types/streaming";
import { QqmusicApi } from "@shared/types/qqmusic";
import { KugouApi } from "@shared/types/kugou";
import { LastfmApi } from "@shared/types/lastfm";
import { IpcResponse } from "@shared/types/player";
import { StatsApi } from "@shared/types/stats";
import { UpdateApi } from "@shared/types/update";
import { CloudUploadApi } from "@shared/types/cloudUpload";
import { MigrationApi } from "@shared/types/migration";
import { UnblockApi } from "@shared/types/unblock";
import { AudioAnalysisApi } from "@shared/types/audioAnalysis";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      config: ConfigApi;
      player: PlayerApi;
      system: {
        toggleDevTools: () => Promise<void>;
        showInExplorer: (filePath: string) => Promise<void>;
        openLogsDir: () => Promise<string>;
        setLocale: (locale: LocaleCode) => void;
        focusMainWindow: () => Promise<void>;
        openSettings: (category?: string, highlight?: string) => Promise<void>;
        onOpenSettings: (
          callback: (payload: { category?: string; highlight?: string }) => void,
        ) => () => void;
        openPlayingView: () => Promise<void>;
        onOpenPlayingView: (callback: () => void) => () => void;
        onCollapsePlayingView: (callback: () => void) => () => void;
        setPlayingViewExpanded: (expanded: boolean) => Promise<void>;
        resetPlayingViewToggle: () => Promise<void>;
        listFonts: () => Promise<string[]>;
        fetchRemoteBytes: (url: string) => Promise<IpcResponse<Buffer | null>>;
        saveFile: (
          data: ArrayBuffer,
          fileName: string,
        ) => Promise<{ success: boolean; path?: string; error?: string }>;
        relaunch: () => Promise<void>;
        onProtocolUrl: (callback: (url: string) => void) => () => void;
        consumePendingProtocolUrl: () => Promise<string | null>;
        pickDirectory: () => Promise<string | null>;
      };
      library: LibraryApi;
      window: WindowApi;
      desktopLyric: DesktopLyricApi;
      dynamicIsland: DynamicIslandApi;
      taskbarLyric: TaskbarLyricApi;
      nowPlaying: NowPlayingApi;
      plugins: PluginsApi;
      apis: ApisApi;
      cloud: CloudUploadApi;
      lyrics: LyricsApi;
      download: DownloadApi;
      theme: {
        pickBackgroundImage: () => Promise<string | null>;
        clearBackgroundImages: () => Promise<void>;
      };
      cache: {
        getStats: () => Promise<{ id: string; kind: "file" | "db"; path: string; size: number }[]>;
        clear: (id: string) => Promise<void>;
        clearAllByKind: (kind: "file" | "db") => Promise<void>;
        getDir: () => Promise<string>;
        pickDir: () => Promise<{ ok: boolean; dir: string; reason?: "canceled" | "notEmpty" }>;
        resetDir: () => Promise<string>;
        song: {
          lookup: (cacheKey: string) => Promise<string | null>;
          fetch: (
            cacheKey: string,
            source: TrackSource,
            streamUrl: string,
          ) => Promise<string | null>;
          cancel: (cacheKey: string) => Promise<void>;
        };
      };
      stats: StatsApi;
      hotkey: HotkeyApi;
      streaming: StreamingApi;
      qqmusic: QqmusicApi;
      kugou: KugouApi;
      lastfm: LastfmApi;
      externalApi: {
        restart: () => Promise<ExternalApiStatus>;
        getStatus: () => Promise<ExternalApiStatus>;
      };
      listenTogether: {
        getStatus: () => Promise<ListenTogetherStatus>;
        onStatus: (callback: (status: ListenTogetherStatus) => void) => () => void;
        getLocalUserInfo: () => Promise<ListenTogetherLocalUser | null>;
        startHost: (
          name: string,
          password: string,
          permissions: ListenTogetherPermissions,
        ) => Promise<{ ok: boolean; address: string | null; error?: string }>;
        stopHost: () => Promise<void>;
        joinSession: (
          url: string,
          password: string,
          shareCode?: string,
        ) => Promise<{ ok: boolean; error?: string }>;
        leaveSession: () => Promise<void>;
        browseSessions: () => void;
        stopBrowse: () => void;
        onDiscovered: (
          callback: (sessions: ListenTogetherDiscoveredSession[]) => void,
        ) => () => void;
        getDiscoveredSessions: () => Promise<ListenTogetherDiscoveredSession[]>;
        getEasyTierStatus: () => Promise<EasyTierStatus>;
        notifyQueueUpdate: (queue: Track[], currentIndex: number) => void;
        // 主机端：通知主进程曲目切换（用于 player:load 之外的场景，例如客户端首次加入后主机已就绪）
        // 主机端通常由 player.ts 直接调用 handlePlayerEvent 触发广播；本通道作为渲染端冗余兜底
        notifyTrackChange: (
          track: Track | null,
          position: number,
          state: "playing" | "paused",
        ) => void;
      };
      update: UpdateApi;
      migration: MigrationApi;
      unblock: UnblockApi;
      audioAnalysis: AudioAnalysisApi;
      /**
       * 彩蛋相关 API
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
       * 如果你知道這個彩蛋，請一定不要告訴任何人🤫
       * 如果你知道呢个彩蛋，请一定唔好话俾任何人知🤫
       * Bu easter egg'i biliyorsan, lütfen kimseye söyleme🤫
       * اگر این تخم مرغ عید پاک را می‌دانید، لطفاً به کسی نگویید🤫
       * Jeśli znasz ten easter egg, nie mów o tym nikomu🤫
       * Als je deze paasei kent, vertel het dan aan niemand🤫
       * หากคุณรู้เรื่อง easter egg นี้ โปรดอย่าบอกใคร🤫
       * Nếu bạn biết easter egg này, xin đừng nói với ai🤫
       */
      easterEgg: {
        show: () => Promise<void>;
        close: () => Promise<void>;
        available: () => Promise<boolean>;
        onShowHint: (callback: (text: string) => void) => () => void;
      };
    };
  }
}
