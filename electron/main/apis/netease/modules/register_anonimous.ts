/**
 * 注册匿名态（获取 MUSIC_A）
 *
 * 逻辑来源：@neteasecloudmusicapienhanced/api module/register_anonimous.js
 * - 生成 52 位 hex deviceId
 * - 用 `${deviceId} ${md5(deviceId ^ ID_XOR_KEY_1)}` 做 Base64 作为 username
 * - 调用 xeapi 注册（反爬加密），将返回的 MUSIC_A 缓存到设备态
 *
 * 反爬加密说明：
 * - 服务端要求该接口走 xeapi（X25519 + AES-GCM 封装动态密钥 + HMAC-SHA256 签名）
 * - 公钥通过 /api/gorilla/anti/crawler/security/key/get 拉取并缓存（core/xeapi.ts）
 * - 会话密钥由响应头 x-encr-ssid / x-encr-sskey 下发，后续请求复用
 */

import { createHash } from "node:crypto";
import { createOption } from "../core/option";
import { regenerateDeviceId, setAnonymousToken } from "../core/device";
import type { NeteaseModule } from "../core/types";

const ID_XOR_KEY = "3go8&$8*3*3h0k(2)2";

const encodeId = (deviceId: string): string => {
  let xored = "";
  for (let i = 0; i < deviceId.length; i++) {
    xored += String.fromCharCode(
      deviceId.charCodeAt(i) ^ ID_XOR_KEY.charCodeAt(i % ID_XOR_KEY.length),
    );
  }
  return createHash("md5").update(xored, "utf8").digest("base64");
};

/**
 * 从 set-cookie 数组中提取 MUSIC_A 的值
 *
 * xeapi 注册响应不返回 body.token，匿名令牌通过 Set-Cookie 头下发；
 * 某些 Node fetch 实现会把多条 Set-Cookie 合并到同一字符串（用 `;;` 分隔），
 * 因此先 join 再按 `;` 拆分逐段匹配，避免漏掉目标 cookie
 * @param cookies set-cookie 数组
 * @returns MUSIC_A 值或空字符串
 */
const extractMusicA = (cookies: string[]): string => {
  const merged = cookies.join(";");
  for (const seg of merged.split(";")) {
    const trimmed = seg.trim();
    if (trimmed.startsWith("MUSIC_A=")) {
      const val = trimmed.slice("MUSIC_A=".length).trim();
      if (val) return val;
    }
  }
  return "";
};

const registerAnonimous: NeteaseModule = async (query, request) => {
  const deviceId = regenerateDeviceId();
  const username = Buffer.from(`${deviceId} ${encodeId(deviceId)}`, "utf8").toString("base64");
  const data = { username };

  const result = await request("/api/register/anonimous", data, createOption(query, "xeapi"));
  const body = result.body as { code?: number; [key: string]: unknown };

  if (body.code === 200) {
    // 优先使用 body.token（部分版本仍走此字段）
    if (typeof body.token === "string") {
      setAnonymousToken(body.token);
    } else {
      // xeapi 链路下 token 通过 Set-Cookie 的 MUSIC_A 下发
      const musicA = extractMusicA(result.cookie);
      if (musicA) setAnonymousToken(musicA);
    }
    return {
      status: 200,
      body: { ...body, cookie: result.cookie.join(";") },
      cookie: result.cookie,
    };
  }
  return result;
};

export default registerAnonimous;
