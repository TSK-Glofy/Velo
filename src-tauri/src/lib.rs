// 每个 mod 对应 src/ 下的一个文件，各自负责一块功能
mod config;
mod ffmpeg;
mod jobs;
mod paths;
mod preview;
mod task_types;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let max_concurrent = config::get_max_concurrent_jobs().unwrap_or(1);
    let registry = jobs::TaskRegistry::from_journal(max_concurrent)
        .unwrap_or_else(|_| jobs::TaskRegistry::empty(max_concurrent));
    let shared_registry: jobs::SharedTaskRegistry =
        std::sync::Arc::new(std::sync::Mutex::new(registry));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(shared_registry)
        .manage(preview::PreviewState::default())
        // 注册所有命令，前端通过 invoke("命令名") 调用
        .invoke_handler(tauri::generate_handler![
            config::get_ffmpeg_path,
            config::set_ffmpeg_path,
            config::get_background_image,
            config::set_background_image,
            config::import_background_image,
            config::list_background_images,
            config::clear_background_image,
            config::get_max_concurrent_jobs,
            config::set_max_concurrent_jobs,
            config::get_default_resolution,
            config::set_default_resolution,
            config::get_window_size,
            config::set_window_size,
            config::get_default_output_dir,
            config::set_default_output_dir,
            config::get_default_copy_mode,
            config::set_default_copy_mode,
            config::get_default_same_dir,
            config::set_default_same_dir,
            config::get_language,
            config::set_language,
            config::check_file_exists,
            jobs::create_task,
            jobs::list_tasks,
            jobs::get_task,
            jobs::get_task_log_tail,
            jobs::retry_task,
            jobs::list_interrupted_tasks,
            jobs::retry_interrupted_tasks,
            jobs::cancel_task,
            jobs::delete_task,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
