/**
 * 模糊匹配歌词
 * 组合 search + lyric：搜第一条命中后取其歌词
 *
 * params:
 * - keywords  搜索关键词，建议 "歌曲名-歌手名" 格式
 */

import searchModule from "./search";
import lyricModule from "./lyric";
import type { QMModule } from "../core/types";

interface SearchedSong {
  id: string;
  mid: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
}

interface LyricOut {
  code: number;
  lrc?: string;
  qrc?: string;
  trans?: string;
  roma?: string;
  message?: string;
}

const match: QMModule = async (params) => {
  const { keywords } = params;

  const searched = (await searchModule({ keywords, page: 1, limit: 1 })) as {
    songs?: SearchedSong[];
  };
  const song = searched.songs?.[0];
  if (!song) return { code: 404, message: "未找到匹配的歌曲" };

  const lyricData = (await lyricModule({
    id: Number(song.id),
    name: song.name,
    artist: song.artist,
    album: song.album,
    duration: Math.floor(song.duration / 1000),
  })) as LyricOut;

  if (lyricData.code !== 200) return lyricData;

  return {
    code: 200,
    song,
    lrc: lyricData.lrc,
    qrc: lyricData.qrc,
    trans: lyricData.trans,
    roma: lyricData.roma,
  };
};

export default match;
