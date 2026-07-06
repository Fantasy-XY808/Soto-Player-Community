/**
 * 全局性能优化服务
 *
 * 集中管理各类性能优化策略：
 * - 数据缓存：LRU + TTL，避免重复网络请求与计算
 * - 预见性加载：根据用户行为预加载下一页/下一首
 * - 乐观更新：切歌/操作时先更新 UI 再等后端确认
 * - 后台加载：低优先级任务在 idle 回调中执行
 * - 延迟加载：非关键资源延迟到首屏渲染后
 * - 虚拟滚动：长列表只渲染可视区域
 * - 抢先渲染：提前渲染即将进入视口的组件
 * - 即时反馈：操作后立即给 UI 反馈，不等后端
 */

import { LruCache } from "@/services/lruCache";

const songDetailCache = new LruCache<string, Record<string, unknown>>({
  capacity: 200,
  ttl: 30 * 60 * 1000,
});

const playlistCache = new LruCache<string, Record<string, unknown>>({
  capacity: 50,
  ttl: 15 * 60 * 1000,
});

const searchCache = new LruCache<string, unknown[]>({
  capacity: 30,
  ttl: 5 * 60 * 1000,
});

const artistCache = new LruCache<string, Record<string, unknown>>({
  capacity: 100,
  ttl: 60 * 60 * 1000,
});

const commentCache = new LruCache<string, unknown[]>({
  capacity: 50,
  ttl: 10 * 60 * 1000,
});

export const caches = {
  songDetail: songDetailCache,
  playlist: playlistCache,
  search: searchCache,
  artist: artistCache,
  comment: commentCache,
};

/**
 * 在浏览器 idle 回调中执行低优先级任务
 * 不支持 requestIdleCallback 时回退到 setTimeout(0)
 */
export const runIdle = (task: () => void, timeout = 2000): void => {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(task, { timeout });
  } else {
    setTimeout(task, 0);
  }
};

/**
 * 批量执行 idle 任务，避免一次性阻塞主线程
 * 每帧最多执行 maxPerFrame 个任务
 */
export class IdleBatchRunner {
  private queue: (() => void)[] = [];
  private running = false;
  private readonly maxPerFrame: number;

  constructor(maxPerFrame = 3) {
    this.maxPerFrame = maxPerFrame;
  }

  enqueue(task: () => void): void {
    this.queue.push(task);
    if (!this.running) this.flush();
  }

  private flush = (): void => {
    this.running = true;
    runIdle(() => {
      const batch = this.queue.splice(0, this.maxPerFrame);
      for (const task of batch) task();
      if (this.queue.length > 0) {
        this.flush();
      } else {
        this.running = false;
      }
    });
  };
}

/**
 * 防抖 + 缓存：对异步函数结果做短期缓存，避免重复请求
 * 适合搜索建议、歌词预览等场景
 */
export function cachedDebounce<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delay: number,
  cacheKey: (args: Parameters<T>) => string,
  cacheTtl = 60000,
): T {
  const cache = new LruCache<string, unknown>({ capacity: 50, ttl: cacheTtl });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Parameters<T> | null = null;

  const debounced = async (...args: Parameters<T>): Promise<unknown> => {
    const key = cacheKey(args);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    pendingArgs = args;
    return new Promise((resolve) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!pendingArgs) return;
        const result = await fn(...pendingArgs);
        cache.set(key, result);
        pendingArgs = null;
        resolve(result);
      }, delay);
    });
  };

  return debounced as T;
}

/**
 * 虚拟滚动辅助：计算可视区域内的项目范围
 * @param scrollTop - 滚动偏移
 * @param viewportHeight - 视口高度
 * @param itemCount - 总项目数
 * @param itemHeight - 单项高度
 * @param overscan - 上下额外渲染的行数
 */
export const computeVisibleRange = (
  scrollTop: number,
  viewportHeight: number,
  itemCount: number,
  itemHeight: number,
  overscan = 5,
): { start: number; end: number } => {
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / itemHeight);
  const end = Math.min(itemCount, start + visibleCount + overscan * 2);
  return { start, end };
};

/**
 * 抢先渲染：检测元素即将进入视口时触发回调
 * 使用 IntersectionObserver + rootMargin 实现提前加载
 */
export const createPreloadObserver = (
  callback: (entry: IntersectionObserverEntry) => void,
  rootMargin = "200px",
): IntersectionObserver => {
  return new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) callback(entry);
      }
    },
    { rootMargin },
  );
};

/**
 * 即时反馈：操作后立即更新 UI 状态，失败时回滚
 * @param optimisticState - 乐观更新的状态
 * @param apply - 应用乐观更新
 * @param rollback - 回滚乐观更新
 * @param confirm - 确认操作（异步）
 */
export const withOptimisticUpdate = async <T>(
  optimisticState: T,
  apply: (state: T) => void,
  rollback: (state: T) => void,
  confirm: () => Promise<boolean>,
): Promise<boolean> => {
  apply(optimisticState);
  try {
    const success = await confirm();
    if (!success) rollback(optimisticState);
    return success;
  } catch {
    rollback(optimisticState);
    return false;
  }
};

/**
 * 后台加载调度器：在 idle 时间批量加载非关键数据
 * 适合歌词预加载、封面预解码等
 */
export class BackgroundLoader {
  private readonly batchRunner = new IdleBatchRunner(5);
  private readonly loaded = new Set<string>();

  schedule(key: string, task: () => void): void {
    if (this.loaded.has(key)) return;
    this.loaded.add(key);
    this.batchRunner.enqueue(task);
  }

  invalidate(key: string): void {
    this.loaded.delete(key);
  }

  clear(): void {
    this.loaded.clear();
  }
}

export const backgroundLoader = new BackgroundLoader();