/**
 * PKCE（Proof Key for Code Exchange）实现
 *
 * OAuth 2.0 PKCE 流程：
 * - 客户端生成 code_verifier（43-128 字符随机串）
 * - 计算 code_challenge = base64url(sha256(code_verifier))，去掉 = 填充
 * - 授权请求带 code_challenge + code_challenge_method=S256
 * - token 交换带 code_verifier，服务端校验 sha256(verifier) == challenge
 *
 * 防止授权码被中间人截获后无法交换 token（verifier 不暴露在 URL 中）。
 */

import { createHash, randomBytes } from "node:crypto";

/** base62 字符集（用于生成 code_verifier） */
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * 生成 PKCE code_verifier（43 字符 base62 随机串）
 *
 * RFC 7636 要求 43-128 字符；这里固定 43 字符（256 bit 熵足够）。
 */
export const generateCodeVerifier = (): string => {
  const bytes = randomBytes(43);
  let out = "";
  for (let i = 0; i < 43; i++) {
    out += BASE62[bytes[i] % 62];
  }
  return out;
};

/**
 * 计算 PKCE code_challenge
 *
 * @param verifier code_verifier
 * @returns base64url(sha256(verifier))，去掉 = 填充
 */
export const computeCodeChallenge = (verifier: string): string => {
  const hash = createHash("sha256").update(verifier).digest("base64url");
  // base64url 已去掉 = 填充，但兜底再 trim 一次
  return hash.replace(/=+$/g, "");
};

/**
 * 生成随机 state（用于 CSRF 防护）
 *
 * state 会随授权 URL 一起发送，callback 时校验一致。
 */
export const generateState = (): string => {
  return randomBytes(16).toString("hex");
};
