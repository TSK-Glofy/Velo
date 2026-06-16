use serde::Serialize;
use std::fs;
use std::path::Path;

/// 单个清理类别的占用情况（字节数 + 文件数），供前端展示
#[derive(Serialize, Default, Clone, Copy)]
pub struct CategoryUsage {
    pub bytes: u64,
    pub files: u64,
}

/// 各清理类别的存储占用汇总
#[derive(Serialize, Default)]
pub struct StorageUsage {
    pub task_logs: CategoryUsage,
    pub previews: CategoryUsage,
    pub imported_images: CategoryUsage,
    pub task_history: CategoryUsage,
}

/// 清理已导入图片后的结果，告知前端当前背景是否被一并清除
#[derive(Serialize, Default)]
pub struct ClearImagesResult {
    pub removed: u64,
    pub background_cleared: bool,
}

/// 统计目录下一层文件的总大小与数量（不递归）
fn dir_usage(dir: &Path) -> CategoryUsage {
    let mut usage = CategoryUsage::default();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    usage.bytes += meta.len();
                    usage.files += 1;
                }
            }
        }
    }
    usage
}

/// 统计单个文件的大小（不存在则为 0）
fn file_usage(path: &Path) -> CategoryUsage {
    match fs::metadata(path) {
        Ok(meta) if meta.is_file() => CategoryUsage {
            bytes: meta.len(),
            files: 1,
        },
        _ => CategoryUsage::default(),
    }
}

/// 删除目录下一层的所有文件（保留目录本身），返回删除的文件数
fn clear_dir_files(dir: &Path) -> Result<u64, String> {
    let mut removed = 0;
    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                    removed += 1;
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    Ok(removed)
}

pub fn storage_usage_from_root(root: &Path) -> StorageUsage {
    StorageUsage {
        task_logs: dir_usage(&crate::paths::logs_dir_from_root(root)),
        previews: dir_usage(&crate::paths::preview_dir_from_root(root)),
        imported_images: dir_usage(&crate::paths::background_dir_from_root(root)),
        task_history: file_usage(&crate::paths::jobs_file_from_root(root)),
    }
}

pub fn clear_task_logs_from_root(root: &Path) -> Result<u64, String> {
    clear_dir_files(&crate::paths::logs_dir_from_root(root))
}

pub fn clear_previews_from_root(root: &Path) -> Result<u64, String> {
    clear_dir_files(&crate::paths::preview_dir_from_root(root))
}

/// 删除所有已导入的背景图片；若当前背景指向该目录（相对路径），一并从配置中清除
pub fn clear_imported_images_from_root(root: &Path) -> Result<ClearImagesResult, String> {
    let removed = clear_dir_files(&crate::paths::background_dir_from_root(root))?;
    let mut config = crate::config::load_config_from_root(root)?;
    // 导入的背景以相对路径（pic/background/...）存储；绝对路径来自外部文件，保留不动
    let points_into_imports = config
        .background_image
        .as_deref()
        .map(|stored| !std::path::Path::new(stored).is_absolute())
        .unwrap_or(false);
    if points_into_imports {
        config.background_image = None;
        crate::config::save_config_to_root(root, &config)?;
    }
    Ok(ClearImagesResult {
        removed,
        background_cleared: points_into_imports,
    })
}

// === Tauri 命令 ===

#[tauri::command]
pub fn get_storage_usage() -> Result<StorageUsage, String> {
    Ok(storage_usage_from_root(&crate::paths::app_root()?))
}

#[tauri::command]
pub fn clear_task_logs() -> Result<u64, String> {
    clear_task_logs_from_root(&crate::paths::app_root()?)
}

#[tauri::command]
pub fn clear_previews() -> Result<u64, String> {
    clear_previews_from_root(&crate::paths::app_root()?)
}

#[tauri::command]
pub fn clear_imported_images() -> Result<ClearImagesResult, String> {
    clear_imported_images_from_root(&crate::paths::app_root()?)
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
        std::env::temp_dir().join(format!("velo_maint_{name}_{stamp}"))
    }

    #[test]
    fn usage_counts_files_and_clearing_removes_them() {
        let root = temp_root("usage");
        let logs = crate::paths::logs_dir_from_root(&root);
        fs::create_dir_all(&logs).unwrap();
        fs::write(logs.join("a.log"), b"hello").unwrap();
        fs::write(logs.join("b.log"), b"world!").unwrap();

        let usage = storage_usage_from_root(&root);
        assert_eq!(usage.task_logs.files, 2);
        assert_eq!(usage.task_logs.bytes, 11);

        let removed = clear_task_logs_from_root(&root).unwrap();
        assert_eq!(removed, 2);
        assert_eq!(storage_usage_from_root(&root).task_logs.files, 0);
        assert!(logs.exists(), "directory itself should be preserved");
    }

    #[test]
    fn clearing_missing_dir_is_ok() {
        let root = temp_root("missing");
        assert_eq!(clear_previews_from_root(&root).unwrap(), 0);
    }

    #[test]
    fn clearing_imported_images_clears_relative_background() {
        let root = temp_root("imgs_rel");
        let bg_dir = crate::paths::background_dir_from_root(&root);
        fs::create_dir_all(&bg_dir).unwrap();
        fs::write(bg_dir.join("custom.png"), b"png").unwrap();
        let config_dir = root.join("config");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("config.json"),
            r#"{"background_image":"pic/background/custom.png"}"#,
        )
        .unwrap();

        let result = clear_imported_images_from_root(&root).unwrap();
        assert_eq!(result.removed, 1);
        assert!(result.background_cleared);
        assert_eq!(
            crate::config::load_config_from_root(&root)
                .unwrap()
                .background_image,
            None
        );
    }

    #[test]
    fn clearing_imported_images_keeps_absolute_background() {
        let root = temp_root("imgs_abs");
        let bg_dir = crate::paths::background_dir_from_root(&root);
        fs::create_dir_all(&bg_dir).unwrap();
        let config_dir = root.join("config");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("config.json"),
            r#"{"background_image":"C:/external/bg.png"}"#,
        )
        .unwrap();

        let result = clear_imported_images_from_root(&root).unwrap();
        assert!(!result.background_cleared);
        assert_eq!(
            crate::config::load_config_from_root(&root)
                .unwrap()
                .background_image
                .as_deref(),
            Some("C:/external/bg.png")
        );
    }
}
