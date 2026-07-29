/**
 * 多平台账号抽象层
 *
 * 不同音源平台的账号体系差异较大：网易云用 cookie + MUSIC_U，QQ 音乐用 uin + qqmusic_key，
 * 酷狗用 token + userid，Tidal 用 OAuth access_token + refresh_token。
 * 这里抽出统一的接口，让 user store 等业务层不感知具体平台实现。
 */

/**
 * 支持账号登录的平台
 *
 * 仅包含已实现账号体系的平台；其他平台（如 bilibili / qobuz / archive）只做匿名搜索
 *
 * 接入进度：
 *   - netease：✅ 完整扫码登录 + cookie 管理
 *   - kugou：✅ 账号密码登录（参考 KuGouMusicApi-main）
 *   - qqmusic：⏳ TODO 等待参考项目，UI 已预留入口（参考 qq-music-api-next 暂不支持登录）
 *   - kuwo / qishui：⏳ TODO 无参考项目，待逆向
 *
 * 新增平台时：
 *   1. 在此处扩展 union 类型
 *   2. 实现 electron/main/services/accounts/{platform}Adapter.ts
 *   3. 在 electron/main/services/accounts/index.ts 注册 adapter
 *   4. 在 src/stores/accounts.ts 加初始 state
 *   5. 在 src/components/list/CoverCard.vue、src/components/layout/SideBar.vue、
 *      src/pages/Collection.vue 的平台颜色映射中补全
 *   6. 在 src/components/modals/LoginDialog.vue 加 Tab 入口
 *   7. 在 i18n 加 login.platform.{platform} 文案
 */
export type AccountPlatform = "netease" | "kugou" | "qqmusic";

/**
 * 平台账号资料（统一字段）
 *
 * 各平台原始字段差异较大，这里抽取 UI 通用字段；
 * 平台特有字段（如网易云 vipType）放在 platformExtra 中，由 UI 按平台分支渲染
 */
export interface PlatformUserProfile {
  /** 平台内的用户 ID（网易云 userId / QQ uin / 酷狗 userid 等） */
  userId: string;
  /** 昵称 */
  nickname: string;
  /** 头像 URL */
  avatarUrl?: string;
  /** 个人签名 / 简介 */
  signature?: string;
  /** 是否 VIP（用于 UI 显示 VIP 标识） */
  isVip?: boolean;
  /** VIP 类型描述（如「黑胶 VIP」「绿钻豪华版」等） */
  vipType?: string;
  /** 平台特有字段（网易云 vipType 数值 / QQ 音乐等级等），UI 按需读取 */
  platformExtra?: Record<string, unknown>;
}

/**
 * 扫码状态码（对齐网易云约定，其他平台映射到同一套）
 * - 800 已过期 / 801 待扫码 / 802 待确认 / 803 已确认
 */
export type QrStatusCode = 800 | 801 | 802 | 803;

/** 二维码扫码状态查询结果 */
export interface QrCheckResult {
  code: QrStatusCode;
  /** 已扫码用户的昵称（802 时返回） */
  nickname?: string;
  /** 已扫码用户的头像（802 时返回） */
  avatarUrl?: string;
  /** 803 时返回的 cookie 字符串（部分平台无此字段，由主进程直接落库） */
  cookie?: string;
}

/**
 * 平台登录能力接口
 *
 * 每个支持账号登录的平台需要实现此接口并注册到 PlatformAccountRegistry。
 * 业务层通过 registry 调用，不直接 import 具体平台实现。
 *
 * 不同平台支持不同的登录方式：
 *   - 扫码登录（网易云）：实现 startQrLogin / pollQrStatus
 *   - 账号密码登录（酷狗）：实现 accountLogin
 *   - 两者都支持的平台可同时实现
 *
 * capabilities 字段声明该平台支持的登录方式，UI 据此渲染不同登录表单
 */
export interface PlatformLoginAdapter {
  /** 平台标识 */
  platform: AccountPlatform;

  /** 该平台支持的登录方式（UI 据此渲染对应表单） */
  capabilities: {
    /** 扫码登录（网易云） */
    qr: boolean;
    /** 账号密码登录（酷狗） */
    accountPassword: boolean;
    /** 手机号 + 短信验证码登录（网易云） */
    phone: boolean;
  };

  /**
   * 启动一次扫码登录流程：生成 key + 返回二维码内容 URL
   * 仅 capabilities.qr = true 的平台需要实现
   * @returns 二维码内容（如 `https://music.163.com/login?codekey=xxx`），
   *   UI 用此内容渲染二维码
   */
  startQrLogin?: () => Promise<{ qrContent: string; key: string }>;

