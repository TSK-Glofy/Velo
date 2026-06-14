use std::path::{Component, Path, PathBuf};

pub fn app_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Unable to locate executable: {e}"))?;
    app_root_from_exe(&exe)
}

pub fn app_root_from_exe(exe: &Path) -> Result<PathBuf, String> {
    let exe = normalize_windows_exe_path(exe);
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Executable path has no parent directory".to_string())
}

pub fn config_file() -> Result<PathBuf, String> {
    Ok(config_file_from_root(&app_root()?))
}

pub fn install_defaults_file() -> Result<PathBuf, String> {
    Ok(install_defaults_file_from_root(&app_root()?))
}

pub fn jobs_file() -> Result<PathBuf, String> {
    Ok(jobs_file_from_root(&app_root()?))
}

pub fn job_log_file(task_id: &str) -> Result<PathBuf, String> {
    Ok(job_log_file_from_root(&app_root()?, task_id))
}

pub fn preview_file(task_id: &str) -> Result<PathBuf, String> {
    Ok(preview_file_from_root(&app_root()?, task_id))
}

pub fn app_owned_path(relative: &str) -> Result<PathBuf, String> {
    app_owned_path_from_root(&app_root()?, relative)
}

pub fn config_file_from_root(root: &Path) -> PathBuf {
    root.join("config").join("config.json")
}

pub fn install_defaults_file_from_root(root: &Path) -> PathBuf {
    root.join("config").join("install.json")
}

pub fn jobs_file_from_root(root: &Path) -> PathBuf {
    root.join("jobs").join("jobs.jsonl")
}

pub fn job_log_file_from_root(root: &Path, task_id: &str) -> PathBuf {
    let safe_task_id = sanitize_task_id(task_id);
    root.join("jobs").join("logs").join(format!("{safe_task_id}.log"))
}

pub fn preview_file_from_root(root: &Path, task_id: &str) -> PathBuf {
    let safe_task_id = sanitize_task_id(task_id);
    root.join("preview").join(format!("{safe_task_id}.jpg"))
}

pub fn background_dir_from_root(root: &Path) -> PathBuf {
    root.join("pic").join("background")
}

pub fn app_owned_path_from_root(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if rel.components().any(|c| matches!(c, Component::ParentDir))
        || rel.has_root()
        || has_forbidden_windows_components(rel)
    {
        return Err("App-owned paths must be relative to the install directory".to_string());
    }
    Ok(root.join(rel))
}

#[cfg(windows)]
fn has_forbidden_windows_components(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
}

#[cfg(not(windows))]
fn has_forbidden_windows_components(_: &Path) -> bool {
    false
}

#[cfg(windows)]
fn normalize_windows_exe_path(path: &Path) -> PathBuf {
    let normalized = path.to_string_lossy().replace('/', "\\");
    normalized
        .strip_prefix(r"\\?\")
        .map(|rest| {
            if let Some(unc) = rest.strip_prefix("UNC\\") {
                PathBuf::from(format!(r"\\{unc}"))
            } else {
                PathBuf::from(rest)
            }
        })
        .unwrap_or_else(|| path.to_path_buf())
}

#[cfg(not(windows))]
fn normalize_windows_exe_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn sanitize_task_id(task_id: &str) -> String {
    let mut safe = String::with_capacity(task_id.len());
    for ch in task_id.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
            safe.push(ch);
        } else {
            safe.push('_');
        }
    }

    if safe == "." || safe == ".." || safe.is_empty() {
        safe.push('_');
    }

    safe
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    #[cfg(windows)]
    fn derives_app_root_from_exe_path() {
        let root = app_root_from_exe(Path::new(r"C:\Users\me\Velo\velo.exe")).unwrap();
        assert_eq!(root, Path::new(r"C:\Users\me\Velo"));
    }

    #[test]
    #[cfg(not(windows))]
    fn derives_app_root_from_exe_path() {
        let root = app_root_from_exe(Path::new("/home/me/Velo/velo.exe")).unwrap();
        assert_eq!(root, Path::new("/home/me/Velo"));
    }

    #[test]
    fn builds_install_relative_paths() {
        let root = Path::new(r"D:\Apps\Velo");
        assert_eq!(config_file_from_root(root), root.join("config").join("config.json"));
        assert_eq!(install_defaults_file_from_root(root), root.join("config").join("install.json"));
        assert_eq!(jobs_file_from_root(root), root.join("jobs").join("jobs.jsonl"));
        assert_eq!(job_log_file_from_root(root, "task_1"), root.join("jobs").join("logs").join("task_1.log"));
        assert_eq!(preview_file_from_root(root, "task_1"), root.join("preview").join("task_1.jpg"));
    }

    #[test]
    fn rejects_absolute_app_owned_relative_path() {
        let err = app_owned_path_from_root(Path::new(r"D:\Apps\Velo"), r"C:\temp\a.png").unwrap_err();
        assert!(err.contains("relative"));
    }

    #[test]
    fn rejects_parent_directory_traversal() {
        let err = app_owned_path_from_root(Path::new(r"D:\Apps\Velo"), r"..\outside.txt").unwrap_err();
        assert!(err.contains("relative"));
    }

    #[test]
    #[cfg(windows)]
    fn rejects_windows_unc_path() {
        let err = app_owned_path_from_root(Path::new(r"D:\Apps\Velo"), r"\\temp\a.png").unwrap_err();
        assert!(err.contains("relative"));
    }

    #[test]
    #[cfg(windows)]
    fn rejects_windows_prefixed_relative_path() {
        let err = app_owned_path_from_root(Path::new(r"D:\Apps\Velo"), r"C:temp\a.png").unwrap_err();
        assert!(err.contains("relative"));
    }

    #[test]
    #[cfg(windows)]
    fn rejects_windows_root_dir_relative_path() {
        let err = app_owned_path_from_root(Path::new(r"D:\Apps\Velo"), r"\temp\a.png").unwrap_err();
        assert!(err.contains("relative"));
    }

    #[test]
    #[cfg(windows)]
    fn normalizes_extended_length_exe_paths() {
        let root = app_root_from_exe(Path::new(r"\\?\C:\Users\me\Velo\velo.exe")).unwrap();
        assert_eq!(root, Path::new(r"C:\Users\me\Velo"));
    }

    #[test]
    #[cfg(windows)]
    fn normalizes_extended_length_unc_exe_paths() {
        let root = app_root_from_exe(Path::new(r"\\?\UNC\server\share\Velo\velo.exe")).unwrap();
        assert_eq!(root, Path::new(r"\\server\share\Velo"));
    }

    #[test]
    fn bad_task_ids_do_not_escape_log_or_preview_paths() {
        let root = Path::new(r"D:\Apps\Velo");
        let bad_task_ids = [r"..\outside", "nested/path", "task id"];

    for task_id in bad_task_ids {
            let log = job_log_file_from_root(root, task_id);
            let preview = preview_file_from_root(root, task_id);
            assert_eq!(log.parent(), Some(root.join("jobs").join("logs")).as_deref());
            assert_eq!(preview.parent(), Some(root.join("preview")).as_deref());

            let log_name = log.file_name().unwrap().to_string_lossy();
            let preview_name = preview.file_name().unwrap().to_string_lossy();
            assert!(!log_name.contains('\\') && !log_name.contains('/'));
            assert!(!preview_name.contains('\\') && !preview_name.contains('/'));
        }
    }
}
