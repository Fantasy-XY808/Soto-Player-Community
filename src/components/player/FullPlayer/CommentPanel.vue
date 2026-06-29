<script setup lang="ts">
/**
 * 歌曲评论面板
 *
 * 顶部热评 + 底部最新评论分页；底部输入框 + 发送按钮
 * 错误码：405 验证码 / 250 敏感词 / 404 无权限
 * 关闭时由父组件 v-if 卸载，无需轮询 / RAF
 */

import type { NeteaseComment } from "@/apis/comment/netease";
import {
  fetchSongComments,
  sendSongComment,
  toggleCommentLike,
  NeteaseCommentAddError,
} from "@/apis/comment/netease";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  /** 当前歌曲 id（网易云） */
  songId: string | undefined;
  /** 当前歌曲标题 */
  songTitle: string | undefined;
}>();

defineEmits<{ close: [] }>();

const { t } = useI18n();
const user = useUserStore();

/** 热评列表 */
const hotComments = shallowRef<NeteaseComment[]>([]);
/** 最新评论列表 */
const latestComments = shallowRef<NeteaseComment[]>([]);
/** 总评论数 */
const total = ref(0);
/** 最新评论是否还有更多 */
const hasMore = ref(false);
/** 是否在加载（首屏） */
const loading = ref(false);
/** 是否在加载更多 */
const loadingMore = ref(false);
/** 是否在发送 */
const sending = ref(false);
/** 输入框内容 */
const inputContent = ref("");

/** 拉取中的 songId，防止切歌竞态覆盖 */
let loadingSongId = "";

/** 每页拉取数量 */
const PAGE_LIMIT = 20;

/** 从 `netease <code>: ...` 风格的错误信息中提取业务码 */
const parseNeteaseCode = (err: unknown): number => {
  if (err instanceof Error) {
    const m = err.message.match(/^netease\s+(-?\d+)/);
    if (m) return Number(m[1]);
  }
  return 0;
};

/** 评论加载失败的精细化提示：区分未登录 / 风控 / 网络 */
const commentLoadErrorMessage = (err: unknown): string => {
  const code = parseNeteaseCode(err);
  if (code === 301 || code === -100) return t("comment.loadingFailedAuth");
  if (code === -460 || code === 512 || code === 508) return t("comment.loadingFailedRisk");
  if (code === 502) return t("comment.loadingFailedNetwork");
  return t("comment.loadingFailed");
};

/** 首屏拉取热评 + 第一页最新评论 */
const loadFirst = async (songId: string): Promise<void> => {
  loading.value = true;
  try {
    const resp = await fetchSongComments(songId, { limit: PAGE_LIMIT, offset: 0 });
    if (loadingSongId !== songId) return;
    hotComments.value = resp.hotComments;
    latestComments.value = resp.comments;
    total.value = resp.total;
    hasMore.value = resp.hasMore;
  } catch (err) {
    console.warn("[CommentPanel] load first failed:", err);
    toast.error(commentLoadErrorMessage(err));
  } finally {
    loading.value = false;
  }
};

/** 加载更多最新评论 */
const loadMore = async (): Promise<void> => {
  if (!props.songId || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const last = latestComments.value[latestComments.value.length - 1];
    const resp = await fetchSongComments(props.songId, {
      limit: PAGE_LIMIT,
      offset: latestComments.value.length,
      before: last?.time,
    });
    latestComments.value = [...latestComments.value, ...resp.comments];
    hasMore.value = resp.hasMore;
  } catch (err) {
    console.warn("[CommentPanel] load more failed:", err);
    toast.error(commentLoadErrorMessage(err));
  } finally {
    loadingMore.value = false;
  }
};

/** 切歌时重新拉取 */
watch(
  () => props.songId,
  (id) => {
    if (!id) {
      hotComments.value = [];
      latestComments.value = [];
      total.value = 0;
      hasMore.value = false;
      return;
    }
    loadingSongId = id;
    void loadFirst(id);
  },
  { immediate: true },
);

/**
 * 点赞 / 取消点赞（乐观更新，失败回滚）
 * @param comment 评论对象
 */
