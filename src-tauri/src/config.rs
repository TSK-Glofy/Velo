use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 应用配置，存储用户设置的 ffmpeg 路径
/// 使用 serde 做序列化/反序列化，可以直接读写 JSON 文件
#[derive(Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub ffmpeg_path: Option<String>,
    pub background_image: Option<String>,
    pub default_resolution: Option<String>,
    pub window_size: Option<String>,
    pub default_output_dir: Option<String>,
    pub default_copy_mode: Option<bool>,
    pub default_same_dir: Option<bool>,
}

/// 获取配置文件的存放路径: ~/.velo/config.json
/// 放在用户目录下，不会因为程序移动而丢失配置
fn config_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("velo");
    path.push("config.json");
    path
}

/// 从磁盘读取配置，如果文件不存在则返回默认空配置
pub fn load_config() -> AppConfig {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

/// 将配置写入磁盘，自动创建目录
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// === Tauri 命令 ===
// 每个 #[tauri::command] 函数都是一个"API端点"，前端通过 invoke() 调用

/// 前端调用此命令获取已保存的 ffmpeg 路径，返回 None 表示未配置
#[tauri::command]
pub fn get_ffmpeg_path() -> Option<String> {
    load_config().ffmpeg_path
}

/// 前端调用此命令保存用户选择的 ffmpeg 路径
#[tauri::command]
pub fn set_ffmpeg_path(path: String) -> Result<String, String> {
    // 验证路径是否存在
    if !std::path::Path::new(&path).exists() {
        return Err("文件不存在".to_string());
    }
    let mut config = load_config();
    config.ffmpeg_path = Some(path);
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取用户设置的背景图路径
#[tauri::command]
pub fn get_background_image() -> Option<String> {
    load_config().background_image
}

/// 保存用户选择的背景图路径
#[tauri::command]
pub fn set_background_image(path: String) -> Result<String, String> {
    if !std::path::Path::new(&path).exists() {
        return Err("文件不存在".to_string());
    }
    let mut config = load_config();
    config.background_image = Some(path);
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取默认分辨率
#[tauri::command]
pub fn get_default_resolution() -> Option<String> {
    load_config().default_resolution
}

/// 保存默认分辨率
#[tauri::command]
pub fn set_default_resolution(resolution: String) -> Result<String, String> {
    let mut config = load_config();
    config.default_resolution = if resolution.is_empty() {
        None
    } else {
        Some(resolution)
    };
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取窗口尺寸设置
#[tauri::command]
pub fn get_window_size() -> Option<String> {
    load_config().window_size
}

/// 保存窗口尺寸设置
#[tauri::command]
pub fn set_window_size(size: String) -> Result<String, String> {
    let mut config = load_config();
    config.window_size = if size.is_empty() {
        None
    } else {
        Some(size)
    };
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取默认输出文件夹（未设置时返回 exe 同级目录）
#[tauri::command]
pub fn get_default_output_dir() -> String {
    load_config()
        .default_output_dir
        .unwrap_or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| {
                    // Windows extended-length 路径前缀 \\?\ 会导致 FFmpeg 无法识别
                    let s = d.to_string_lossy().to_string();
                    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
                }))
                .unwrap_or_else(|| ".".to_string())
        })
}

/// 保存默认输出文件夹
#[tauri::command]
pub fn set_default_output_dir(dir: String) -> Result<String, String> {
    let mut config = load_config();
    config.default_output_dir = if dir.is_empty() {
        None
    } else {
        Some(dir)
    };
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取默认仅复制模式
#[tauri::command]
pub fn get_default_copy_mode() -> bool {
    load_config().default_copy_mode.unwrap_or(false)
}

/// 保存默认仅复制模式
#[tauri::command]
pub fn set_default_copy_mode(enabled: bool) -> Result<String, String> {
    let mut config = load_config();
    config.default_copy_mode = Some(enabled);
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取默认输出到原目录
#[tauri::command]
pub fn get_default_same_dir() -> bool {
    load_config().default_same_dir.unwrap_or(true)
}

/// 保存默认输出到原目录
#[tauri::command]
pub fn set_default_same_dir(enabled: bool) -> Result<String, String> {
    let mut config = load_config();
    config.default_same_dir = Some(enabled);
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 检查文件是否存在
#[tauri::command]
pub fn check_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}
