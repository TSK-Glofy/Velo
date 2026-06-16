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

    let language = read_installer_language_from_root(root)?;
    let config = AppConfig {
        language: Some(language),
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

fn read_installer_language_from_root(root: &std::path::Path) -> Result<String, String> {
    let path = crate::paths::install_defaults_file_from_root(root);
    match fs::read_to_string(&path) {
        Ok(content) => {
            let defaults = serde_json::from_str::<InstallDefaults>(&content)
                .map_err(|e| format!("Failed to parse installer defaults {}: {}", path.display(), e))?;
            Ok(map_installer_locale(defaults.locale.as_deref()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok("en".to_string()),
        Err(error) => Err(format!(
            "Failed to read installer defaults {}: {}",
            path.display(),
            error
        )),
    }
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

/// 获取用户设置的背景图路径；存储的相对路径会拼回安装目录
#[tauri::command]
pub fn get_background_image() -> Result<Option<String>, String> {
    let Some(stored) = load_config()?.background_image else {
        return Ok(None);
    };
    let path = std::path::Path::new(&stored);
    if path.is_absolute() {
        return Ok(Some(stored));
    }
    let resolved = crate::paths::app_owned_path(&stored)?;
    Ok(Some(resolved.to_string_lossy().to_string()))
}

/// 保存背景图路径。若在安装根目录内，自动转为相对路径以保证便携。
#[tauri::command]
pub fn set_background_image(path: String) -> Result<String, String> {
    if !std::path::Path::new(&path).exists() {
        return Err("文件不存在".to_string());
    }
    let stored = match crate::paths::app_root() {
        Ok(root) => std::path::Path::new(&path)
            .strip_prefix(&root)
            .ok()
            .map(|rel| rel.to_string_lossy().replace('\\', "/"))
            .unwrap_or(path),
        Err(_) => path,
    };
    let mut config = load_config()?;
    config.background_image = Some(stored);
    save_config(&config)?;
    Ok("保存成功".to_string())
}

fn normalize_app_relative_path(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn unique_background_filename(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let source = std::path::Path::new(filename);
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("background");
    let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("");
    for idx in 1.. {
        let name = if ext.is_empty() {
            format!("{stem}({idx})")
        } else {
            format!("{stem}({idx}).{ext}")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

pub fn import_background_image_for_root(
    root: &std::path::Path,
    path: String,
) -> Result<String, String> {
    let source = std::path::PathBuf::from(&path);
    if !source.exists() {
        return Err("文件不存在".to_string());
    }
    let filename = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let bg_dir = crate::paths::background_dir_from_root(root);
    fs::create_dir_all(&bg_dir).map_err(|e| e.to_string())?;
    let dest = unique_background_filename(&bg_dir, filename);
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;

    let rel = dest
        .strip_prefix(root)
        .map_err(|e| e.to_string())?;
    let rel = normalize_app_relative_path(rel);
    let mut config = load_config_from_root(root)?;
    config.background_image = Some(rel);
    save_config_to_root(root, &config)?;
    Ok(dest.to_string_lossy().to_string())
}

/// 将用户选择的图片复制到 <install>/pic/background/ 并保存相对路径
#[tauri::command]
pub fn import_background_image(path: String) -> Result<String, String> {
    let root = crate::paths::app_root()?;
    import_background_image_for_root(&root, path)
}

/// 列出 <install>/pic/background/ 下的所有图片（绝对路径，按文件名排序）
#[tauri::command]
pub fn list_background_images() -> Result<Vec<String>, String> {
    let root = crate::paths::app_root()?;
    let bg_dir = crate::paths::background_dir_from_root(&root);
    if !bg_dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&bg_dir).map_err(|e| e.to_string())?;
    let mut items: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            items.push(path.to_string_lossy().to_string());
        }
    }
    items.sort();
    Ok(items)
}

/// 清除背景图设置（仅从 config 移除，不删除文件）
#[tauri::command]
pub fn clear_background_image() -> Result<String, String> {
    let mut config = load_config()?;
    config.background_image = None;
    save_config(&config)?;
    Ok("OK".to_string())
}

pub fn set_max_concurrent_jobs_for_root(
    root: &std::path::Path,
    value: u32,
) -> Result<(), String> {
    let mut config = load_config_from_root(root)?;
    config.max_concurrent_jobs = Some(value.clamp(1, 4));
    save_config_to_root(root, &config)
}

#[tauri::command]
pub fn get_max_concurrent_jobs() -> Result<u32, String> {
    Ok(load_config()?
        .max_concurrent_jobs
        .unwrap_or(1)
        .clamp(1, 4))
}

#[tauri::command]
pub fn set_max_concurrent_jobs(value: u32) -> Result<String, String> {
    let root = crate::paths::app_root()?;
    set_max_concurrent_jobs_for_root(&root, value)?;
    Ok("OK".to_string())
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
    fn missing_installer_seed_defaults_to_english_and_creates_config() {
        let root = temp_root("missing_seed");
        fs::create_dir_all(root.join("config")).unwrap();

        let config = load_config_from_root(&root).unwrap();

        assert_eq!(config.language.as_deref(), Some("en"));
        assert!(root.join("config").join("config.json").exists());
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
    fn malformed_installer_seed_returns_error_and_does_not_create_config() {
        let root = temp_root("malformed_seed");
        let config_dir = root.join("config");
        let config_path = config_dir.join("config.json");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(config_dir.join("install.json"), r#"{"locale":"zh_CN""#).unwrap();

        let config = load_config_from_root(&root);

        assert!(config.is_err());
        assert!(!config_path.exists());
    }

    #[test]
    fn installer_locale_mapping_is_case_insensitive() {
        assert_eq!(map_installer_locale(Some("zh-cn")), "zh");
        assert_eq!(map_installer_locale(Some("EN-US")), "en");
    }

    #[test]
    fn copies_background_into_install_folder_and_stores_relative_path() {
        let root = temp_root("bg_import");
        let source_dir = temp_root("bg_source");
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("custom.png");
        fs::write(&source, b"png bytes").unwrap();

        let imported =
            import_background_image_for_root(&root, source.to_string_lossy().to_string()).unwrap();

        assert!(
            imported.ends_with(r"pic\background\custom.png")
                || imported.ends_with("pic/background/custom.png")
        );
        let config = load_config_from_root(&root).unwrap();
        assert_eq!(
            config.background_image.as_deref(),
            Some("pic/background/custom.png")
        );
        assert_eq!(
            fs::read(crate::paths::background_dir_from_root(&root).join("custom.png")).unwrap(),
            b"png bytes"
        );
    }

    #[test]
    fn background_import_uniquifies_filename_when_destination_exists() {
        let root = temp_root("bg_dupe");
        let source_dir = temp_root("bg_dupe_src");
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("bg.png");
        fs::write(&source, b"a").unwrap();
        let bg_dir = crate::paths::background_dir_from_root(&root);
        fs::create_dir_all(&bg_dir).unwrap();
        fs::write(bg_dir.join("bg.png"), b"existing").unwrap();

        let imported =
            import_background_image_for_root(&root, source.to_string_lossy().to_string()).unwrap();

        assert!(imported.ends_with("bg(1).png"));
    }

    #[test]
    fn max_concurrent_jobs_is_clamped_to_supported_range() {
        let root = temp_root("max_jobs");
        set_max_concurrent_jobs_for_root(&root, 0).unwrap();
        assert_eq!(
            load_config_from_root(&root).unwrap().max_concurrent_jobs,
            Some(1)
        );
        set_max_concurrent_jobs_for_root(&root, 99).unwrap();
        assert_eq!(
            load_config_from_root(&root).unwrap().max_concurrent_jobs,
            Some(4)
        );
    }
}
