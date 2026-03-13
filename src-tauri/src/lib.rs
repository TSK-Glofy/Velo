// 每个 mod 对应 src/ 下的一个文件，各自负责一块功能
mod config;
mod ffmpeg;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 注册所有命令，前端通过 invoke("命令名") 调用
        .invoke_handler(tauri::generate_handler![
            config::get_ffmpeg_path,
            config::set_ffmpeg_path,
            config::get_background_image,
            config::set_background_image,
            config::get_default_resolution,
            config::set_default_resolution,
            config::get_window_size,
            config::set_window_size,
            config::check_file_exists,
            ffmpeg::trim_video,
            ffmpeg::merge_videos,
            ffmpeg::extract_frames,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
