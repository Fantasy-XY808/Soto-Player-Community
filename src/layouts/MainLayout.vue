<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useOrpheusProtocol } from "@/composables/useOrpheusProtocol";
import { useListenTogether } from "@/composables/useListenTogether";
import { queue as queueRef } from "@/stores/queue";

const route = useRoute();
const status = useStatusStore();
const settings = useSettingsStore();
const media = useMediaStore();

// 接入 orpheus 协议唤起
useOrpheusProtocol();
// 接入一起听：主机模式下队列变化时自动广播
const { status: listenStatus } = useListenTogether();

/** 有歌曲信息时显示播放栏 */
const showPlayerBar = computed(() => !!media.track);
const { isExpanded } = storeToRefs(status);
const { appearance } = settings;

/** 监听主进程"展开播放界面"事件（任务栏歌词封面点击触发） */
const unsubscribeOpenPlayingView = window.api.system.onOpenPlayingView(() => {
  isExpanded.value = true;
});

/** 监听主进程"收起播放界面"事件（任务栏封面 toggle：已展开 → 收起） */
const unsubscribeCollapsePlayingView = window.api.system.onCollapsePlayingView(() => {
  isExpanded.value = false;
});

/**
 * 同步播放界面展开状态到主进程
 * 主进程据此判断任务栏封面 toggle：已展开 → 收起；未展开 → 展开/恢复
 */
watch(isExpanded, (expanded) => {
  window.api.system.setPlayingViewExpanded(expanded).catch(() => {});
});

/**
 * 一起听：队列或当前播放索引变化时通知主进程。
 * idle 与 host 角色均推送——idle 期间累积的队列状态会写入 session，
 * 启动主机后客户端加入时 welcome 才能拿到正确队列。
 * client 角色不推送：客户端队列由主机下发控制，本地队列可能与主机不同，
 * 推送会覆盖 session 中主机同步过来的队列快照。
 * 实际广播仅在 host 角色时由 handlePlayerEvent 触发，idle 为 no-op 仅写入 session。
 */
watch(
  [() => queueRef.value, () => status.playIndex, () => listenStatus.value.role],
  () => {
    if (listenStatus.value.role === "client") return;
    window.api.listenTogether.notifyQueueUpdate(queueRef.value as never, status.playIndex);
  },
  { deep: false },
);

/**
 * 一起听：角色切换到 host 时主动推送一次当前曲目/状态/位置。
 *
 * 解决场景：用户启动主机后不切歌、不暂停、不拖进度——此时不会有 player:load /
 * stateChanged / seek 事件触发，handlePlayerEvent 不会被调用，session.currentTrack
 * 一直停留在 idle 期间最后一次推送的状态（若 idle 期间未播放则为 null）。
 * 客户端连入 welcome 拿不到当前曲目。
 *
 * 此处用 status.position 同步进度（渲染端 status store 与主进程 player 都更新，
 * 之所以用渲染端是因为渲染端 status 持续接收 player:event 推送，比主进程主动拉
 * getPlayer().getPosition() 更稳妥——后者在引擎未就绪时会抛异常）。
 */
watch(
  () => listenStatus.value.role,
  (role) => {
    if (role !== "host") return;
    const state =
      status.state === "playing" ? "playing" : status.state === "paused" ? "paused" : "paused";
    window.api.listenTogether.notifyTrackChange(
      media.track as never,
      status.position,
      state,
    );
  },
);

onBeforeUnmount(() => {
  unsubscribeOpenPlayingView();
  unsubscribeCollapsePlayingView();
});

/** 路由切换动效 */
const routeTransitionName = computed(() => {
  const transition = appearance.routeTransition;
  return transition === "none" ? "" : `route-${transition}`;
});

/** 路由 key */
const routeKey = computed(() => {
  const hasParam = route.matched.some((m) => m.path.includes(":"));
  return hasParam ? route.path : (route.matched[1]?.path ?? route.path);
});

/**
 * 需要 keep-alive 缓存的列表页组件名（Vue SFC 自动从文件名推断）
 * 仅缓存列表页：详情页带路由参数，缓存反而会拿到上次内容
 */
