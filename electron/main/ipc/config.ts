import fs from "node:fs/promises";
import { dialog, ipcMain } from "electron";
import { store } from "@main/store";
import type { ConfigPath } from "@main/store/types";
import type { ProxySettings } from "@shared/types/settings";
import { systemLog } from "@main/utils/logger";
import {
  enable as enableMedia,
  disable as disableMedia,
  reloadDiscordConfig,
} from "@main/services/media";
import { reloadConfig as reloadLastfmConfig } from "@main/services/lastfm";
import {
  setNormalizationEnabled,
  setEqualizerEnabled,
  setEqualizerBands,
  setPreampGain,
  setAudioSuperResolution,
  setBassEnhancer,
  setStereoWidener,
  setLoudnessNormalizer,
  setNeuralUpsample,
  loadNeuralModel,
  setProxy,
  getPlayer,
} from "@main/services/engine";
import { syncPreventSleep } from "@main/services/preventSleep";
import {
  setTaskbarProgress,
  applyMainWindowZoom,
  applyDesktopLyricLock,
  applyDesktopLyricAlwaysOnTop,
  applyDynamicIslandAlwaysOnTop,
  applyDynamicIslandSnapCentered,
  applyDynamicIslandHorizontalOffset,
  applyDynamicIslandNotchFusion,
  applyDynamicIslandNonOcclusive,
  applyDynamicIslandSuppressFullscreen,
  applyDynamicIslandAutoStart,
  applyTaskbarLyricLayout,
} from "@main/window";
import { broadcast } from "@main/utils/broadcast";
import { isWin } from "@main/utils/config";
import { startServer, stopServer } from "@main/server";
import { setOrpheusProtocolRegistered } from "@main/services/orpheus";

/** 配置写入后的副作用 */
const applyConfigChange = (keyPath: string, value: unknown): void => {
  switch (keyPath) {
    case "media.systemMediaControls":
      value ? enableMedia() : disableMedia();
      break;
    case "media.discord.enabled":
    case "media.discord.showWhenPaused":
    case "media.discord.displayMode":
      reloadDiscordConfig();
      break;
    case "lastfm.enabled":
    case "lastfm.scrobble":
    case "lastfm.nowPlaying":
    case "lastfm.loveSync":
      reloadLastfmConfig();
      break;
    case "player.loudnessNormalization":
      setNormalizationEnabled(value as boolean);
      break;
    case "player.equalizer.enabled":
      setEqualizerEnabled(value as boolean);
      break;
    case "player.equalizer.bands":
      setEqualizerBands(value as number[]);
      break;
    case "player.equalizer.preamp":
      setPreampGain(value as number);
      break;
    case "player.audioSuperResolution.enabled":
    case "player.audioSuperResolution.backend":
    case "player.audioSuperResolution.params": {
      // 整体对象读取：开关 / 后端 / 参数任一变化都重新下发完整三元组
      const sr = store.get("player.audioSuperResolution") as {
        enabled: boolean;
        backend: 0 | 1 | 2;
        params: {
          hpFreq: number;
          hpQ: number;
          drive: number;
          h2Drive: number;
          h2Mix: number;
          wetMix: number;
          inputLimit: number;
          bypass: boolean;
        };
      };
      setAudioSuperResolution(sr.enabled, sr.backend, sr.params);
      break;
    }
    case "player.bassEnhancer.enabled":
    case "player.bassEnhancer.freq":
    case "player.bassEnhancer.gainDb":
    case "player.bassEnhancer.q":
    case "player.bassEnhancer.harmonicsMix":
    case "player.bassEnhancer.bypass": {
      const be = store.get("player.bassEnhancer") as {
        enabled: boolean;
        freq: number;
        gainDb: number;
        q: number;
        harmonicsMix: number;
        bypass: boolean;
      };
      setBassEnhancer(be.enabled, be);
      break;
    }
    case "player.stereoWidener.enabled":
    case "player.stereoWidener.width":
    case "player.stereoWidener.crossFeed":
    case "player.stereoWidener.haasEnabled":
    case "player.stereoWidener.bypass": {
      const sw = store.get("player.stereoWidener") as {
        enabled: boolean;
        width: number;
        crossFeed: number;
        haasEnabled: boolean;
        bypass: boolean;
      };
      setStereoWidener(sw.enabled, sw);
      break;
    }
    case "player.loudnessNormalizer.enabled":
    case "player.loudnessNormalizer.targetLufs":
    case "player.loudnessNormalizer.maxGainDb":
    case "player.loudnessNormalizer.bypass": {
      const ln = store.get("player.loudnessNormalizer") as {
        enabled: boolean;
        targetLufs: number;
        maxGainDb: number;
        bypass: boolean;
      };
      setLoudnessNormalizer(ln.enabled, ln);
      break;
    }
    case "player.neuralUpsample.enabled":
    case "player.neuralUpsample.backend":
    case "player.neuralUpsample.params":
    case "player.neuralUpsample.modelPath": {
      const nu = store.get("player.neuralUpsample") as {
        enabled: boolean;
        backend: 0 | 1;
        modelPath: string | null;
        params: { inputGainDb: number; wetMix: number; bypass: boolean };
      };
      setNeuralUpsample(nu.enabled, nu.backend, nu.params);
      // 模型路径变化时尝试加载（OnceLock：首次成功后不再重试）
      if (nu.modelPath) void loadNeuralModel(nu.modelPath);
      break;
    }
    case "system.taskbarProgress":
      if (!value) setTaskbarProgress(-1);
      break;
    case "system.registerOrpheusProtocol":
      setOrpheusProtocolRegistered(value as boolean);
      break;
    case "system.proxy.protocol":
    case "system.proxy.host":
    case "system.proxy.port":
    case "system.proxy.username":
    case "system.proxy.password": {
      // 整体对象读取：代理任一字段变化都重新下发完整配置
      const proxy = store.get("system.proxy") as ProxySettings;
      setProxy(proxy);
      break;
    }
    case "system.preventSleep": {
      // 配置变更时按当前播放状态同步；播放器未创建时按未播放处理
      let playing = false;
      try {
        playing = getPlayer().getStatus().state === "playing";
      } catch {}
      syncPreventSleep(playing, value as boolean);
      break;
    }
    case "externalApi.enabled":
      void (value ? startServer() : stopServer());
      break;
    case "system.uiZoom":
      applyMainWindowZoom();
      break;
    case "desktopLyric.locked":
      applyDesktopLyricLock(value as boolean);
      break;
    case "desktopLyric.alwaysOnTop":
      applyDesktopLyricAlwaysOnTop(value as boolean);
      break;
    case "dynamicIsland.alwaysOnTop":
      applyDynamicIslandAlwaysOnTop(value as boolean);
      break;
    case "dynamicIsland.snapCentered":
      applyDynamicIslandSnapCentered(value as boolean);
      break;
    case "dynamicIsland.horizontalOffset":
      applyDynamicIslandHorizontalOffset(value as number);
      break;
    case "dynamicIsland.notchFusion":
      applyDynamicIslandNotchFusion(value as boolean);
      break;
    case "dynamicIsland.nonOcclusive":
      applyDynamicIslandNonOcclusive(value as boolean);
      break;
    case "dynamicIsland.suppressFullscreen":
      applyDynamicIslandSuppressFullscreen(value as boolean);
      break;
    case "dynamicIsland.autoStart":
      applyDynamicIslandAutoStart(value as boolean);
      break;
    case "taskbarLyric.position":
    case "taskbarLyric.autoMaxWidth":
    case "taskbarLyric.maxWidth":
    case "taskbarLyric.leftMargin":
    case "taskbarLyric.rightMargin":
      if (isWin) applyTaskbarLyricLayout();
      break;
  }
  // 桌面歌词配置变更广播到所有窗口
  if (keyPath.startsWith("desktopLyric.")) {
    broadcast("desktopLyric:configChange", store.get("desktopLyric"));
  }
  // 灵动岛配置变更广播到所有窗口
  if (keyPath.startsWith("dynamicIsland.")) {
    broadcast("dynamicIsland:configChange", store.get("dynamicIsland"));
  }
  // 任务栏歌词配置变更广播到所有窗口（仅 Windows）
  if (isWin && keyPath.startsWith("taskbarLyric.")) {
    broadcast("taskbarLyric:configChange", store.get("taskbarLyric"));
  }
};

