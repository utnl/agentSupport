use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_notification::NotificationExt;
use std::thread;
use std::time::Duration;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};

// Global state to track running transcribe process PID
struct TranscribeState {
    pid: Option<u32>,
}

impl TranscribeState {
    fn new() -> Self {
        Self { pid: None }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

#[tauri::command]
fn schedule_reminder(app: tauri::AppHandle, delay_seconds: u64, message: String) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(delay_seconds));
        show_notify_window(&app, &message);
    });
}

/// Kiểm tra transcribe.exe có tồn tại không
#[tauri::command]
fn check_python() -> bool {
    // Trong dev mode: kiểm tra Python
    // Trong production: luôn true vì đã bundle exe
    #[cfg(debug_assertions)]
    {
        Command::new("python")
            .args(["-c", "import faster_whisper"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(debug_assertions))]
    {
        true // Production luôn có transcribe.exe
    }
}

/// Dừng transcribe process
#[tauri::command]
fn stop_transcribe(state: tauri::State<Arc<Mutex<TranscribeState>>>) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    
    if let Some(pid) = state.pid.take() {
        // Kill process by PID
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output();
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();
        }
        
        Ok(())
    } else {
        Err("No transcribe process running".to_string())
    }
}

/// Chạy transcribe (Python script trong dev, exe trong production)
#[tauri::command]
fn start_transcribe(
    app: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<TranscribeState>>>,
    duration_secs: u64,
    language: String
) {
    // Stop any existing process first
    {
        let mut state_guard = state.lock().unwrap();
        if let Some(pid) = state_guard.pid.take() {
            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string()])
                    .output();
            }
            
            #[cfg(not(target_os = "windows"))]
            {
                let _ = Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
            }
        }
    }
    
    let state_clone = state.inner().clone();
    
    thread::spawn(move || {
        #[cfg(debug_assertions)]
        let mut cmd = {
            let mut c = Command::new("python");
            c.arg("transcribe.py");
            c
        };

        #[cfg(not(debug_assertions))]
        let mut cmd = {
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            let transcribe_exe = exe_dir.join("transcribe.exe");
            Command::new(transcribe_exe)
        };

        cmd.arg(duration_secs.to_string())
            .arg(language)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("transcribe-error", format!("Không chạy được transcribe: {}", e));
                return;
            }
        };

        // Store PID in state
        let pid = child.id();
        {
            let mut state_guard = state_clone.lock().unwrap();
            state_guard.pid = Some(pid);
        }

        // Đọc stdout realtime
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                        let event_type = event["type"].as_str().unwrap_or("");
                        let data = &event["data"];
                        
                        match event_type {
                            "status" => {
                                let _ = app.emit("transcribe-status", data.as_str().unwrap_or(""));
                            }
                            "transcript" => {
                                let _ = app.emit("transcribe-result", data);
                            }
                            "transcript-draft" => {
                                let _ = app.emit("transcribe-draft", data);
                            }
                            "transcript-final" => {
                                let _ = app.emit("transcribe-final", data);
                            }
                            "error" => {
                                let _ = app.emit("transcribe-error", data.as_str().unwrap_or(""));
                            }
                            "debug" => {
                                // Optional: emit debug events for development
                                #[cfg(debug_assertions)]
                                {
                                    let _ = app.emit("transcribe-debug", data.as_str().unwrap_or(""));
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        let _ = child.wait();
        
        // Clear state when process ends
        {
            let mut state_guard = state_clone.lock().unwrap();
            state_guard.pid = None;
        }
        
        let _ = app.emit("transcribe-status", "idle");
    });
}

fn show_notify_window(app: &tauri::AppHandle, message: &str) {
    if let Some(old) = app.get_webview_window("notify") {
        let _ = old.close();
        thread::sleep(Duration::from_millis(100));
    }

    let encoded = urlencoding_simple(message);
    let url = format!("index.html?notify=1&msg={}", encoded);

    let win = WebviewWindowBuilder::new(app, "notify", WebviewUrl::App(url.into()))
        .title("")
        .inner_size(420.0, 160.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .center()
        .skip_taskbar(true)
        .visible(false)
        .build();

    if let Ok(win) = win {
        let _ = win.show();
        let win_clone = win.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(5));
            let _ = win_clone.close();
        });
    }
}

fn urlencoding_simple(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            '&' => "%26".to_string(),
            '=' => "%3D".to_string(),
            '+' => "%2B".to_string(),
            '#' => "%23".to_string(),
            _ => c.to_string(),
        })
        .collect()
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            position_window_bottom_right(&window);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn position_window_bottom_right(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let screen_size = monitor.size();
        let scale = monitor.scale_factor();
        let win_size = window
            .outer_size()
            .unwrap_or(tauri::PhysicalSize { width: 360, height: 480 });

        let x = (screen_size.width as f64 / scale) as i32
            - (win_size.width as f64 / scale) as i32
            - 16;
        let y = (screen_size.height as f64 / scale) as i32
            - (win_size.height as f64 / scale) as i32
            - 60;

        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let transcribe_state = Arc::new(Mutex::new(TranscribeState::new()));
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(transcribe_state)
        .invoke_handler(tauri::generate_handler![
            greet,
            schedule_reminder,
            check_python,
            start_transcribe,
            stop_transcribe
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            let quit = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Mở trợ lý", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let handle = app.handle().clone();

            let icon_bytes = include_bytes!("../icons/banana.png");
            let tray_icon = tauri::image::Image::from_bytes(icon_bytes)
                .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());

            TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Banana Cat 🍌")
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(&handle);
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
