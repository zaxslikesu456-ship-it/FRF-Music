// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_proxy;
mod pc_extras;
mod po_token;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(pc_extras::media_keys_plugin())
        .manage(po_token::PotState::default())
        .invoke_handler(tauri::generate_handler![po_token::mint_po_token,
            pc_extras::toggle_mini_player,
            pc_extras::show_main_window
        ])
        // YouTube audio served through the app so the equalizer can process it
        // (see audio_proxy.rs). The page reaches it at http://frfaudio.localhost/.
        .register_asynchronous_uri_scheme_protocol("frfaudio", |_ctx, request, responder| {
            tauri::async_runtime::spawn(async move {
                responder.respond(audio_proxy::handle(request).await);
            });
        })
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show Aura Music", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Aura Music", true, None::<&str>)?;
            let mini_item = MenuItem::with_id(app, "mini", "Mini player", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &mini_item, &quit_item])?;
            pc_extras::register_media_keys(app.handle());

            let mut builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "mini" => pc_extras::toggle_mini(app),
                    "show" => {
                        pc_extras::close_mini(app, false);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }

            builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the main window: the hidden token window must not quit the app.
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Closing the window quits the app, and the music with it. It used
                // to hide to the tray and keep playing with no window to control it.
                // (Clicking the tray icon still hides the window on purpose.)
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
