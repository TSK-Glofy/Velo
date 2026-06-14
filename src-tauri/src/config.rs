use serde::{Deserialize, Serialize};
use std::fs;

/// 应用配置，存储用户设置的 ffmpeg 路径
/// 使用 serde 做序列化/反序列化，可以直接读写 JSON 文件
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct AppConfig {
    pub ffmpeg_path: Option<String>,
    pub background_image: Option<String>,
    pub default_resolution: Option<String>,
    pub window_size: Option<String>,
    pub default_output_dir: Option<String>,
    pub default_copy_mode: Option<bool>,
    pub default_same_dir: Option<bool>,
    pub language: Option<String>,
    pub max_concurrent_jobs: Option<u32>,
}

/// 安装目录下的初始配置种子，例如安装器写入的语言偏好
#[derive(Serialize, Deserialize, Default)]
struct InstallDefaults {
    locale: Option<String>,
}

/// 从安装目录读取配置；首次运行时会根据 install.json 生成 config.json
pub fn load_config() -> Result<AppConfig, String> {
    let root = crate::paths::app_root()?;
    load_config_from_root(&root)
}

/// 将配置写入安装目录下的 config/config.json，自动创建目录
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let root = crate::paths::app_root()?;
    save_config_to_root(&root, config)
}

pub fn load_config_from_root(root: &std::path::Path) -> Result<AppConfig, String> {
    let path = crate::paths::config_file_from_root(root);
    match fs::read_to_string(&path) {
        Ok(content) => {
            return serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse config {}: {}", path.display(), e));
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return Err(format!("Failed to read config {}: {}", path.display(), error));
        }
        Err(_) => {}
    }

    let config = AppConfig {
        language: Some(read_installer_language_from_root(root)),
        ..AppConfig::default()
    };
    save_config_to_root(root, &config)?;
    Ok(config)
}

