/**
 * 用户登录相关类型
 */

/** 用户基础资料 */
export interface UserProfile {
  userId: number;
  nickname: string;
  avatarUrl?: string;
  backgroundUrl?: string;
  signature?: string;
  /** 0=普通，非 0=黑胶 VIP */
  vipType?: number;
  gender?: number;
  province?: number;
  city?: number;
}

/** 用户订阅计数（/user/subcount） */
export interface UserSubcount {
  /** 自建歌单数 */
  createdPlaylistCount: number;
  /** 收藏歌单数 */
  subPlaylistCount: number;
  /** 收藏歌手数 */
  artistCount: number;
}

/** QQ 音乐用户歌单条目 */
export interface QqPlaylist {
  /** 歌单 disstid */
  id: string;
  /** 歌单名 */
  name: string;
  /** 封面 URL */
  cover?: string;
  /** 曲目数 */
  trackCount?: number;
  /** 创建者昵称 */
  owner?: string;
}

/** 酷狗用户歌单条目 */
export interface KugouPlaylist {
  /** 歌单 specialid */
  id: string;
  /** 歌单名 */
  name: string;
  /** 封面 URL */
  cover?: string;
  /** 曲目数 */
  trackCount?: number;
  /** 创建者昵称 */
  owner?: string;
}
