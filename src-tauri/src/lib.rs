mod cleanup;
mod files;
mod navigation;
mod scan_policy;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
struct DriveInfo {
    path: String,
    name: String,
}

#[tauri::command]
async fn get_drives() -> Result<Vec<DriveInfo>, String> {
    let mut drives = Vec::new();
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let path = PathBuf::from(home);
        if path.is_dir() {
            drives.push(DriveInfo {
                path: path.to_string_lossy().into_owned(),
                name: "Home folder".into(),
            });
        }
    }
    #[cfg(target_os = "windows")]
    for letter in b'A'..=b'Z' {
        let path = format!("{}:\\", letter as char);
        if std::path::Path::new(&path).exists() {
            drives.push(DriveInfo {
                name: format!("Drive {}:", letter as char),
                path,
            });
        }
    }
    #[cfg(not(target_os = "windows"))]
    for mount in if cfg!(target_os = "macos") {
        vec!["/Volumes"]
    } else {
        vec!["/media", "/mnt"]
    } {
        if let Ok(entries) = std::fs::read_dir(mount) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    drives.push(DriveInfo {
                        name: entry.file_name().to_string_lossy().into_owned(),
                        path: entry.path().to_string_lossy().into_owned(),
                    });
                }
            }
        }
    }
    Ok(drives)
}

#[tauri::command]
async fn scan_for_projects(
    root_path: String,
    max_depth: Option<usize>,
    include_hidden: Option<bool>,
) -> Result<cleanup::ScanReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cleanup::scan(
            &root_path,
            max_depth.unwrap_or(8),
            include_hidden.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_project_directories(
    path: String,
    directories: Vec<String>,
) -> Result<cleanup::CleanupResult, String> {
    tauri::async_runtime::spawn_blocking(move || cleanup::cleanup(&path, directories))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_folder_files(
    root_path: String,
    recursive: bool,
    state: tauri::State<'_, std::sync::Arc<files::FileRegistry>>,
) -> Result<files::FileReport, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || files::scan(&root_path, recursive, &registry))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_selected_files(
    paths: Vec<String>,
    state: tauri::State<'_, std::sync::Arc<files::FileRegistry>>,
) -> Result<files::FileCleanup, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || files::cleanup(paths, &registry))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(std::sync::Arc::new(files::FileRegistry::default()))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_for_projects,
            delete_project_directories,
            get_drives,
            scan_folder_files,
            delete_selected_files,
            navigation::select_folders,
            navigation::validate_scan_folder,
            navigation::open_folder,
            navigation::reveal_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
