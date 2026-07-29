//! 下一曲预加载缓存
//!
//! 用户启用 playbackPerf.prefetchNextTrack 时，前端在剩余 prefetchThresholdSec 时
//! 调用 NAPI prefetch(source)，spawn 后台线程预打开 reader + 探针 + 提取 metadata，
//! 缓存 PrefetchedData。下次 load(source) 命中缓存时跳过 FFmpeg 打开 + 探针 +
//! metadata 提取（10-60ms），降低首字节延迟。
//!
//! 缓存策略：
//! - 容量上限 4 条（覆盖下一曲 + 随机播放场景）
//! - TTL prefetchTtlSec（默认 300s），超时自动清理
//! - LRU 淘汰：超过容量时按 prefetched_at 最早的淘汰
//!
//! 线程安全：
//! - AudioReader 不是 Send（FFmpeg 上下文），但项目已 unsafe impl Send for DecoderData
//! - PrefetchedData 同样 unsafe impl Send，仅跨线程 move（不共享），单线程访问

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use ffmpeg_audio::{AudioReader, SourceAudioInfo};
use parking_lot::Mutex;
use tracing::{debug, info, warn};

use crate::metadata::ExternalLyric;

/// 预加载的解码上下文（不含 resampler，resampler 按 target_rate 在 load 时构建）
///
/// 字段对齐 decoder::start_decode 中需要从 reader 提取的全部信息：
/// - reader：已打开的 AudioReader（含 IO 上下文 + 解码器初始化）
/// - info：已探针的 SourceAudioInfo（避免 reader.source_info() 二次调用）
/// - raw_metadata：已读取的容器 metadata dict（lyric / replaygain 来源）
/// - cover_raw：已读取的原始封面数据
/// - embedded_lyric / external_lyrics / replay_gain_db：已提取的常用 metadata
/// - duration_secs / codec：常用展示字段
pub struct PrefetchedData {
    pub reader: AudioReader,
    pub info: SourceAudioInfo,
    pub raw_metadata: HashMap<String, String>,
    pub cover_raw: Option<Vec<u8>>,
    pub embedded_lyric: Option<String>,
    pub external_lyrics: Vec<ExternalLyric>,
    pub replay_gain_db: Option<f32>,
    pub duration_secs: f64,
    pub codec: String,
    pub prefetched_at: Instant,
}

// SAFETY: AudioReader 内部持有 FFmpeg 上下文（!Send），但 PrefetchedData 从 prefetch
// 线程 move 到 load 线程，全程独占访问（无并发），与 decoder::DecoderData 的 unsafe impl Send
// 同模式。FFmpeg 上下文不跨线程共享，仅在线程间转移所有权
//
// 不实现 Sync：避免多个线程同时持有 &PrefetchedData 导致 &AudioReader 跨线程共享。
// SharedPrefetchCache 使用 Arc<Mutex<PrefetchCache>>，Mutex 只要求 T: Send，
// 取条目时 .lock().take() 返回 owned PrefetchedData，不暴露共享引用
unsafe impl Send for PrefetchedData {}

/// 预加载缓存条目
struct CacheEntry {
    /// 预加载数据；被 take 后置为 None（保留条目用于 TTL 统计）
    data: Option<PrefetchedData>,
    prefetched_at: Instant,
}

/// 预加载缓存（按 source 字符串索引）
pub struct PrefetchCache {
    entries: HashMap<String, CacheEntry>,
    capacity: usize,
    ttl_sec: u64,
    /// 是否启用预加载（用户在设置中切换；false 时 prefetch 调用直接 no-op）
    enabled: bool,
}

impl Default for PrefetchCache {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            capacity: 4,
            ttl_sec: 300,
            enabled: true,
        }
    }
}

impl PrefetchCache {
    pub fn new(capacity: usize, ttl_sec: u64) -> Self {
        Self {
            entries: HashMap::new(),
            capacity,
            ttl_sec,
            enabled: true,
        }
    }