const cachedPageNames = [
  "Home",
  "Library",
  "Search",
  "Favorites",
  "History",
  "Liked",
  "Cloud",
  "Daily",
  "Radio",
  "MvBrowse",
  "Events",
];

/** 侧边栏样式 */
const sidebarClass = computed(() => {
  const classes: string[] = [];
  if (appearance.layoutMode === "floating") {
    classes.push("ml-3 mt-3 mb-3 rounded-xl border border-solid border-primary/10");
  } else {
    classes.push("border-r border-r-solid border-r-primary/10");
    if (showPlayerBar.value && appearance.layoutMode === "default") classes.push("mb-20");
  }
  return classes.join(" ");
});

/** 主界面底部边距 */
const mainMarginClass = computed(() =>
  showPlayerBar.value && appearance.layoutMode !== "floating" ? "mb-20" : "",
);

/** 外层播放条样式 */
const playerBarWrapperClass = computed(() => {
  const base = "fixed bottom-0 z-50 transition-[left] duration-300 pointer-events-none";
  const collapsed = appearance.sidebarCollapsed;
  switch (appearance.layoutMode) {
    case "sidebar-full":
      return `${base} ${collapsed ? "left-16" : "left-60"} right-0`;
    case "floating":
      return `${base} ${collapsed ? "left-[76px]" : "left-[252px]"} right-0 px-4 pb-6`;
    default:
      return `${base} left-0 right-0`;
  }
});

/** 内层播放条样式 */
const playerBarInnerClass = computed(() => {
  // 禁用底部播放栏交互
  const base = isExpanded.value ? "pointer-events-none" : "pointer-events-auto";
  switch (appearance.layoutMode) {
    case "floating":
      return `${base} mx-auto max-w-4xl glass-panel rounded-full shadow-xl border border-solid border-primary/10`;
    default:
      return `${base} h-20 bg-surface-panel border-t border-t-solid border-t-primary/10`;
  }
});
</script>

<template>
  <!-- 主界面 -->
  <div
    class="h-screen flex bg-app text-on-surface transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.7,0,0.3,1)] origin-center"
    :class="isExpanded ? 'scale-95 opacity-0 pointer-events-none' : ''"
  >
    <!-- 侧边栏 -->
    <aside
      class="shrink-0 bg-surface-panel overflow-y-auto z-10 transition-[width,margin] duration-300"
      :class="[appearance.sidebarCollapsed ? 'w-16' : 'w-60', sidebarClass]"
    >
      <SideBar />
    </aside>

    <!-- 右侧主区域 -->
    <div class="flex-1 flex flex-col min-w-0" :class="mainMarginClass">
      <!-- 顶部导航 -->
      <header class="h-16 shrink-0 flex items-center px-3">
        <NavHeader />
      </header>

      <!-- 主内容区 -->
      <main class="flex-1 overflow-y-auto overflow-x-hidden">
        <RouterView v-slot="{ Component }">
          <Transition :name="routeTransitionName" mode="out-in">
            <keep-alive :max="10" :include="cachedPageNames">
              <component :is="Component" :key="routeKey" />
            </keep-alive>
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>

  <!-- 底部播放栏 -->
  <Transition
    enter-active-class="transition-transform duration-300 ease-out"
    leave-active-class="transition-transform duration-300 ease-in"
    enter-from-class="translate-y-full"
    leave-to-class="translate-y-full"
  >
    <div v-if="showPlayerBar" :class="playerBarWrapperClass">
      <footer :class="playerBarInnerClass">
        <PlayerBar />
      </footer>
    </div>
  </Transition>

  <!-- Toast -->
  <SToast :max="1" />
  <!-- 性能监视器 -->
  <SPerformanceMonitor v-if="appearance.showPerformanceMonitor" />
  <!-- Dialog -->
  <SDialogProvider />
  <!-- 全屏播放器 -->
  <FullPlayer />
  <!-- 全局设置 -->
  <SettingsDialog />
  <!-- 更新弹窗 -->
  <UpdateDialog />
</template>
