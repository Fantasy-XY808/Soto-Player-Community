/** Last.fm 连接状态 */
export interface LastfmStatus {
  /** 是否已连接（存在 session key） */
  connected: boolean;
  /** 已连接的用户名 */
  username: string;
}

/** connect() 结果 */
export interface LastfmConnectResult {
  /** 是否连接成功 */
  connected: boolean;
  /** 成功时的用户名 */
  username?: string;
  /** 失败原因 */
  reason?: "timeout" | "canceled" | "error";
}

/** 渲染进程 Last.fm API（window.api.lastfm） */
export interface LastfmApi {
  /** 发起授权：打开浏览器并轮询会话，成功后持久化 */
  connect: () => Promise<LastfmConnectResult>;
  /** 取消正在进行的授权轮询 */
  cancelConnect: () => Promise<void>;
  /** 断开并清除本地凭证 */
  disconnect: () => Promise<void>;
  /** 查询当前连接状态 */
  getStatus: () => Promise<LastfmStatus>;
  /** 同步喜欢：loved=true 为 Love，false 为 Unlove */
  love: (artist: string, track: string, loved: boolean) => Promise<void>;
}
