import { ipcMain } from "electron";
import * as lastfm from "@main/services/lastfm";

/** 注册 Last.fm 相关 IPC */
export const registerLastfmIpc = (): void => {
  ipcMain.handle("lastfm:connect", () => lastfm.connect());
  ipcMain.handle("lastfm:cancelConnect", () => lastfm.cancelConnect());
  ipcMain.handle("lastfm:disconnect", () => lastfm.disconnect());
  ipcMain.handle("lastfm:getStatus", () => lastfm.getStatus());
  ipcMain.handle("lastfm:love", (_event, artist: string, track: string, loved: boolean) =>
    lastfm.love(artist, track, loved),
  );
};
