// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::path::PathBuf;
use std::time::{ UNIX_EPOCH};
use walkdir::WalkDir;
use serde::Serialize;

#[derive(Serialize)]
struct ProjectInfo {
    path: String,
    last_modified: u64,
    size: u64,
}

#[derive(Serialize)]
struct DriveInfo {
    path: String,
    name: String,
}

#[tauri::command]
async fn get_drives() -> Result<Vec<DriveInfo>, String> {
    let mut drives = Vec::new();
    
    #[cfg(target_os = "windows")]
    {
        for drive_letter in b'A'..=b'Z' {
            let path = format!("{}:\\", drive_letter as char);
            if std::path::Path::new(&path).exists() {
                drives.push(DriveInfo {
                    path: path.clone(),
                    name: path,
                });
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(entries) = std::fs::read_dir("/Volumes") {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    drives.push(DriveInfo {
                        path: path.to_string_lossy().to_string(),
                        name: entry.file_name().to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = std::fs::read_dir("/media") {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    drives.push(DriveInfo {
                        path: path.to_string_lossy().to_string(),
                        name: entry.file_name().to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    Ok(drives)
}

#[tauri::command]
async fn scan_for_projects(root_path: &str) -> Result<Vec<ProjectInfo>, String> {
    let mut projects = Vec::new();
    
    for entry in WalkDir::new(root_path)
        .min_depth(1)
        .max_depth(5) // Limit depth to avoid scanning too deep
        .into_iter()
        .filter_entry(|e| {
            let file_name = e.file_name().to_string_lossy();
            !file_name.starts_with(".") && // Skip hidden directories
            file_name != "node_modules" // Don't recurse into node_modules
        }) {
            if let Ok(entry) = entry {
                if entry.file_name() == "package.json" {
                    if let Some(project_info) = get_project_info(entry.path()) {
                        projects.push(project_info);
                    }
                }
            }
    }

    Ok(projects)
}

fn get_project_info(package_json_path: &std::path::Path) -> Option<ProjectInfo> {
    let project_dir = package_json_path.parent()?;
    let node_modules = project_dir.join("node_modules");
    
    if !node_modules.exists() {
        return None;
    }
    
    let metadata = node_modules.metadata().ok()?;
    let last_modified = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs();
        
    let size = get_directory_size(&node_modules);
    
    Some(ProjectInfo {
        path: project_dir.to_string_lossy().into_owned(),
        last_modified,
        size,
    })
}

fn get_directory_size(path: &PathBuf) -> u64 {
    WalkDir::new(path)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum()
}

#[tauri::command]
async fn delete_node_modules(path: &str) -> Result<(), String> {
    let node_modules = PathBuf::from(path).join("node_modules");
    std::fs::remove_dir_all(node_modules)
        .map_err(|e| format!("Failed to delete node_modules: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            scan_for_projects,
            delete_node_modules,
            get_drives
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
