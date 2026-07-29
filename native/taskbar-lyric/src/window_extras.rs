//! 窗口扩展工具：为灵动岛等外部窗口添加 Win32 扩展样式与系统级检测
//!
//! - set_window_no_activate：添加 WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW
//!   让窗口点击不抢焦点、不出现在 Alt+Tab 任务栏切换列表
//! - is_foreground_fullscreen：检测前台窗口（任意进程）是否全屏覆盖指定矩形区域
//!   用于灵动岛全屏抑制，弥补 Electron 仅能枚举本应用窗口的限制

use napi_derive::napi;
use windows::Win32::{
    Foundation::RECT,
    Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
    },
    UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW,
        GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    },
};

use crate::take_valid_hwnd;

/// 为指定窗口添加 WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW 扩展样式
///
/// - WS_EX_NOACTIVATE：点击窗口不激活、不抢焦点，全屏游戏/视频不会因点击灵动岛而最小化
/// - WS_EX_TOOLWINDOW：窗口不出现在 Alt+Tab 切换列表与任务栏
///
/// 对灵动岛窗口尤其关键：用户点击灵动岛控制按钮时不应夺走其他应用焦点。
///
/// @param hwnd_ptr - BrowserWindow.getNativeWindowHandle() 返回的指针值
/// @returns 成功设置返回 true，HWND 无效返回 false
#[napi]
pub fn set_window_no_activate(hwnd_ptr: i64) -> bool {
    let Some(hwnd) = take_valid_hwnd(hwnd_ptr as usize) else {
        return false;
    };
    // SAFETY: GetWindowLongPtrW 对有效 HWND 返回当前扩展样式值
    let current = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let new_style = current | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOOLWINDOW.0 as isize);
    // SAFETY: SetWindowLongPtrW 设置扩展样式
    let _ = unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style) };
    true
}

/// 判断当前前台窗口（任意进程）是否全屏覆盖灵动岛所在显示器
///
/// 弥补 Electron `BrowserWindow.getFocusedWindow()` 仅能枚举本应用窗口的缺陷：
/// 用户在全屏游戏 / 全屏视频播放器中时，灵动岛应自动隐藏避免遮挡。
///
/// @param island_hwnd_ptr - 灵动岛窗口 HWND（0 表示用主显示器）
/// @returns 前台窗口全屏覆盖时返回 true
#[napi]
pub fn is_foreground_fullscreen(island_hwnd_ptr: i64) -> bool {
    let island_hwnd = if island_hwnd_ptr > 0 {
        take_valid_hwnd(island_hwnd_ptr as usize)
    } else {
        None
    };

    // SAFETY: GetForegroundWindow 返回前台窗口 HWND
    let fg = unsafe { GetForegroundWindow() };
    if fg.is_invalid() {
        return false;
    }

    let mut fg_rect = RECT::default();
    // SAFETY: GetWindowRect 对有效 HWND 写入窗口矩形
    if unsafe { GetWindowRect(fg, &mut fg_rect) }.is_err() {
        return false;
    }

    let monitor = unsafe { MonitorFromWindow(fg, MONITOR_DEFAULTTOPRIMARY) };
    let mut mi = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: GetMonitorInfoW 写入 MONITORINFO 结构
    if !unsafe { GetMonitorInfoW(monitor, &mut mi) }.as_bool() {
        return false;
    }

    let mon = mi.rcMonitor;
    // 灵动岛窗口自身作为前台时（鼠标悬停交互），不算"被全屏抑制"
    if let Some(h) = island_hwnd {
        if h == fg {
            return false;
        }
    }

    fg_rect.left <= mon.left
        && fg_rect.top <= mon.top
        && fg_rect.right >= mon.right
        && fg_rect.bottom >= mon.bottom
}

/// 强制将窗口置顶到 Z 序顶层（HWND_TOPMOST）
///
/// Electron 的 setAlwaysOnTop 在某些场景后可能失效。
/// 定期调用此函数刷新置顶层级，对齐 WinIsland 每帧 SetWindowPos(HWND_TOPMOST) 的强化策略。
///
/// @param hwnd_ptr - 目标窗口 HWND
/// @returns 成功返回 true
#[napi]
pub fn bring_window_to_topmost(hwnd_ptr: i64) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    let Some(hwnd) = take_valid_hwnd(hwnd_ptr as usize) else {
        return false;
    };
    // SAFETY: SetWindowPos 以 NOACTIVATE | NOMOVE | NOSIZE 调用仅调整 Z 序
    let r = unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        )
    };
    r.is_ok()
}