    /// 更新容量 / TTL / enabled（用户设置变更时调用）
    /// 容量缩小时淘汰多余条目；enabled=false 不立即清空，仅阻止新 prefetch
    pub fn configure(&mut self, capacity: usize, ttl_sec: u64, enabled: bool) {
        self.capacity = capacity.max(1);
        self.ttl_sec = ttl_sec.max(60);
        self.enabled = enabled;
        // 容量缩小时淘汰多余条目（按 prefetched_at 最早）
        while self.entries.len() > self.capacity {
            if let Some(oldest_key) = self
                .entries
                .iter()
                .min_by_key(|(_, e)| e.prefetched_at)
                .map(|(k, _)| k.clone())
            {
                self.entries.remove(&oldest_key);
            } else {
                break;
            }
        }
    }

    /// 当前是否启用预加载（prefetch 调用前先检查）
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// 插入预加载结果（覆盖同 key 旧条目）
    pub fn insert(&mut self, source: String, data: PrefetchedData) {
        // LRU 淘汰：达到容量上限时移除最早的条目
        while self.entries.len() >= self.capacity {
            if let Some(oldest_key) = self
                .entries
                .iter()
                .min_by_key(|(_, e)| e.prefetched_at)
                .map(|(k, _)| k.clone())
            {
                self.entries.remove(&oldest_key);
            } else {
                break;
            }
        }
        let prefetched_at = data.prefetched_at;
        self.entries.insert(
            source,
            CacheEntry {
                data: Some(data),
                prefetched_at,
            },
        );
    }

    /// 取出预加载结果（命中即移除，避免重复使用）
    /// 同时清理过期条目
    pub fn take(&mut self, source: &str) -> Option<PrefetchedData> {
        self.evict_expired();
        let entry = self.entries.remove(source)?;
        entry.data
    }

    /// 清理过期条目（按 ttl_sec）
    fn evict_expired(&mut self) {
        let now = Instant::now();
        let ttl = std::time::Duration::from_secs(self.ttl_sec);
        let before = self.entries.len();
        self.entries
            .retain(|_, e| now.duration_since(e.prefetched_at) < ttl);
        let evicted = before - self.entries.len();
        if evicted > 0 {
            debug!(evicted, remaining = self.entries.len(), "预加载缓存清理过期条目");
        }
    }

    /// 清空缓存（切歌失败 / 用户手动清理时调用）
    pub fn clear(&mut self) {
        if !self.entries.is_empty() {
            info!(count = self.entries.len(), "清空预加载缓存");
        }
        self.entries.clear();
    }

