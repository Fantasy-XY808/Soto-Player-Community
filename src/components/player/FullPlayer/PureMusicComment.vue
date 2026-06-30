<script setup lang="ts">
/**
 * 纯音乐热评展示
 *
 * 用户指定排版：
 * ```
 * "XXXXX
 *     ，XXXXXX"
 *          ——来自歌曲《XXXX》，XXX的评论
 * ```
 * 评论内容按第一个标点切两段，第二段缩进；字号/字重/字体复用 lyric-area 继承值
 *
 * comment 为 null 时根据 status 显示不同 fallback：
 * - loading：加载中
 * - failed：评论加载失败（风控/网络）
 * - unsupported：当前歌曲不支持评论（非网易云源）
 * - 其他：纯音乐，请欣赏
 */

import type { CommentLoadStatus } from "@/composables/useSongComments";
import type { SelectedComment } from "@/composables/useSongComments";

const props = defineProps<{
  /** 当前展示的热评；为 null 时显示 fallback 文案 */
  comment: SelectedComment | null;
  /** 评论加载状态，决定 fallback 文案 */
  status?: CommentLoadStatus;
  /** 失败时点击重试 */
  onRetry?: () => void;
}>();

const { t } = useI18n();

/** fallback 文案：根据加载状态显示不同提示 */
const fallbackText = computed(() => {
  switch (props.status) {
    case "loading":
      return t("comment.hotLoading");
    case "failed":
      return t("comment.hotLoadFailed");
    case "unsupported":
      return t("comment.unsupportedSource");
    default:
      return t("player.pureMusicFallback");
  }
});

/** 是否显示重试按钮：仅 failed 状态且提供了 onRetry 回调 */
const showRetry = computed(() => props.status === "failed" && typeof props.onRetry === "function");

/** 中英文标点正则，用于在首个标点处切分内容 */
const PUNCT_REGEX = /[，,。.！!？?；;、]/;

/** 把评论内容切成两段：[前段, 含标点的后段]；首字符即标点 / 无标点时第二段为空 */
const splitContent = (text: string): [string, string] => {
  const match = text.match(PUNCT_REGEX);
  if (!match || match.index === undefined || match.index === 0) return [text, ""];
  return [text.slice(0, match.index), text.slice(match.index)];
};

/** 前段（第一行内容） */
const firstPart = computed(() => (props.comment ? splitContent(props.comment.content)[0] : ""));
/** 后段（第二行内容，含起始标点） */
const secondPart = computed(() => (props.comment ? splitContent(props.comment.content)[1] : ""));
/** 是否有第二段（决定排版） */
const hasSecondPart = computed(() => secondPart.value.length > 0);
</script>

<template>
  <div class="pure-music-comment w-full h-full flex items-center justify-center">
    <Transition v-if="comment" name="scale-switch" mode="out-in">
      <div :key="comment.commentId" class="comment-block">
        <p class="comment-text">
          <span class="quote-open">"</span>
          {{ firstPart }}
          <br v-if="hasSecondPart" />
          <span v-if="hasSecondPart" class="second-line">{{ secondPart }}</span>
          <span class="quote-close">"</span>
        </p>
        <p class="comment-source">
          ——来自歌曲《{{ comment.songTitle }}》，{{ comment.nickname }}的评论
        </p>
      </div>
    </Transition>
    <div v-else class="fallback-block">
      <p class="fallback-text">{{ fallbackText }}</p>
      <button v-if="showRetry" class="retry-btn" type="button" @click="props.onRetry?.()">
        {{ t("comment.retry") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pure-music-comment {
  color: var(--lp-color, currentColor);
}

.comment-block {
  max-width: 80%;
  text-align: left;
}

.comment-text {
  margin: 0;
  line-height: 1.5;
  letter-spacing: 0.02em;
}

.second-line {
  padding-left: 1.5em;
}

.comment-source {
  margin: 1.5em 0 0;
  padding-left: 3em;
  font-size: 0.55em;
  opacity: 0.6;
  line-height: 1.5;
}

.fallback-block {
  text-align: center;
}

.fallback-text {
  margin: 0;
  font-size: 0.7em;
  opacity: 0.45;
  letter-spacing: 0.08em;
}

.retry-btn {
  margin-top: 1.2em;
  padding: 0.4em 1.2em;
  font-size: 0.55em;
  letter-spacing: 0.05em;
  color: var(--lp-color, currentColor);
  opacity: 0.6;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 999px;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.retry-btn:hover {
  opacity: 1;
}
</style>
