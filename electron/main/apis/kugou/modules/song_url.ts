/**
 * 获取酷狗播放 URL（play/getdata 接口）
 *
 * 主协议：wwwapi.kugou.com/yy/index.php?r=play/getdata
 *   匿名态可拿 128k mp3；登录态（withCredentials=true）注入 cookie 后可拿 VIP 高品质
 * 兜底：m.kugou.com/app/i/getSongInfo.php?cmd=playInfo
 *   老的移动端接口，字段名不同（url 而非 play_url），匿名态同样可拿 128k
 *
 * params:
 * - hash              文件 hash（必填），来自搜索结果的 hashes['128k'] 或顶层 hash
 * - albumId           专辑 id（可选，部分歌曲缺 album_id 会拿不到 purl）
 * - withCredentials   true 时注入用户 cookie 拿 VIP URL，失败回落匿名
 *
 * 返回：
 * - code 200 + url：可播放的 http(s) 链接
 * - code 200 + url ""：版权 / VIP 限制，play_url 为空
 * - code 4xx/5xx：参数错误或请求失败
 */

import { randomBytes } from "node:crypto";
import { kugouLog } from "@main/utils/logger";
import { kgRequest } from "../core/request";
import type { KGModule } from "../core/types";

/** wwwapi 走 https，域名和路径固定 */
const PLAY_GETDATA_URL = "https://wwwapi.kugou.com/yy/index.php";

/** 兜底：移动端 playInfo 接口 */
const PLAY_INFO_URL = "https://m.kugou.com/app/i/getSongInfo.php";

/**
 * kg_mid / kg_dfid 是酷狗的设备指纹，匿名态不严格校验合法性，
 * 但需要稳定（不同值会改变 cookie 命中），用模块级常量持久化
 */
const KG_MID = randomBytes(16).toString("hex");
const KG_DFID = randomBytes(16).toString("hex");

/** app_id=1005 是酷狗 PC 客户端的较新版本，1001 已被风控收紧 */
const KG_APP_ID = "1005";
/** clientver=8393 对应酷狗 PC 客户端 8.3.9.3，缺失会被判为脚本 */
const KG_CLIENT_VER = "8393";

/** 浏览器伪装 UA + Referer，避免被风控判为脚本 */
const KG_PLAY_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.kugou.com/song/",
  Cookie: `kg_mid=${KG_MID}; kg_dfid=${KG_DFID}; app_id=${KG_APP_ID}`,
};

/** 移动端 playInfo 用不同的 UA（伪装手机浏览器） */
const KG_MOBILE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
  Referer: "https://m.kugou.com/",
  Cookie: `kg_mid=${KG_MID}; kg_dfid=${KG_DFID}; app_id=${KG_APP_ID}`,
};

interface PlayDataResp {
  err_code?: number;
  data?: {
    play_url?: string;
    play_backup_url?: string;
    img?: string;
    audio_name?: string;
    author_name?: string;
  };
}

/** 移动端 playInfo 响应字段名不同（url / backup_url 顶层） */
interface PlayInfoResp {
  status?: number;
  err_code?: number;
  url?: string;
  backup_url?: string;
  img?: string;
  audio_name?: string;
  author_name?: string;
}

/** 主路径：wwwapi/yy/index.php?r=play/getdata */
const fetchByPlayGetdata = async (
  hash: string,
  albumId: string,
  withCredentials: boolean,
): Promise<string> => {
  const url =
    `${PLAY_GETDATA_URL}?r=play/getdata` +
    `&hash=${encodeURIComponent(hash)}` +
    (albumId ? `&album_id=${encodeURIComponent(albumId)}` : "") +
    `&dfid=${KG_DFID}` +
    `&mid=${KG_MID}` +
    `&userid=0` +
    `&clientver=${KG_CLIENT_VER}` +
    `&appid=${KG_APP_ID}` +
    `&format=json&showtype=1` +
    `&_=${Date.now()}`;

  const body = await kgRequest<PlayDataResp>(url, { headers: KG_PLAY_HEADERS }, withCredentials);
  const playUrl = body?.data?.play_url ?? "";
  const backupUrl = body?.data?.play_backup_url ?? "";
  if (playUrl) {
    kugouLog.info(`play/getdata 命中 play_url → ${playUrl.slice(0, 80)}...`);
  } else if (backupUrl) {
    kugouLog.info(`play/getdata 主 URL 为空，使用 backup_url → ${backupUrl.slice(0, 80)}...`);
  } else {
    kugouLog.warn(
      `play/getdata play_url/play_backup_url 均为空，err_code=${body?.err_code ?? "?"}，可能是版权限制`,
    );
  }
  return playUrl || backupUrl;
};

/** 兜底：m.kugou.com/app/i/getSongInfo.php?cmd=playInfo */
const fetchByPlayInfo = async (hash: string, withCredentials: boolean): Promise<string> => {
  const url =
    `${PLAY_INFO_URL}?cmd=playInfo&hash=${encodeURIComponent(hash)}` +
    `&dfid=${KG_DFID}&mid=${KG_MID}&userid=0&clientver=${KG_CLIENT_VER}&appid=${KG_APP_ID}` +
    `&format=json&showtype=1&_=${Date.now()}`;

  const body = await kgRequest<PlayInfoResp>(url, { headers: KG_MOBILE_HEADERS }, withCredentials);
  const u = body?.url ?? "";
  const b = body?.backup_url ?? "";
  if (u) {
    kugouLog.info(`playInfo 兜底命中 url → ${u.slice(0, 80)}...`);
  } else if (b) {
    kugouLog.info(`playInfo 兜底命中 backup_url → ${b.slice(0, 80)}...`);
  } else {
    kugouLog.warn(`playInfo 兜底也空，err_code=${body?.err_code ?? "?"}`);
  }
  return u || b;
};

const song_url: KGModule = async (params) => {
  const hash = String(params.hash ?? "").trim();
  if (!hash) return { code: 400, url: "", message: "hash required" };
  const albumId = String(params.albumId ?? "").trim();
  const withCredentials = params.withCredentials === true;

  // 主路径优先：wwwapi 域名稳定，带 album_id 时命中率高
  try {
    const url = await fetchByPlayGetdata(hash, albumId, withCredentials);
    if (url) return { code: 200, url };
  } catch (err) {
    kugouLog.warn("play/getdata 异常，回落 playInfo:", err);
  }

  // 兜底：playInfo 老接口，字段名不同；部分曲目 wwwapi 拒绝但 playInfo 仍可返回
  // playInfo 老接口对 VIP cookie 不敏感，回落时不再带凭证
  try {
    const url = await fetchByPlayInfo(hash, false);
    if (url) return { code: 200, url };
  } catch (err) {
    kugouLog.warn("playInfo 兜底也失败:", err);
  }

  kugouLog.warn(`song_url 全部失败，hash=${hash} albumId=${albumId || "(无)"}`);
  return { code: 200, url: "" };
};

export default song_url;