    /// 当前缓存条目数（前端展示用）
    ///
    /// 注：当前未接 IPC，保留供未来前端"预加载缓存状态"展示调用
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// 全局共享缓存（InnerPlayer 内部用 Arc<Mutex<PrefetchCache>>）
///
/// 用 Mutex 而非 RwLock 的原因：RwLock<T>: Sync 要求 T: Send + Sync，
/// 而 PrefetchedData 内含 FFmpeg 裸指针（!Sync），无法 impl Sync。
/// Mutex<T>: Sync 仅要求 T: Send，配合 unsafe impl Send for PrefetchedData 即可。
/// 缓存访问频率低（prefetch 命中检查 + load 时 take），Mutex 互斥开销可忽略
pub type SharedPrefetchCache = Arc<Mutex<PrefetchCache>>;

/// 创建共享预加载缓存
pub fn new_shared_cache(capacity: usize, ttl_sec: u64) -> SharedPrefetchCache {
    Arc::new(Mutex::new(PrefetchCache::new(capacity, ttl_sec)))
}

/// 预加载一个音频源（spawn 后台线程执行，立即返回）
///
/// 流程：
/// - 检查缓存是否已启用 + 是否已有同 source 条目（避免重复 prefetch）
/// - spawn 线程：open_source 第一步（建 reader）+ 探针 + 读 metadata + 提取常用字段
/// - 缓存结果到 SharedPrefetchCache
///
/// 失败处理：网络拉流失败 / 解密失败 / 文件不存在等仅 warn 日志，不向上抛
/// 前端 load 时若缓存未命中会回退到正常 start_decode 路径
pub fn prefetch_source(
    source: String,
    cache: SharedPrefetchCache,
    cover_cache_dir: Option<String>,
) {
    // 快速检查：缓存未启用或已有条目则跳过
    {
        let c = cache.lock();
        if !c.enabled() {
            return;
        }
        if c.entries.contains_key(&source) {
            return;
        }
    }

    info!(source = %source, "启动预加载");
    let cache_for_thread = Arc::clone(&cache);
    std::thread::spawn(move || {
        let prefetched_at = Instant::now();
        let result = build_prefetched_data(&source, cover_cache_dir.as_deref());
        match result {
            Ok(data) => {
                let mut c = cache_for_thread.lock();
                c.insert(source.clone(), data);
                debug!(source = %source, elapsed_ms = ?prefetched_at.elapsed().as_millis(), "预加载完成");
            }
            Err(e) => {
                warn!(source = %source, error = %e, "预加载失败（load 时回退到正常路径）");
            }
        }
    });
}

/// 构建预加载数据：open reader + 探针 + 读 metadata + 提取常用字段
///
/// 与 decoder::open_source 第一步对齐，但不构建 resampler（resampler 与 Shared.target_rate 绑定）
///
/// 暴露为 pub(crate)，供 lib.rs::prefetch_and_probe 复用——probe 时一并构建
/// PrefetchedData 写入 prefetch_cache，load 时命中缓存跳过第二次 FFmpeg 打开
pub(crate) fn build_prefetched_data(
    source: &str,
    _cover_cache_dir: Option<&str>,
) -> anyhow::Result<PrefetchedData> {
    use crate::http_source;
    use crate::metadata;

    let (reader, _cancel) = if http_source::is_network_source(source) {
        let http = http_source::HttpRangeSource::new(source)?;
        let cancel = http.cancel_handle();
        let reader = ffmpeg_audio::AudioReader::new(http)
            .map_err(|e| anyhow::anyhow!("打开网络音频失败: {source} - {e}"))?;
        (reader, Some(cancel))
    } else {
        // 本地文件：检测 unlock-music 加密格式
        if let Some(fmt) = crate::decryptor::detect(source) {
            let decrypted = crate::decryptor::decrypt(source, fmt)?;
            let reader = ffmpeg_audio::AudioReader::new(decrypted)
                .map_err(|e| anyhow::anyhow!("打开解密音频失败: {source} - {e}"))?;
            (reader, None)
        } else {
            let file = std::fs::File::open(source)?;
            let reader = ffmpeg_audio::AudioReader::new(file)
                .map_err(|e| anyhow::anyhow!("打开本地音频失败: {source} - {e}"))?;
            (reader, None)
        }
    };

    // 探针：FFmpeg 读取 header 确定 codec / 采样率 / 时长
    // 立即 clone info 以结束对 reader 的借用，否则下方 PrefetchedData { reader, ... } 移动报错
    let info = reader.source_info().clone();
    let duration_secs = reader.duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);
    let codec = info.codec_name.clone().unwrap_or_default();

    // 读 metadata dict（tags / lyric / replaygain 来源）
    let raw_metadata = reader.metadata();
    let cover_raw = metadata::read_attached_pic(&reader);
    let embedded_lyric = metadata::extract_embedded_lyric(&raw_metadata);
    let external_lyrics = metadata::find_all_external_lyrics(source);
    let replay_gain_db = metadata::extract_replay_gain(&raw_metadata);

    Ok(PrefetchedData {
        reader,
        info,
        raw_metadata,
        cover_raw,
        embedded_lyric,
        external_lyrics,
        replay_gain_db,
        duration_secs,
        codec,
        prefetched_at: Instant::now(),
    })
}
