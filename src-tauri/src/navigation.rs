use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub fn directory(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path)
        .canonicalize()
        .map_err(|error| format!("Cannot open this folder: {error}"))?;
    if !path.is_dir() {
        return Err("Choose an existing folder, not a file.".into());
    }
    if path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("app"))
    {
        return Err("Choose a folder rather than an application bundle.".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn validate_scan_folder(path: String) -> Result<String, String> {
    let path = directory(&path)?;
    crate::scan_policy::check_root(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn select_folders(
    app: tauri::AppHandle,
    multiple: bool,
    default_path: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut picker = app
            .dialog()
            .file()
            .set_title("Choose folders to scan")
            .set_can_create_directories(false);
        if let Some(window) = app.get_webview_window("main") {
            picker = picker.set_parent(&window);
        }
        if let Some(path) = default_path.and_then(|path| directory(&path).ok()) {
            picker = picker.set_directory(path);
        }
        let picked = if multiple {
            picker.blocking_pick_folders()
        } else {
            picker.blocking_pick_folder().map(|path| vec![path])
        };
        picked
            .unwrap_or_default()
            .into_iter()
            .map(|path| {
                let path = path.into_path().map_err(|error| error.to_string())?;
                let root = directory(&path.to_string_lossy())?;
                crate::scan_policy::check_root(&root)?;
                Ok(root.to_string_lossy().into_owned())
            })
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn open_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = directory(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|error| format!("Could not open the folder in your file manager: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn reveal_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("Cannot locate this file: {error}"))?;
    if !path.is_file() {
        return Err("This file has moved or is no longer available. Scan again.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.opener()
            .reveal_item_in_dir(path)
            .map_err(|error| format!("Could not show the file in your file manager: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folder_navigation_accepts_directories_but_never_files_or_application_bundles() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("folder with spaces");
        std::fs::create_dir(&path).unwrap();
        assert_eq!(
            directory(path.to_str().unwrap()).unwrap(),
            path.canonicalize().unwrap()
        );
        let file = root.path().join("script.exe");
        std::fs::write(&file, "do not launch").unwrap();
        assert!(directory(file.to_str().unwrap()).is_err());
        let app = root.path().join("Tool.APP");
        std::fs::create_dir(&app).unwrap();
        assert!(directory(app.to_str().unwrap()).is_err());
        assert!(directory(root.path().join("missing").to_str().unwrap()).is_err());
    }
}