fn save_config_to_root(root: &std::path::Path, config: &AppConfig) -> Result<(), String> {
    let path = crate::paths::config_file_from_root(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn read_installer_language_from_root(root: &std::path::Path) -> String {
    let path = crate::paths::install_defaults_file_from_root(root);
    let locale = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<InstallDefaults>(&content).ok())
        .and_then(|defaults| defaults.locale);
    map_installer_locale(locale.as_deref())
}

fn map_installer_locale(locale: Option<&str>) -> String {
    let normalized = locale.unwrap_or("").replace('-', "_").to_ascii_lowercase();
    match normalized.as_str() {
        "zh_cn" | "simpchinese" | "chinese" => "zh".to_string(),
        "en_us" | "en" | "english" => "en".to_string(),
        _ => "en".to_string(),
    }
}

// === Tauri 命令 ===
// 每个 #[tauri::command] 函数都是一个"API端点"，前端通过 invoke() 调用

/// 前端调用此命令获取已保存的 ffmpeg 路径，返回 None 表示未配置
#[tauri::command]
pub fn get_ffmpeg_path() -> Result<Option<String>, String> {
    Ok(load_config()?.ffmpeg_path)
}

/// 前端调用此命令保存用户选择的 ffmpeg 路径
#[tauri::command]
pub fn set_ffmpeg_path(path: String) -> Result<String, String> {
    // 验证路径是否存在
    if !std::path::Path::new(&path).exists() {
        return Err("文件不存在".to_string());
    }
    let mut config = load_config()?;
    config.ffmpeg_path = Some(path);
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取用户设置的背景图路径
#[tauri::command]
pub fn get_background_image() -> Result<Option<String>, String> {
    Ok(load_config()?.background_image)
}

/// 保存用户选择的背景图路径
#[tauri::command]
pub fn set_background_image(path: String) -> Result<String, String> {
    if !std::path::Path::new(&path).exists() {
        return Err("文件不存在".to_string());
    }
    let mut config = load_config()?;
    config.background_image = Some(path);
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取默认分辨率
#[tauri::command]
pub fn get_default_resolution() -> Result<Option<String>, String> {
    Ok(load_config()?.default_resolution)
}

/// 保存默认分辨率
#[tauri::command]
pub fn set_default_resolution(resolution: String) -> Result<String, String> {
    let mut config = load_config()?;
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
pub fn get_window_size() -> Result<Option<String>, String> {
    Ok(load_config()?.window_size)
}

/// 保存窗口尺寸设置
#[tauri::command]
pub fn set_window_size(size: String) -> Result<String, String> {
    let mut config = load_config()?;
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
pub fn get_default_output_dir() -> Result<String, String> {
    let config = load_config()?;
    match config.default_output_dir {
        Some(dir) => Ok(dir),
        None => Ok(crate::paths::app_root()?.to_string_lossy().to_string()),
    }
}

/// 保存默认输出文件夹
#[tauri::command]
pub fn set_default_output_dir(dir: String) -> Result<String, String> {
    let mut config = load_config()?;
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
pub fn get_default_copy_mode() -> Result<bool, String> {
    Ok(load_config()?.default_copy_mode.unwrap_or(false))
}

/// 保存默认仅复制模式
#[tauri::command]
pub fn set_default_copy_mode(enabled: bool) -> Result<String, String> {
    let mut config = load_config()?;
    config.default_copy_mode = Some(enabled);
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取默认输出到原目录
#[tauri::command]
pub fn get_default_same_dir() -> Result<bool, String> {
    Ok(load_config()?.default_same_dir.unwrap_or(true))
}

/// 保存默认输出到原目录
#[tauri::command]
pub fn set_default_same_dir(enabled: bool) -> Result<String, String> {
    let mut config = load_config()?;
    config.default_same_dir = Some(enabled);
    save_config(&config)?;
    Ok("保存成功".to_string())
}

/// 获取语言设置
#[tauri::command]
pub fn get_language() -> Result<String, String> {
    Ok(load_config()?.language.unwrap_or_else(|| "en".to_string()))
}

/// 保存语言设置
#[tauri::command]
pub fn set_language(lang: String) -> Result<String, String> {
    let mut config = load_config()?;
    config.language = Some(lang);
    save_config(&config)?;
    Ok("OK".to_string())
}

/// 检查文件是否存在
#[tauri::command]
pub fn check_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("velo_{name}_{stamp}"))
    }

    #[test]
    fn seeds_language_from_zh_cn_installer_locale() {
        let root = temp_root("zh_seed");
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(
            root.join("config").join("install.json"),
            r#"{"locale":"zh_CN"}"#,
        )
        .unwrap();

        let config = load_config_from_root(&root).unwrap();

        assert_eq!(config.language.as_deref(), Some("zh"));
        assert!(root.join("config").join("config.json").exists());
    }

    #[test]
    fn seeds_language_from_en_us_installer_locale() {
        let root = temp_root("en_seed");
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(
            root.join("config").join("install.json"),
            r#"{"locale":"en_US"}"#,
        )
        .unwrap();

        let config = load_config_from_root(&root).unwrap();

        assert_eq!(config.language.as_deref(), Some("en"));
    }

    #[test]
    fn unsupported_installer_locale_falls_back_to_english() {
        let root = temp_root("fallback_seed");
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(
            root.join("config").join("install.json"),
            r#"{"locale":"fr_FR"}"#,
        )
        .unwrap();

        let config = load_config_from_root(&root).unwrap();

        assert_eq!(config.language.as_deref(), Some("en"));
    }

    #[test]
    fn existing_config_language_wins_over_installer_seed() {
        let root = temp_root("existing_wins");
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(
            root.join("config").join("install.json"),
            r#"{"locale":"zh_CN"}"#,
        )
        .unwrap();
        fs::write(
            root.join("config").join("config.json"),
            r#"{"language":"en"}"#,
        )
        .unwrap();

        let config = load_config_from_root(&root).unwrap();

        assert_eq!(config.language.as_deref(), Some("en"));
    }

    #[test]
    fn non_not_found_config_read_error_does_not_seed_from_installer() {
        let root = temp_root("read_error_no_seed");
        let config_dir = root.join("config");
        let config_path = config_dir.join("config.json");
        fs::create_dir_all(&config_path).unwrap();
        fs::write(config_dir.join("install.json"), r#"{"locale":"zh_CN"}"#).unwrap();

        let config = load_config_from_root(&root);

        assert!(config.is_err());
        assert!(config_path.is_dir());
    }

    #[test]
    fn malformed_config_returns_error_and_does_not_seed_from_installer() {
        let root = temp_root("malformed_config");
        let config_dir = root.join("config");
        let config_path = config_dir.join("config.json");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(config_dir.join("install.json"), r#"{"locale":"zh_CN"}"#).unwrap();
        fs::write(&config_path, r#"{"language":"en""#).unwrap();

        let config = load_config_from_root(&root);

        assert!(config.is_err());
        assert_eq!(fs::read_to_string(&config_path).unwrap(), r#"{"language":"en""#);
    }

    #[test]
    fn installer_locale_mapping_is_case_insensitive() {
        assert_eq!(map_installer_locale(Some("zh-cn")), "zh");
        assert_eq!(map_installer_locale(Some("EN-US")), "en");
    }
}
