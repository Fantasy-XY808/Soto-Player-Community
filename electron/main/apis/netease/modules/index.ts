/**
 * Netease API 模块注册表
 *
 * 每新增一个 module，在这里用一行 import + export 接入即可。
 * 运行时通过 `callNetease(name, params)` 按 key 路由。
 */

import type { NeteaseModule } from "../core/types";

// 登录 / 会话
import captcha_sent from "./captcha_sent";
import captcha_verify from "./captcha_verify";
import login from "./login";
import login_cellphone from "./login_cellphone";
import login_qr_check from "./login_qr_check";
import login_qr_create from "./login_qr_create";
import login_qr_key from "./login_qr_key";
import login_refresh from "./login_refresh";
import login_status from "./login_status";
import logout from "./logout";
import register_anonimous from "./register_anonimous";

// 用户
import user_account from "./user_account";
import user_cloud from "./user_cloud";
import user_cloud_del from "./user_cloud_del";
import cloud_upload_check from "./cloud_upload_check";
import cloud_nos_token from "./cloud_nos_token";
import cloud_upload_info from "./cloud_upload_info";
import cloud_pub from "./cloud_pub";
import cloud_upload_check_v2 from "./cloud_upload_check_v2";
import cloud_song_import from "./cloud_song_import";
import user_detail from "./user_detail";
import user_detail_new from "./user_detail_new";
import user_followeds from "./user_followeds";
import user_follows from "./user_follows";
import user_level from "./user_level";
import user_playlist from "./user_playlist";
import user_record from "./user_record";
import user_subcount from "./user_subcount";

// 搜索
import cloudsearch from "./cloudsearch";
import search from "./search";
import search_default from "./search_default";
import search_hot from "./search_hot";
import search_hot_detail from "./search_hot_detail";
import search_match from "./search_match";
import search_multimatch from "./search_multimatch";
import search_suggest from "./search_suggest";
import search_suggest_pc from "./search_suggest_pc";

// 歌词
import lyric from "./lyric";
import lyric_new from "./lyric_new";
import cloud_lyric_get from "./cloud_lyric_get";

// 播放
import song_detail from "./song_detail";
import song_url from "./song_url";
import song_download_url from "./song_download_url";
import song_mv_dynamic from "./song_mv_dynamic";
import playmode_intelligence from "./playmode_intelligence";
import personal_fm from "./personal_fm";
import fm_trash from "./fm_trash";
import scrobble from "./scrobble";
import scrobble_v1 from "./scrobble_v1";

// 每日推荐 / 发现
import recommend_songs from "./recommend_songs";
import personalized from "./personalized";
import recommend_resource from "./recommend_resource";
import top_artists from "./top_artists";
import album_new from "./album_new";
import toplist from "./toplist";
import toplist_detail from "./toplist_detail";
import top_song from "./top_song";
import simi_song from "./simi_song";
import simi_artist from "./simi_artist";
import simi_playlist from "./simi_playlist";
import event from "./event";

// MV
import mv_first from "./mv_first";
import mv_detail from "./mv_detail";
import mv_url from "./mv_url";

// 视频
import video_detail from "./video_detail";
import video_url from "./video_url";
import video_category_list from "./video_category_list";
import video_group_list from "./video_group_list";

// 电台 / 播客
import dj_recommend from "./dj_recommend";
import dj_category_recommend from "./dj_category_recommend";
import dj_detail from "./dj_detail";
import dj_program from "./dj_program";
import dj_program_url from "./dj_program_url";

// 歌单 / 喜欢
import playlist_detail from "./playlist_detail";
import playlist_create from "./playlist_create";
import playlist_delete from "./playlist_delete";
import playlist_tracks from "./playlist_tracks";
import playlist_subscribe from "./playlist_subscribe";
import playlist_name_update from "./playlist_name_update";
import playlist_desc_update from "./playlist_desc_update";
import playlist_order_update from "./playlist_order_update";
import likelist from "./likelist";
import like from "./like";

// 专辑
import album from "./album";
import album_sub from "./album_sub";

// 歌手
import artists from "./artists";
import artist_album from "./artist_album";
import artist_songs from "./artist_songs";

// 用户收藏
import album_sublist from "./album_sublist";
import artist_sub from "./artist_sub";
import artist_sublist from "./artist_sublist";

// 评论
import comment_music from "./comment_music";
import comment_floor from "./comment_floor";
import comment_like from "./comment_like";
import comment_add from "./comment_add";
import comment_delete from "./comment_delete";

export const modules: Record<string, NeteaseModule> = {
  captcha_sent,
  captcha_verify,
  login,
  login_cellphone,
  login_qr_check,
  login_qr_create,
  login_qr_key,
  login_refresh,
  login_status,
  logout,
  register_anonimous,

  user_account,
  user_cloud,
  user_cloud_del,
  cloud_upload_check,
  cloud_nos_token,
  cloud_upload_info,
  cloud_pub,
  cloud_upload_check_v2,
  cloud_song_import,
  user_detail,
  user_detail_new,
  user_followeds,
  user_follows,
  user_level,
  user_playlist,
  user_record,
  user_subcount,

  cloudsearch,
  search,
  search_default,
  search_hot,
  search_hot_detail,
  search_match,
  search_multimatch,
  search_suggest,
  search_suggest_pc,

  lyric,
  lyric_new,
  cloud_lyric_get,

  song_detail,
  song_url,
  song_download_url,
  song_mv_dynamic,
  playmode_intelligence,
  personal_fm,
  fm_trash,
  scrobble,
  scrobble_v1,

  recommend_songs,
  personalized,
  recommend_resource,
  top_artists,
  album_new,
  toplist,
  toplist_detail,
  top_song,
  simi_song,
  simi_artist,
  simi_playlist,
  event,

  mv_first,
  mv_detail,
  mv_url,

  video_detail,
  video_url,
  video_category_list,
  video_group_list,

  dj_recommend,
  dj_category_recommend,
  dj_detail,
  dj_program,
  dj_program_url,

  playlist_detail,
  playlist_create,
  playlist_delete,
  playlist_tracks,
  playlist_subscribe,
  playlist_name_update,
  playlist_desc_update,
  playlist_order_update,
  likelist,
  like,

  album,
  album_sub,

  artists,
  artist_album,
  artist_songs,

  album_sublist,
  artist_sub,
  artist_sublist,

  comment_music,
  comment_floor,
  comment_like,
  comment_add,
  comment_delete,
};
