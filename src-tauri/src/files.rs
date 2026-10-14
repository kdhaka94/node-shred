use crate::scan_policy::{self, ScanFeedback};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    sync::Mutex,
    time::UNIX_EPOCH,
};
use walkdir::WalkDir;

#[derive(Clone, Debug, PartialEq)]
struct Fingerprint {
    size: u64,
    modified: std::time::SystemTime,
}
#[derive(Default)]
pub struct FileRegistry(Mutex<HashMap<String, Fingerprint>>);
#[derive(Clone, Serialize, Debug)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub last_modified: u64,
    pub kind: String,
}
#[derive(Serialize)]
pub struct FileReport {
    pub feedback: ScanFeedback,
    pub files: Vec<FileInfo>,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
pub struct FileCleanup {
    pub removed: Vec<String>,
    pub bytes_freed: u64,
    pub errors: Vec<String>,
}

fn kind(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "zip" | "gz" | "tar" | "rar" | "7z" | "bz2" | "xz" => "Archives",
        "dmg" | "pkg" | "exe" | "msi" | "deb" | "rpm" | "appimage" | "iso" => "Installers",
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "mp3" | "wav" | "flac" => "Media",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "heic" => "Images",
        "pdf" | "doc" | "docx" | "txt" | "csv" | "xlsx" | "pptx" => "Documents",
        _ => "Other",
    }
}

pub fn scan(root: &str, recursive: bool, registry: &FileRegistry) -> Result<FileReport, String> {
    let root = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("Cannot open folder: {e}"))?;
    if !root.is_dir() {
        return Err("Choose a folder to scan".into());
    }
    scan_policy::check_root(&root)?;
    let system_skips = std::cell::Cell::new(0);
    let mut report = FileReport {
        feedback: ScanFeedback::default(),
        files: Vec::new(),
        warnings: Vec::new(),
    };
    let mut registered = registry.0.lock().map_err(|e| e.to_string())?;
    registered.clear();
    for entry in WalkDir::new(&root)
        .min_depth(1)
        .max_depth(if recursive { 16 } else { 1 })
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if cfg!(target_os = "macos") && scan_policy::skip_macos_location(e.path()) {
                system_skips.set(system_skips.get() + 1);
                return false;
            }
            !e.file_name().to_string_lossy().starts_with('.')
                && !["node_modules", "target", "vendor", "venv"]
                    .contains(&e.file_name().to_string_lossy().as_ref())
        })
    {
        match entry {
            Ok(entry) if entry.file_type().is_file() => {
                let metadata = match entry.metadata() {
                    Ok(m) => m,
                    Err(e) => {
                        if !e.io_error().is_some_and(|error| {
                            report.feedback.permission_skip(error, entry.path())
                        }) && report.warnings.len() < 50
                        {
                            report.warnings.push(e.to_string());
                        }
                        continue;
                    }
                };
                let modified = match metadata.modified() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let path = entry.path().to_string_lossy().into_owned();
                registered.insert(
                    path.clone(),
                    Fingerprint {
                        size: metadata.len(),
                        modified,
                    },
                );
                report.files.push(FileInfo {
                    path,
                    name: entry.file_name().to_string_lossy().into_owned(),
                    size: metadata.len(),
                    last_modified: modified
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0),
                    kind: kind(entry.path()).into(),
                });
                if report.files.len() >= 5000 {
                    report.warnings.push(
                        "Showing the first 5,000 files. Choose a smaller folder to scan the rest."
                            .into(),
                    );
                    break;
                }
            }
            Err(e) => {
                let denied = e.io_error().is_some_and(|error| {
                    report
                        .feedback
                        .permission_skip(error, e.path().unwrap_or(&root))
                });
                if !denied && report.warnings.len() < 50 {
                    report.warnings.push(e.to_string());
                }
            }
            _ => (),
        }
    }
    report.feedback.skipped_system = system_skips.get();
    report.files.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(report)
}

