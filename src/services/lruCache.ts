/**
 * 通用 LRU 缓存
 *
 * 基于 Map 插入序实现 LRU：get 时把条目重新插到末尾（最近使用），set 时按容量
 * 淘汰首部（最久未访问）。可选 TTL：超时条目在下次访问时被惰性淘汰。
 *
 * 设计要点：
 * - 不持有大对象引用的兜底，调用方仍需自行约束放入数据规模（如 TrackDetail 不该进缓存）
 * - Map 按插入序遍历，reinsert 即"移动到末尾"，无需手写双向链表
 * - TTL 仅在 get/set/has 时惰性淘汰，不主动扫描，避免后台定时器
 *
 * @example
 * const cache = new LruCache<string, SelectedComment>({ capacity: 100 });
 * cache.set(songId, comment);
 * const hit = cache.get(songId); // 命中会重排
 */

interface Entry<V> {
  value: V;
  /** 过期时间戳（ms）；Infinity 表示不过期 */
  expiresAt: number;
}

export interface LruCacheOptions {
  /** 容量上限；超限时淘汰最久未访问条目 */
  capacity: number;
  /** 可选 TTL（毫秒）；超时条目在下次访问时被惰性淘汰 */
  ttl?: number;
}

export class LruCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly capacity: number;
  private readonly ttl: number | undefined;

  constructor(options: LruCacheOptions) {
    this.capacity = options.capacity;
    this.ttl = options.ttl;
  }

  /**
   * 取缓存；命中时把条目移到末尾，过期返回 undefined
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.map.delete(key);
      return undefined;
    }
    // reinsert 维持 LRU 顺序
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** 是否存在未过期条目；不会重排顺序 */
  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 写入条目；已存在则更新并移到末尾；超容量时淘汰首部
   */
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    const expiresAt = this.ttl ? Date.now() + this.ttl : Number.POSITIVE_INFINITY;
    this.map.set(key, { value, expiresAt });
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** 删除指定键 */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /** 清空所有条目 */
  clear(): void {
    this.map.clear();
  }

  /** 当前条目数量（含未淘汰的过期条目，下次访问才会被淘汰） */
  get size(): number {
    return this.map.size;
  }

  private isExpired(entry: Entry<V>): boolean {
    return this.ttl !== undefined && Date.now() > entry.expiresAt;
  }
}
