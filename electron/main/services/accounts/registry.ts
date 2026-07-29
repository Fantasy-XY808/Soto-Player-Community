/**
 * 多平台账号适配器注册表（主进程侧）
 *
 * 各平台在此注册 PlatformLoginAdapter 实现；业务层通过此 registry 调用，
 * 不直接 import 具体平台代码，便于后续新增平台时无需改动调用方。
 *
 * 当前接入：
 *   - netease：完整扫码登录 + cookie 管理
 *
 * 后续接入（参考项目能力盘点）：
 *   - kugou：KuGouMusicApi-main 仅有账号密码登录（login.js），扫码需自行逆向
 *   - qqmusic：qq-music-api-next 明确禁用 cookie 设置，无登录能力
 *   - mora / qobuz / tidal：无参考项目，需自行实现 OAuth 流程
 */

import type {
  AccountPlatform,
  PlatformLoginAdapter,
} from "@shared/types/account";

/** 已注册的适配器表 */
const adapters = new Map<AccountPlatform, PlatformLoginAdapter>();

/** 注册某平台的登录适配器 */
export const registerLoginAdapter = (adapter: PlatformLoginAdapter): void => {
  adapters.set(adapter.platform, adapter);
};

/** 获取指定平台的登录适配器；未注册返回 undefined */
export const getLoginAdapter = (
  platform: AccountPlatform,
): PlatformLoginAdapter | undefined => adapters.get(platform);

/** 列出所有已注册支持登录的平台 */
export const listSupportedPlatforms = (): AccountPlatform[] =>
  Array.from(adapters.keys());

/** 检查指定平台是否已注册登录适配器 */
export const isLoginSupported = (platform: AccountPlatform): boolean =>
  adapters.has(platform);
