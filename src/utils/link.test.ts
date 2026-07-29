/**
 * 音乐分享链接解析单元测试
 *
 * 测试目标：parseShareLink。
 * 支持网易云 / QQ音乐 / 酷狗 / Bilibili 等主流平台，
 * 自动从用户输入（可能含多行）中提取首个匹配的链接。
 *
 * 各平台 URL 形态：
 * - 网易云 PC：https://music.163.com/#/song?id=123456
 * - 网易云移动：https://music.163.com/song/123456/?userid=xxx
 * - QQ音乐 PC：https://y.qq.com/n/ryqq/songDetail/001qvvgF38HVc4
 * - QQ音乐移动：https://i.y.qq.com/v8/playsong.html?songmid=xxx
 * - 酷狗：https://www.kugou.com/song/#hash=xxx
 * - Bilibili：https://www.bilibili.com/video/BV1xx411c7mD
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseShareLink, parseMusicLink } from "./link";

describe("parseShareLink - 网易云", () => {
  it("PC 端 /#/song?id= 形态被解析为 song + netease", () => {
    const result = parseShareLink("https://music.163.com/song?id=123456");
    assert.deepEqual(result, { type: "song", id: "123456", source: "netease" });
  });

  it("PC 端带 #/ 前缀 /#/song?id= 形态被解析", () => {
    const result = parseShareLink("https://music.163.com/#/song?id=123456");
    assert.deepEqual(result, { type: "song", id: "123456", source: "netease" });
  });

  it("移动端 /song/123456/?userid= 形态被解析", () => {
    const result = parseShareLink("https://music.163.com/song/123456/?userid=xxx");
    assert.deepEqual(result, { type: "song", id: "123456", source: "netease" });
  });

  it("album 类型被正确识别", () => {
    const result = parseShareLink("https://music.163.com/#/album?id=456");
    assert.deepEqual(result, { type: "album", id: "456", source: "netease" });
  });

  it("artist 类型被正确识别", () => {
    const result = parseShareLink("https://music.163.com/#/artist?id=789");
    assert.deepEqual(result, { type: "artist", id: "789", source: "netease" });
  });

  it("playlist 类型被正确识别", () => {
    const result = parseShareLink("https://music.163.com/#/playlist?id=321");
    assert.deepEqual(result, { type: "playlist", id: "321", source: "netease" });
  });

  it("URL 带额外查询参数时仍能提取 id", () => {
    const result = parseShareLink("https://music.163.com/song?id=123456&foo=bar");
    assert.deepEqual(result, { type: "song", id: "123456", source: "netease" });
  });
});

describe("parseShareLink - QQ音乐", () => {
  it("移动端 i.y.qq.com playsong.html?songmid=xxx 被解析", () => {
    const result = parseShareLink("https://i.y.qq.com/v8/playsong.html?songmid=xxx");
    assert.deepEqual(result, { type: "song", id: "xxx", source: "qqmusic" });
  });

  it("PC 端 y.qq.com/n/ryqq/songDetail/<mid> 被解析", () => {
    const result = parseShareLink("https://y.qq.com/n/ryqq/songDetail/001qvvgF38HVc4");
    assert.deepEqual(result, {
      type: "song",
      id: "001qvvgF38HVc4",
      source: "qqmusic",
    });
  });

  it("PC 端 albumDetail 被识别为 album 类型", () => {
    const result = parseShareLink("https://y.qq.com/n/ryqq/albumDetail/abc123");
    assert.deepEqual(result, {
      type: "album",
      id: "abc123",
      source: "qqmusic",
    });
  });

  it("PC 端 singerDetail 被识别为 artist 类型", () => {
    const result = parseShareLink("https://y.qq.com/n/ryqq/singerDetail/xyz");
    assert.deepEqual(result, {
      type: "artist",
      id: "xyz",
      source: "qqmusic",
    });
  });

  it("PC 端 playsquare 被识别为 playlist 类型", () => {
    const result = parseShareLink("https://y.qq.com/n/ryqq/playsquare/plid123");
    assert.deepEqual(result, {
      type: "playlist",
      id: "plid123",
      source: "qqmusic",
    });
  });

  it("songmid 含额外参数时仍能提取", () => {
    const result = parseShareLink("https://i.y.qq.com/v8/playsong.html?songmid=mid123&other=val");
    assert.deepEqual(result, {
      type: "song",
      id: "mid123",
      source: "qqmusic",
    });
  });
});

describe("parseShareLink - 酷狗", () => {
  it("song/?hash=xxx 被解析为 song（hash 须在 query 中）", () => {
    // 注意：pattern 要求 [?&]hash=，#hash=（fragment）不匹配
    const result = parseShareLink("https://www.kugou.com/song/?hash=abc123");
    assert.deepEqual(result, {
      type: "song",
      id: "abc123",
      source: "kugou",
    });
  });

  it("song/?foo=bar&hash=xxx 也能提取 hash", () => {
    const result = parseShareLink("https://www.kugou.com/song/?foo=bar&hash=abc456");
    assert.deepEqual(result, {
      type: "song",
      id: "abc456",
      source: "kugou",
    });
  });

  it("album/id/xxx 被解析为 album", () => {
    const result = parseShareLink("https://www.kugou.com/album/id/album456");
    assert.deepEqual(result, {
      type: "album",
      id: "album456",
      source: "kugou",
    });
  });

  it("singer/id/xxx 被解析为 artist", () => {
    const result = parseShareLink("https://www.kugou.com/singer/id/singer789");
    assert.deepEqual(result, {
      type: "artist",
      id: "singer789",
      source: "kugou",
    });
  });

  it("special/single/xxx 被解析为 playlist", () => {
    const result = parseShareLink("https://www.kugou.com/special/single/plid321");
    assert.deepEqual(result, {
      type: "playlist",
      id: "plid321",
      source: "kugou",
    });
  });
});

describe("parseShareLink - Bilibili", () => {
  it("bilibili.com/video/BVxxx 被解析为 song（B站视频统一为可播放单元）", () => {
    const result = parseShareLink("https://www.bilibili.com/video/BV1xx411c7mD");
    assert.deepEqual(result, {
      type: "song",
      id: "BV1xx411c7mD",
      source: "bilibili",
    });
  });

  it("b23.tv 短链被解析", () => {
    const result = parseShareLink("https://b23.tv/abc123");
    assert.deepEqual(result, {
      type: "song",
      id: "abc123",
      source: "bilibili",
    });
  });
});

describe("parseShareLink - 无效输入", () => {
  it("空字符串返回 null", () => {
    assert.equal(parseShareLink(""), null);
  });

  it("纯空白字符串返回 null", () => {
    assert.equal(parseShareLink("   "), null);
  });

  it("非音乐平台链接返回 null", () => {
    assert.equal(parseShareLink("https://example.com/foo"), null);
    assert.equal(parseShareLink("https://www.google.com/search?q=music"), null);
  });

  it("不含路径的网易云域名返回 null", () => {
    assert.equal(parseShareLink("https://music.163.com/"), null);
  });

  it("随机文本返回 null", () => {
    assert.equal(parseShareLink("hello world"), null);
    assert.equal(parseShareLink("这是一段普通文本"), null);
  });
});

describe("parseShareLink - 多行输入", () => {
  it("从多行文本中提取首个匹配的链接", () => {
    const input = `分享歌曲：
https://music.163.com/song?id=123456
另一个链接 https://y.qq.com/n/ryqq/songDetail/abc`;
    const result = parseShareLink(input);
    assert.deepEqual(result, { type: "song", id: "123456", source: "netease" });
  });

  it("文本中嵌入 BV 号也能被提取", () => {
    const input = "看看这个视频 https://www.bilibili.com/video/BV1xx411c7mD 很有趣";
    const result = parseShareLink(input);
    assert.deepEqual(result, {
      type: "song",
      id: "BV1xx411c7mD",
      source: "bilibili",
    });
  });
});

describe("parseMusicLink（兼容别名）", () => {
  it("parseMusicLink 与 parseShareLink 行为完全一致", () => {
    const url = "https://music.163.com/song?id=123456";
    assert.deepEqual(parseMusicLink(url), parseShareLink(url));
  });

  it("parseMusicLink 同样返回 null 给无效输入", () => {
    assert.equal(parseMusicLink("https://example.com/foo"), null);
  });
});
