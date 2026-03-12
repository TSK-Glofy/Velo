// 用 #[tauri::command] 标记的函数可以被前端通过 invoke() 调用
// 这是前后端通信的桥梁，每个命令就像一个 API 端点
#[tauri::command]
fn hello() -> String {
    "Hello from Rust!".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // 在这里注册所有命令，前端才能调用到
        .invoke_handler(tauri::generate_handler![hello])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