/** 注册配置相关 IPC */
export const registerConfigIpc = (): void => {
  ipcMain.handle("config:get", (_event, keyPath: string) => store.get(keyPath as ConfigPath));
  ipcMain.handle("config:set", (_event, keyPath: string, value: unknown) => {
    store.set(keyPath, value);
    applyConfigChange(keyPath, value);
  });
  ipcMain.handle("config:getAll", () => store.store);
  ipcMain.handle("config:reset", () => store.clear());

  /** 替换整盘配置 */
  ipcMain.handle("config:replaceAll", (_event, payload: unknown) => {
    store.replaceAll(payload);
  });

  /** 备份 */
  ipcMain.handle(
    "config:exportToFile",
    async (
      _event,
      payload: unknown,
    ): Promise<{ ok: boolean; reason?: "canceled" | "writeFailed" }> => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const result = await dialog.showSaveDialog({
        title: "导出设置备份",
        defaultPath: `splayer-settings-${stamp}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, reason: "canceled" };
      try {
        await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf-8");
        systemLog.info(`[config] settings exported to ${result.filePath}`);
        return { ok: true };
      } catch (err) {
        systemLog.error("[config] exportToFile failed", err);
        return { ok: false, reason: "writeFailed" };
      }
    },
  );

  /** 恢复 */
  ipcMain.handle(
    "config:importFromFile",
    async (): Promise<
      { ok: true; data: unknown } | { ok: false; reason: "canceled" | "readFailed" | "parseFailed" }
    > => {
      const result = await dialog.showOpenDialog({
        title: "选择设置备份文件",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, reason: "canceled" };
      }
      try {
        const text = await fs.readFile(result.filePaths[0], "utf-8");
        try {
          return { ok: true, data: JSON.parse(text) };
        } catch (err) {
          systemLog.error("[config] importFromFile parse failed", err);
          return { ok: false, reason: "parseFailed" };
        }
      } catch (err) {
        systemLog.error("[config] importFromFile read failed", err);
        return { ok: false, reason: "readFailed" };
      }
    },
  );
};
