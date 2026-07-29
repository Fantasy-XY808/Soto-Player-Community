/**
 * 评论系统 services 单元测试
 *
 * 验证：
 * 1. normalizeNeteaseComment 把网易云原始评论字段映射为 MusicCommentItem
 * 2. buildCommentSources 始终返回 builtin:netease 源
 * 3. buildCommentSources 把声明了 getMusicComments 能力的插件加入源列表
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PluginInfo } from "../../shared/types/plugin";
import type { MusicCommentItem } from "../../shared/types/comment";
import {
  normalizeNeteaseComment,
  buildCommentSources,
} from "../../electron/main/services/comments/data.js";

test("normalizeNeteaseComment 映射网易云评论字段", () => {
  const raw = {
    commentId: 123456,
    content: "好听 &amp;感人",
    time: 1700000000000,
    likedCount: 88,
    liked: true,
    user: { userId: 42, nickname: "乐迷", avatarUrl: "https://x/a.png" },
    beReplied: [
      { user: { userId: 1, nickname: "原作者" }, content: "thx" },
    ],
  };

  const item: MusicCommentItem = normalizeNeteaseComment(raw);

  assert.equal(item.id, "123456");
  assert.equal(item.content, "好听 &amp;感人");
  assert.equal(item.timestamp, 1700000000000);
  assert.equal(item.userName, "乐迷");
  assert.equal(item.userAvatar, "https://x/a.png");
  assert.equal(item.likedCount, 88);
  assert.equal(item.liked, true);
  assert.ok(item.parent, "应映射 beReplied[0] 为 parent");
  assert.equal(item.parent?.id, "");
  assert.equal(item.parent?.userName, "原作者");
  assert.equal(item.parent?.content, "thx");
  assert.ok(item.beReplied, "应映射 beReplied 数组");
  assert.equal(item.beReplied?.length, 1);
  assert.equal(item.beReplied?.[0]?.userName, "原作者");
  assert.equal(item.beReplied?.[0]?.content, "thx");
});

test("normalizeNeteaseComment 处理多条 beReplied", () => {
  const raw = {
    commentId: 789,
    content: "回复楼上两位",
    time: 1700000000001,
    user: { userId: 42, nickname: "乐迷" },
    beReplied: [
      { user: { userId: 1, nickname: "甲" }, content: "甲内容", beRepliedCommentId: 100 },
      { user: { userId: 2, nickname: "乙" }, content: "乙内容", beRepliedCommentId: 200 },
    ],
  };

  const item = normalizeNeteaseComment(raw);

  assert.ok(item.beReplied, "应映射 beReplied 数组");
  assert.equal(item.beReplied?.length, 2);
  assert.equal(item.beReplied?.[0]?.userName, "甲");
  assert.equal(item.beReplied?.[0]?.content, "甲内容");
  assert.equal(item.beReplied?.[0]?.id, "100");
  assert.equal(item.beReplied?.[1]?.userName, "乙");
  assert.equal(item.beReplied?.[1]?.content, "乙内容");
  assert.equal(item.beReplied?.[1]?.id, "200");
});

test("normalizeNeteaseComment 处理缺失字段", () => {
  const item = normalizeNeteaseComment({});
  assert.equal(item.id, "");
  assert.equal(item.content, "");
  assert.equal(item.timestamp, 0);
  assert.equal(item.userName, "");
  assert.equal(item.likedCount, 0);
  assert.equal(item.liked, false);
  assert.equal(item.parent, undefined);
  assert.equal(item.beReplied, undefined);
});

test("buildCommentSources 返回 builtin:netease", () => {
  const sources = buildCommentSources([]);
  const builtin = sources.find((s) => s.id === "netease" && s.kind === "builtin");
  assert.ok(builtin, "应包含 builtin:netease 源");
  assert.equal(builtin?.label.length > 0, true);
  assert.ok(builtin?.tabs.includes("hot"));
  assert.ok(builtin?.tabs.includes("new"));
});

test("buildCommentSources 包含声明了 getMusicComments 的插件源", () => {
  const plugins: PluginInfo[] = [
    {
      manifest: {
        id: "plugin-a",
        name: "Plugin A",
        version: "1.0.0",
        platform: "musicfree",
        type: "source",
        apiLevel: 1,
        hash: "",
        installedAt: 0,
        fileName: "a.js",
      },
      enabled: true,
      status: {
        state: "ready",
        sources: {
          "source-a": {
            name: "Source A",
            actions: ["getMusicComments"],
          },
        },
      },
    },
  ];

  const sources = buildCommentSources(plugins);
  const pluginSource = sources.find((s) => s.kind === "plugin" && s.id.includes("plugin-a"));
  assert.ok(pluginSource, "应包含 plugin-a 的源");
  assert.ok(pluginSource?.label.length > 0);
});

test("buildCommentSources 跳过未声明 getMusicComments 的插件", () => {
  const plugins: PluginInfo[] = [
    {
      manifest: {
        id: "plugin-b",
        name: "Plugin B",
        version: "1.0.0",
        platform: "musicfree",
        type: "source",
        apiLevel: 1,
        hash: "",
        installedAt: 0,
        fileName: "b.js",
      },
      enabled: true,
      status: {
        state: "ready",
        sources: {
          "source-b": { name: "Source B", actions: ["search"] },
        },
      },
    },
  ];

  const sources = buildCommentSources(plugins);
  const pluginSource = sources.find((s) => s.kind === "plugin");
  assert.equal(pluginSource, undefined, "未声明 getMusicComments 的插件不应被加入");
});