pub fn cleanup(paths: Vec<String>, registry: &FileRegistry) -> Result<FileCleanup, String> {
    let mut registered = registry.0.lock().map_err(|e| e.to_string())?;
    let mut validated = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        if !seen.insert(path.clone()) {
            continue;
        }
        let expected = registered
            .get(&path)
            .ok_or("This file was not in the latest scan. Scan again before deleting.")?;
        let metadata =
            fs::symlink_metadata(&path).map_err(|e| format!("File changed: {path}: {e}"))?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || Path::new(&path).canonicalize().map_err(|e| e.to_string())? != Path::new(&path)
            || metadata.len() != expected.size
            || metadata.modified().ok() != Some(expected.modified)
        {
            return Err(format!("File changed since scanning; scan again: {path}"));
        }
        validated.push((path, expected.size));
    }
    let mut result = FileCleanup {
        removed: Vec::new(),
        bytes_freed: 0,
        errors: Vec::new(),
    };
    for (path, size) in validated {
        match fs::remove_file(&path) {
            Ok(()) => {
                registered.remove(&path);
                result.bytes_freed += size;
                result.removed.push(path);
            }
            Err(e) => result.errors.push(format!("Could not delete {path}: {e}")),
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn unreadable_children_are_skipped_but_an_unreadable_root_is_an_error() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let blocked = root.path().join("protected");
        std::fs::create_dir(&blocked).unwrap();
        std::fs::write(root.path().join("package.json"), "{}").unwrap();
        std::fs::create_dir(root.path().join("dist")).unwrap();
        std::fs::write(root.path().join("keep.txt"), "keep").unwrap();
        std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o000)).unwrap();
        let report = scan(
            root.path().to_str().unwrap(),
            true,
            &FileRegistry::default(),
        )
        .unwrap();
        std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(report.feedback.skipped_permissions, 1);
        assert!(report.warnings.is_empty());
        assert!(report.files.iter().any(|file| file.name == "keep.txt"));
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o000)).unwrap();
        let error = scan(
            root.path().to_str().unwrap(),
            true,
            &FileRegistry::default(),
        )
        .err()
        .unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(error.contains("Cannot read the selected folder"));
    }

    use super::*;
    #[test]
    fn lists_files_by_type_and_deletes_only_reviewed_files() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("archive.zip"), "12345").unwrap();
        fs::write(folder.path().join("keep.txt"), "keep").unwrap();
        let registry = FileRegistry::default();
        let report = scan(folder.path().to_str().unwrap(), false, &registry).unwrap();
        assert_eq!(report.files[0].kind, "Archives");
        let result = cleanup(vec![report.files[0].path.clone()], &registry).unwrap();
        assert_eq!(result.bytes_freed, 5);
        assert!(folder.path().join("keep.txt").exists());
        assert!(cleanup(
            vec![folder
                .path()
                .join("unknown.txt")
                .to_string_lossy()
                .into_owned()],
            &registry
        )
        .is_err());
    }
    #[test]
    fn a_new_scan_invalidates_previous_file_selection() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        fs::write(first.path().join("file.txt"), "keep").unwrap();
        let registry = FileRegistry::default();
        let original = scan(first.path().to_str().unwrap(), false, &registry).unwrap();
        scan(second.path().to_str().unwrap(), false, &registry).unwrap();
        assert!(cleanup(vec![original.files[0].path.clone()], &registry).is_err());
        assert!(first.path().join("file.txt").exists());
    }
    #[test]
    fn changed_file_blocks_the_whole_request() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("a.txt"), "a").unwrap();
        fs::write(folder.path().join("b.txt"), "b").unwrap();
        let registry = FileRegistry::default();
        let report = scan(folder.path().to_str().unwrap(), false, &registry).unwrap();
        fs::write(folder.path().join("b.txt"), "changed").unwrap();
        assert!(cleanup(
            report.files.iter().map(|f| f.path.clone()).collect(),
            &registry
        )
        .is_err());
        assert!(folder.path().join("a.txt").exists());
    }
    #[test]
    fn recursion_is_opt_in_and_hidden_files_are_skipped() {
        let folder = tempfile::tempdir().unwrap();
        fs::create_dir(folder.path().join("sub")).unwrap();
        fs::write(folder.path().join("sub/file.txt"), "file").unwrap();
        fs::write(folder.path().join(".secret"), "keep").unwrap();
        let registry = FileRegistry::default();
        assert!(scan(folder.path().to_str().unwrap(), false, &registry)
            .unwrap()
            .files
            .is_empty());
        assert_eq!(
            scan(folder.path().to_str().unwrap(), true, &registry)
                .unwrap()
                .files
                .len(),
            1
        );
    }
    #[cfg(unix)]
    #[test]
    fn replacement_symlink_is_rejected() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("file.txt");
        fs::write(&path, "file").unwrap();
        let registry = FileRegistry::default();
        let report = scan(folder.path().to_str().unwrap(), false, &registry).unwrap();
        let external = tempfile::NamedTempFile::new().unwrap();
        fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink(external.path(), &path).unwrap();
        assert!(cleanup(vec![report.files[0].path.clone()], &registry).is_err());
        assert!(external.path().exists());
    }
}
