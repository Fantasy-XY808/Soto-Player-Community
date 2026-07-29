//! 平台相关的进程 / 线程优先级管理。
//!
//! Windows 下把 audio-engine 进程提升到 ABOVE_NORMAL_PRIORITY_CLASS，
//! 并把音频关键线程（audio-output-owner / audio-decoder）提升到 THREAD_PRIORITY_HIGHEST，
//! 减少 WASAPI 缓冲区饥饿导致的 underrun 偶发噪声。
//!
//! 其它平台（macOS / Linux）保持空实现，调用方无需条件编译。

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::Once;

    use tracing::{info, warn};
    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetCurrentThread, SetPriorityClass, SetThreadPriority,
        ABOVE_NORMAL_PRIORITY_CLASS, THREAD_PRIORITY_HIGHEST,
    };

    static PROCESS_PRIORITY_ONCE: Once = Once::new();

    pub fn configure_process_priority() {
        PROCESS_PRIORITY_ONCE.call_once(|| unsafe {
            if let Err(err) = SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS) {
                warn!(error = %err, "设置 audio-engine 进程优先级失败");
                return;
            }
            info!("audio-engine 进程优先级已设为 Above Normal");
        });
    }

    pub fn boost_current_audio_thread(name: &str) {
        unsafe {
            if let Err(err) = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST) {
                warn!(thread = name, error = %err, "设置音频线程优先级失败");
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    pub fn configure_process_priority() {}

    pub fn boost_current_audio_thread(_name: &str) {}
}

pub use imp::{boost_current_audio_thread, configure_process_priority};