  /**
   * 轮询扫码状态
   * 仅 capabilities.qr = true 的平台需要实现
   * @param key startQrLogin 返回的 key
   * @returns 扫码状态
   */
  pollQrStatus?: (key: string) => Promise<QrCheckResult>;

  /**
   * 账号密码登录
   * 仅 capabilities.accountPassword = true 的平台需要实现
   * @param username 用户名 / 手机号 / 邮箱
   * @param password 明文密码（主进程内加密后传输到服务端）
   * @returns 登录成功返回用户资料；失败抛错
   */
  accountLogin?: (
    username: string,
    password: string,
  ) => Promise<PlatformUserProfile>;

  /**
   * 发送短信验证码
   * 仅 capabilities.phone = true 的平台需要实现
   * @param phone 手机号（不带区号前缀）
   * @param ctcode 国家码，默认 "86"
   */
  sendSms?: (phone: string, ctcode?: string) => Promise<void>;

  /**
   * 手机号 + 短信验证码登录
   * 仅 capabilities.phone = true 的平台需要实现
   * @param phone 手机号（不带区号前缀）
   * @param captcha 短信验证码
   * @param ctcode 国家码，默认 "86"
   * @returns 登录成功返回用户资料；失败抛错
   */
  phoneLogin?: (
    phone: string,
    captcha: string,
    ctcode?: string,
  ) => Promise<PlatformUserProfile>;

  /**
   * 校验当前会话是否有效并返回用户资料
   * @returns 已登录返回 profile；未登录或会话失效返回 null
   */
  fetchLoginStatus: () => Promise<PlatformUserProfile | null>;

  /** 续期会话（cookie / token） */
  refreshLogin: () => Promise<void>;

  /** 登出：通知服务端失效 + 清本地凭证 */
  logout: () => Promise<void>;
}

/**
 * 平台账号注册表
 *
 * 用法：
 * ```ts
 * import { getLoginAdapter } from "@/apis/accounts";
 * const adapter = getLoginAdapter("netease");
 * if (!adapter) throw new Error("该平台暂不支持登录");
 * const { qrContent } = await adapter.startQrLogin();
 * ```
 */
export interface PlatformAccountApi {
  /** 列出所有已注册支持登录的平台 */
  listSupportedPlatforms: () => Promise<AccountPlatform[]>;
  /** 获取指定平台的登录适配器；未注册返回 undefined */
  getLoginAdapter: (platform: AccountPlatform) => Promise<PlatformLoginAdapter | undefined>;
  /** 当前某平台是否已登录 */
  isLoggedIn: (platform: AccountPlatform) => Promise<boolean>;
  /** 登出指定平台 */
  logout: (platform: AccountPlatform) => Promise<void>;
}

/** 多平台账号 API（渲染端通过 window.api.accounts 调用） */
export interface AccountsApi {
  /** 列出已接入账号体系的平台 */
  listSupportedPlatforms: () => Promise<AccountPlatform[]>;
  /** 获取指定平台的登录适配器能力声明（支持的登录方式） */
  getCapabilities: (
    platform: AccountPlatform,
  ) => Promise<{ qr: boolean; accountPassword: boolean; phone: boolean } | undefined>;
  /** 指定平台是否已登录（基于本地凭证快速判定，不发网络请求） */
  isLoggedIn: (platform: AccountPlatform) => Promise<boolean>;
  /** 启动扫码登录：返回 key + 二维码内容 URL */
  startQrLogin: (
    platform: AccountPlatform,
  ) => Promise<{ key: string; qrContent: string }>;
  /** 轮询扫码状态 */
  pollQrStatus: (platform: AccountPlatform, key: string) => Promise<QrCheckResult>;
  /** 账号密码登录 */
  accountLogin: (
    platform: AccountPlatform,
    username: string,
    password: string,
  ) => Promise<PlatformUserProfile>;
  /** 发送短信验证码 */
  sendSms: (platform: AccountPlatform, phone: string, ctcode?: string) => Promise<void>;
  /** 手机号 + 短信验证码登录 */
  phoneLogin: (
    platform: AccountPlatform,
    phone: string,
    captcha: string,
    ctcode?: string,
  ) => Promise<PlatformUserProfile>;
  /** 校验当前会话并取用户资料 */
  fetchLoginStatus: (
    platform: AccountPlatform,
  ) => Promise<PlatformUserProfile | null>;
  /** 续期会话 */
  refreshLogin: (platform: AccountPlatform) => Promise<void>;
  /** 登出指定平台 */
  logout: (platform: AccountPlatform) => Promise<void>;
}
