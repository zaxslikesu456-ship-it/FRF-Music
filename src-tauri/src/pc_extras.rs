// PC extras: global media keys + always-on-top mini player window.

use std::sync::Mutex;
use tauri::{
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

const MINI: &str = "mini";
const MINI_W: f64 = 360.0;
const MINI_H: f64 = 120.0;

static LAST_POS: Mutex<Option<(i32, i32)>> = Mutex::new(None);

fn pos_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("mini_pos.json"))
}

fn load_pos(app: &AppHandle) -> Option<(i32, i32)> {
    let text = std::fs::read_to_string(pos_file(app)?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some((v["x"].as_i64()? as i32, v["y"].as_i64()? as i32))
}

fn save_pos(app: &AppHandle) {
    let pos = *LAST_POS.lock().unwrap();
    if let (Some((x, y)), Some(path)) = (pos, pos_file(app)) {
        let _ = std::fs::write(path, format!("{{\"x\":{},\"y\":{}}}", x, y));
    }
}

/// True if the saved point is inside some connected monitor (so the mini
/// player never reopens off-screen after a monitor was unplugged).
fn on_screen(app: &AppHandle, x: i32, y: i32) -> bool {
    app.available_monitors()
        .map(|ms| {
            ms.iter().any(|m| {
                let p = m.position();
                let s = m.size();
                x >= p.x - 20 && y >= p.y - 20 && x < p.x + s.width as i32 - 40 && y < p.y + s.height as i32 - 40
            })
        })
        .unwrap_or(true)
}

pub fn open_mini(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MINI) {
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let win = WebviewWindowBuilder::new(app, MINI, WebviewUrl::App("index.html?mini=1".into()))
            .title("Aura Mini")
            .inner_size(MINI_W, MINI_H)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(true)
            .background_color(tauri::window::Color(18, 18, 18, 255))
            .additional_browser_args(
                "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows",
            )
            .build()
            .map_err(|e| e.to_string())?;

        let saved = load_pos(app).filter(|(x, y)| on_screen(app, *x, *y));
        let target = saved.or_else(|| {
            let m = app.primary_monitor().ok().flatten()?;
            let sc = m.scale_factor();
            let p = m.position();
            let s = m.size();
            Some((
                p.x + s.width as i32 - (MINI_W * sc) as i32 - (24.0 * sc) as i32,
                p.y + s.height as i32 - (MINI_H * sc) as i32 - (72.0 * sc) as i32,
            ))
        });
        if let Some((x, y)) = target {
            let _ = win.set_position(PhysicalPosition::new(x, y));
            *LAST_POS.lock().unwrap() = Some((x, y));
        }
        let handle = app.clone();
        win.on_window_event(move |ev| match ev {
            WindowEvent::Moved(p) => {
                *LAST_POS.lock().unwrap() = Some((p.x, p.y));
            }
            WindowEvent::Destroyed => save_pos(&handle),
            _ => {}
        });
    }
    // The full window steps aside while the mini player is up.
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    Ok(())
}

pub fn close_mini(app: &AppHandle, show_main: bool) {
    if let Some(w) = app.get_webview_window(MINI) {
        let _ = w.close();
    }
    if show_main {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.unminimize();
            let _ = main.set_focus();
        }
    }
}

pub fn toggle_mini(app: &AppHandle) {
    if app.get_webview_window(MINI).is_some() {
        close_mini(app, true);
    } else {
        let _ = open_mini(app);
    }
}

#[tauri::command]
pub async fn toggle_mini_player(app: AppHandle) {
    toggle_mini(&app);
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) {
    close_mini(&app, true);
}

/// Global media keys. They work while the app is unfocused or hidden; the
/// command is forwarded to the main webview, which owns playback.
pub fn media_keys_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let cmd = match shortcut.key {
                Code::MediaPlayPause => "toggle",
                Code::MediaTrackNext => "next",
                Code::MediaTrackPrevious => "prev",
                _ => return,
            };
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.eval(&format!(
                    "window.__frfMedia && window.__frfMedia('{}')",
                    cmd
                ));
            }
        })
        .build()
}

pub fn register_media_keys(app: &AppHandle) {
    for code in [Code::MediaPlayPause, Code::MediaTrackNext, Code::MediaTrackPrevious] {
        // Another app may already own a key; ignore, the page's mediaSession
        // handlers still cover that case.
        let _ = app.global_shortcut().register(Shortcut::new(None, code));
    }
}