const onLike = async (comment: NeteaseComment): Promise<void> => {
  if (!props.songId) return;
  // 评论点赞需要登录态（MUSIC_U），未登录时 weapi 会被服务端 301 拒绝
  if (!user.isLoggedIn) {
    toast.warning(t("comment.needLogin"));
    return;
  }
  const wasLiked = comment.liked;
  const wasCount = comment.likedCount;
  // 乐观更新
  comment.liked = !wasLiked;
  comment.likedCount = wasCount + (wasLiked ? -1 : 1);
  try {
    await toggleCommentLike(props.songId, comment.commentId, !wasLiked);
  } catch (err) {
    // 回滚
    comment.liked = wasLiked;
    comment.likedCount = wasCount;
    console.warn("[CommentPanel] like failed:", err);
    toast.error(t("comment.likeFailed"));
  }
};

/**
 * 发送评论
 * - 未登录 → toast 提示
 * - 空内容 → toast 提示
 * - 业务码 405 / 250 / 404 → 针对性提示
 */
const onSend = async (): Promise<void> => {
  if (!props.songId) return;
  if (!user.isLoggedIn) {
    toast.warning(t("comment.needLogin"));
    return;
  }
  const content = inputContent.value.trim();
  if (!content) {
    toast.warning(t("comment.emptyContent"));
    return;
  }
  sending.value = true;
  try {
    await sendSongComment(props.songId, content);
    inputContent.value = "";
    toast.success(t("comment.sent"));
    // 发送成功后重新拉首屏，让新评论出现
    await loadFirst(props.songId);
  } catch (err) {
    if (err instanceof NeteaseCommentAddError) {
      if (err.code === 405) toast.error(t("comment.err405"));
      else if (err.code === 250) toast.error(t("comment.err250"));
      else if (err.code === 404) toast.error(t("comment.err404"));
      else toast.error(t("comment.errFailed"));
    } else {
      console.warn("[CommentPanel] send failed:", err);
      toast.error(t("comment.errFailed"));
    }
  } finally {
    sending.value = false;
  }
};

