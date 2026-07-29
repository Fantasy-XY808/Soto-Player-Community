/**
 * 评论数据归一化单元测试
 *
 * 参考 mealx fork 的 commentData.test.ts 风格，使用 node:test + node:assert/strict。
 * 测试目标：normalizeNeteaseComment（字段映射、空值处理、时间戳透传）+ buildCommentSources。
 *
 * 注意：Soto_Player 的 data.ts 与 mealx fork 的实现签名不同——
 * - Soto_Player 逐条归一化（normalizeNeteaseComment），返回 MusicCommentItem；
 * - mealx fork 一次性归一化整页（normalizeNeteaseCommentPage）。
 * 测试用例按 Soto_Player 实际实现编写。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildCommentSources,
  normalizeNeteaseComment,
  type NeteaseRawComment,
} from "./data";
import type { PluginInfo } from "../../../../shared/types/plugin";

describe("normalizeNeteaseComment", () => {
  it("将网易云原始评论字段映射为统一 MusicCommentItem", () => {
    const raw: NeteaseRawComment = {
      commentId: 101,
      content: "hot text",
      time: 1710000000000,
      likedCount: 9,
      liked: true,
      user: {
        userId: 1,
        nickname: "Hot User",
        avatarUrl: "https://example.com/avatar.jpg",
      },
      beReplied: [
        {
          beRepliedCommentId: 99,
          content: "reply text",
          user: { userId: 2, nickname: "Reply User", avatarUrl: "https://example.com/r.jpg" },
        },
      ],
    };

    const item = normalizeNeteaseComment(raw);

    assert.equal(item.id, "101");
    assert.equal(item.content, "hot text");
    assert.equal(item.timestamp, 1710000000000);
    assert.equal(item.userName, "Hot User");
    assert.equal(item.userAvatar, "https://example.com/avatar.jpg");
    assert.equal(item.likedCount, 9);
    assert.equal(item.liked, true);
  });

  it("commentId（number）被转为字符串 id，便于跨源对齐", () => {
    const item = normalizeNeteaseComment({ commentId: 202, content: "x" });
    assert.equal(item.id, "202");
    assert.equal(typeof item.id, "string");
  });

  it("时间戳 time 缺失时回退为 0", () => {
    const item = normalizeNeteaseComment({ commentId: 1, content: "x" });
    assert.equal(item.timestamp, 0);
  });

  it("likedCount 缺失时回退为 0，liked 缺失时回退为 false", () => {
    const item = normalizeNeteaseComment({ commentId: 1, content: "x" });
    assert.equal(item.likedCount, 0);
    assert.equal(item.liked, false);
  });

  it("user 缺失时 userName 为空字符串、userAvatar 为 undefined", () => {
    const item = normalizeNeteaseComment({ commentId: 1, content: "x" });
    assert.equal(item.userName, "");
    assert.equal(item.userAvatar, undefined);
  });

  it("userId 为 0 时仍被转为字符串 '0'（!= null 判定）", () => {
    const item = normalizeNeteaseComment({
      commentId: 1,
      content: "x",
      user: { userId: 0, nickname: "Zero" },
    });
    assert.equal(item.userName, "Zero");
  });

  it("beReplied 列表被映射为统一的 beReplied 数组", () => {
    const item = normalizeNeteaseComment({
      commentId: 1,
      content: "x",
      beReplied: [
        {
          beRepliedCommentId: 99,
          content: "reply text",
          user: { userId: 2, nickname: "Reply User", avatarUrl: "" },
        },
      ],
    });

    assert.deepEqual(item.beReplied, [
      {
        id: "99",
        userName: "Reply User",
        content: "reply text",
        userId: "2",
        userAvatar: "",
      },
    ]);
  });

  it("首条 beReplied 同时写入兼容字段 parent", () => {
    const item = normalizeNeteaseComment({
      commentId: 1,
      content: "x",
      beReplied: [
        {
          beRepliedCommentId: 99,
          content: "reply text",
          user: { userId: 2, nickname: "Reply User" },
        },
      ],
    });

    assert.deepEqual(item.parent, {
      id: "99",
      content: "reply text",
      userName: "Reply User",
    });
  });

  it("beReplied 为空数组时 parent 与 beReplied 均为 undefined", () => {
    const item = normalizeNeteaseComment({ commentId: 1, content: "x", beReplied: [] });
    assert.equal(item.parent, undefined);
    assert.equal(item.beReplied, undefined);
  });

  it("beReplied 中 content 缺失时回退为空字符串", () => {
    const item = normalizeNeteaseComment({
      commentId: 1,
      content: "x",
      beReplied: [{ beRepliedCommentId: 99, user: { userId: 2, nickname: "U" } }],
    });
    assert.equal(item.beReplied?.[0].content, "");
  });

  it("raw 为 undefined 时返回全默认值的 MusicCommentItem", () => {
    const item = normalizeNeteaseComment(undefined);
    assert.equal(item.id, "");
    assert.equal(item.content, "");
    assert.equal(item.timestamp, 0);
    assert.equal(item.userName, "");
    assert.equal(item.userAvatar, undefined);
    assert.equal(item.likedCount, 0);
    assert.equal(item.liked, false);
    assert.equal(item.parent, undefined);
    assert.equal(item.beReplied, undefined);
  });

  it("beReplied 非数组时被安全忽略（不抛错）", () => {
    const item = normalizeNeteaseComment({
      commentId: 1,
      content: "x",
      // 模拟服务端返回了非预期类型
      ...(null as unknown as { beReplied: unknown[] }),
    });
    assert.equal(item.parent, undefined);
    assert.equal(item.beReplied, undefined);
  });
});

describe("buildCommentSources", () => {
  it("始终包含内置网易云源（hot + new 两个 tab）", () => {
    const sources = buildCommentSources([]);
    assert.equal(sources.length, 1);
    assert.deepEqual(sources[0], {
      id: "netease",
      kind: "builtin",
      label: "网易云音乐",
      tabs: ["hot", "new"],
    });
  });

  it("声明 getMusicComments 能力的 ready 插件被加入源列表", () => {
    const plugins: PluginInfo[] = [
      {
        manifest: { id: "plugin-a", name: "Plugin A", version: "1.0.0", platform: "musicfree", type: "source", apiLevel: 1, hash: "h", installedAt: 0, fileName: "a.js" },
        enabled: true,
        status: {
          state: "ready",
          sources: {
            tx: { name: "QQ", actions: ["musicUrl", "getMusicComments"] },
            bad: { name: "No Comment", actions: ["musicUrl"] },
          },
        },
      },
    ];

    const sources = buildCommentSources(plugins);
    assert.equal(sources.length, 2);
    assert.deepEqual(
      sources.map((s) => ({ id: s.id, kind: s.kind, label: s.label, tabs: s.tabs })),
      [
        { id: "netease", kind: "builtin", label: "网易云音乐", tabs: ["hot", "new"] },
        { id: "plugin-a:tx", kind: "plugin", label: "QQ", tabs: ["hot", "new"] },
      ],
    );
  });

  it("enabled=false 的插件被跳过", () => {
    const plugins: PluginInfo[] = [
      {
        manifest: { id: "plugin-b", name: "Plugin B", version: "1.0.0", platform: "musicfree", type: "source", apiLevel: 1, hash: "h", installedAt: 0, fileName: "b.js" },
        enabled: false,
        status: {
          state: "ready",
          sources: {
            kg: { name: "KG", actions: ["getMusicComments"] },
          },
        },
      },
    ];

    const sources = buildCommentSources(plugins);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].id, "netease");
  });

  it("status.state 非 ready 的插件被跳过", () => {
    const plugins: PluginInfo[] = [
      {
        manifest: { id: "plugin-c", name: "Plugin C", version: "1.0.0", platform: "musicfree", type: "source", apiLevel: 1, hash: "h", installedAt: 0, fileName: "c.js" },
        enabled: true,
        status: { state: "loading" },
      },
      {
        manifest: { id: "plugin-d", name: "Plugin D", version: "1.0.0", platform: "musicfree", type: "source", apiLevel: 1, hash: "h", installedAt: 0, fileName: "d.js" },
        enabled: true,
        status: { state: "unloaded" },
      },
      {
        manifest: { id: "plugin-e", name: "Plugin E", version: "1.0.0", platform: "musicfree", type: "source", apiLevel: 1, hash: "h", installedAt: 0, fileName: "e.js" },
        enabled: true,
        status: { state: "error", error: { code: "X", message: "fail" } },
      },
    ];

    const sources = buildCommentSources(plugins);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].id, "netease");
  });

  it("插件 source 缺省 cap.name 时回退到 manifest.name 作为 label", () => {
    const plugins: PluginInfo[] = [
      {
        manifest: { id: "plugin-f", name: "Fallback Name", version: "1.0.0", platform: "musicfree", type: "source", apiLevel: 1, hash: "h", installedAt: 0, fileName: "f.js" },
        enabled: true,
        status: {
          state: "ready",
          sources: {
            src1: { name: "", actions: ["getMusicComments"] },
          },
        },
      },
    ];

    const sources = buildCommentSources(plugins);
    assert.equal(sources.length, 2);
    assert.equal(sources[1].label, "Fallback Name");
  });
});
