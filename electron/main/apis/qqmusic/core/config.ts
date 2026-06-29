/**
 * QM API 通用常量
 */

/** 统一接口入口（移动端 musicu） */
export const QM_API_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";

/** 模拟移动端的默认 headers */
export const QM_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip",
  "User-Agent": "okhttp/3.14.9",
  Referer: "https://y.qq.com",
  Cookie: "tmeLoginType=-1;",
};

/**
 * 生成稳定 QIMEI36（36 位 hex 字符串）
 *
 * QIMEI36 是 QQ 音乐 Android 客户端的设备指纹，格式为「8-4-4-4-12-4」hex。
 * 填 "0" 等同于告诉服务端"我是脚本"，vkey 接口会拒绝返回 purl。
 * 此处按 QQ 客户端的 hex 格式生成稳定的伪指纹（进程级不变），
 * 服务端无法做深度校验（真机 QIMEI 由其 SDK 上报，绑定 IMEI/Android ID），
 * 但格式合法即可绕过浅层风控。
 */
const generateQimei36 = (): string => {
  const hex = "0123456789abcdef";
  // 段长度：8-4-4-4-12-4
  const segments = [8, 4, 4, 4, 12, 4];
  const now = Date.now().toString(16).padStart(12, "0").slice(-12);
  let counter = 0;
  return segments
    .map((len, idx) => {
      let s = "";
      for (let i = 0; i < len; i++) {
        // 混入时间戳和计数器，避免连续位相同
        const seed = (now.charCodeAt(counter % now.length) + idx * 31 + i * 17) % 16;
        s += hex[seed];
        counter++;
      }
      return s;
    })
    .join("-");
};

/** 进程级稳定的 QIMEI36，启动时生成一次 */
const QIMEI36 = generateQimei36();

/** 请求体 comm 字段（伪装 Android 客户端） */
export const getCommonParams = (): Record<string, string | number> => ({
  ct: 11,
  cv: "1003006",
  v: "1003006",
  os_ver: "15",
  phonetype: "24122RKC7C",
  tmeAppID: "qqmusiclight",
  nettype: "NETWORK_WIFI",
  udid: "0",
  OpenUDID: "0",
  QIMEI36: QIMEI36,
  uin: "0",
});

/** Session 缓存时长（毫秒） */
export const SESSION_TTL = 60 * 60 * 1000;

/** 歌手数组格式化工具：`[{name:'A'},{name:'B'}]` → `A / B` */
export const formatSingerName = (
  singers: Array<{ name?: string; title?: string }> | undefined,
  key: "name" | "title" = "name",
  join = " / ",
): string => {
  if (!singers?.length) return "";
  return singers
    .map((item) => item[key])
    .filter((item): item is string => !!item)
    .join(join);
};
