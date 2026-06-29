import { ipcMain } from "electron";
import {
  insertPlayEvent,
  insertFavoriteEvent,
  getStatsSummary,
  getTopTracks,
  getTopArtists,
  getHourlyDistribution,
} from "@main/database/playStats";
import type { PlayEventInput, FavoriteEventInput } from "@shared/types/stats";

/** 播放统计 IPC */
export const registerStatsIpc = (): void => {
  ipcMain.on("stats:recordPlay", (_event, payload: PlayEventInput) => {
    insertPlayEvent(payload);
  });
  ipcMain.on("stats:recordFavorite", (_event, payload: FavoriteEventInput) => {
    insertFavoriteEvent(payload);
  });
  ipcMain.handle("stats:getStatsSummary", () => getStatsSummary());
  ipcMain.handle("stats:getTopTracks", (_event, limit: number) => getTopTracks(limit));
  ipcMain.handle("stats:getTopArtists", (_event, limit: number) => getTopArtists(limit));
  ipcMain.handle("stats:getHourlyDistribution", () => getHourlyDistribution());
};