/** 把毫秒时间戳格式化为相对时间 / YYYY-MM-DD */
const formatTime = (ms: number): string => {
  if (!ms) return "";
  const now = Date.now();
  const diff = now - ms;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
</script>

<template>
  <div class="flex flex-col h-full text-cover">
    <!-- 头部 -->
    <div class="shrink-0 flex items-start justify-between gap-4 pl-1 pr-20 pb-4">
      <div class="flex flex-col min-w-0 pl-2.5">
        <h2 class="m-0 text-2xl font-semibold leading-tight truncate">
          {{ t("comment.title") }}
        </h2>
        <span class="text-sm text-cover/55 mt-1">
          {{ t("comment.totalCount", { count: total }) }}
        </span>
      </div>
      <div class="shrink-0 flex items-center gap-3">
        <SButton type="cover" variant="secondary" round :size="40" @click="$emit('close')">
          <template #icon><IconLucideX /></template>
        </SButton>
      </div>
    </div>
    <!-- 列表 -->
    <div v-if="loading" class="flex-1 flex items-center justify-center text-cover/40">
      <IconLucideLoader2 class="size-6 animate-spin" />
    </div>
    <div
      v-else-if="hotComments.length === 0 && latestComments.length === 0"
      class="flex-1 flex items-center justify-center text-cover/35"
    >
      <div class="text-center">
        <IconLucideMessageCircle class="size-10 mx-auto mb-2 opacity-40" />
        <div class="text-sm">{{ t("comment.empty") }}</div>
      </div>
    </div>
    <div
      v-else
      class="flex-1 min-h-0 overflow-y-auto pr-2"
      :style="{
        maskImage:
          'linear-gradient(180deg, transparent 0px, #000 16px, #000 calc(100% - 16px), transparent 100%)',
      }"
    >
      <!-- 热评 -->
      <section v-if="hotComments.length > 0" class="mb-4">
        <h3
          class="text-sm font-medium text-cover/70 m-0 mb-2 sticky top-0 bg-surface/80 backdrop-blur-sm py-1"
        >
          {{ t("comment.hot") }}
        </h3>
        <article
          v-for="c in hotComments"
          :key="`h-${c.commentId}`"
          class="flex gap-3 p-2 rounded-lg hover:bg-cover/5 transition-colors"
        >
          <SImg :src="c.user.avatarUrl" class="size-9 rounded-full shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-xs text-cover/60 truncate">{{ c.user.nickname }}</div>
            <p class="text-sm leading-relaxed m-0 mt-1 whitespace-pre-wrap break-words">
              {{ c.content }}
            </p>
            <div
              v-if="c.beReplied && c.beReplied.length > 0"
              class="mt-1 text-xs text-cover/55 bg-cover/8 rounded px-2 py-1"
            >
              <span v-for="(r, i) in c.beReplied" :key="i">
                @{{ r.user.nickname }}：{{ r.content }}
              </span>
            </div>
            <div class="flex items-center justify-between mt-1.5">
              <span class="text-xs text-cover/40">{{ formatTime(c.time) }}</span>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors"
                :class="c.liked ? 'text-cover' : 'text-cover/50 hover:text-cover/80'"
                @click="onLike(c)"
              >
                <IconLucideThumbsUp v-if="!c.liked" class="size-3.5" />
                <IconLucideThumbsUp v-else class="size-3.5 fill-current" />
                <span class="tabular-nums">{{ c.likedCount }}</span>
              </button>
            </div>
          </div>
        </article>
      </section>
      <!-- 最新评论 -->
      <section v-if="latestComments.length > 0">
        <h3
          class="text-sm font-medium text-cover/70 m-0 mb-2 sticky top-0 bg-surface/80 backdrop-blur-sm py-1"
        >
          {{ t("comment.latest") }}
        </h3>
        <article
          v-for="c in latestComments"
          :key="`l-${c.commentId}`"
          class="flex gap-3 p-2 rounded-lg hover:bg-cover/5 transition-colors"
        >
          <SImg :src="c.user.avatarUrl" class="size-9 rounded-full shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-xs text-cover/60 truncate">{{ c.user.nickname }}</div>
            <p class="text-sm leading-relaxed m-0 mt-1 whitespace-pre-wrap break-words">
              {{ c.content }}
            </p>
            <div
              v-if="c.beReplied && c.beReplied.length > 0"
              class="mt-1 text-xs text-cover/55 bg-cover/8 rounded px-2 py-1"
            >
              <span v-for="(r, i) in c.beReplied" :key="i">
                @{{ r.user.nickname }}：{{ r.content }}
              </span>
            </div>
            <div class="flex items-center justify-between mt-1.5">
              <span class="text-xs text-cover/40">{{ formatTime(c.time) }}</span>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors"
                :class="c.liked ? 'text-cover' : 'text-cover/50 hover:text-cover/80'"
                @click="onLike(c)"
              >
                <IconLucideThumbsUp v-if="!c.liked" class="size-3.5" />
                <IconLucideThumbsUp v-else class="size-3.5 fill-current" />
                <span class="tabular-nums">{{ c.likedCount }}</span>
              </button>
            </div>
          </div>
        </article>
        <!-- 加载更多 -->
        <div class="flex justify-center py-4">
          <SButton
            v-if="hasMore"
            type="cover"
            variant="ghost"
            size="small"
            :loading="loadingMore"
            @click="loadMore"
          >
            {{ t("comment.loadMore") }}
          </SButton>
          <span v-else class="text-xs text-cover/40">{{ t("comment.noMore") }}</span>
        </div>
      </section>
    </div>
    <!-- 底部输入 -->
    <div class="shrink-0 flex items-end gap-2 pt-3 pr-20">
      <SInput
        v-model="inputContent"
        type="textarea"
        :placeholder="t('comment.inputPlaceholder')"
        :rows="2"
        :disabled="sending"
        cover
        class="flex-1"
        @keydown.enter.exact.prevent="onSend"
      />
      <SButton
        type="cover"
        variant="secondary"
        :loading="sending"
        :disabled="!inputContent.trim()"
        @click="onSend"
      >
        {{ sending ? t("comment.sending") : t("comment.send") }}
      </SButton>
    </div>
  </div>
</template>
