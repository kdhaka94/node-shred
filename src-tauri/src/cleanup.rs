use crate::scan_policy::{self, ScanFeedback};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use walkdir::WalkDir;

#[derive(Clone, Serialize, Debug)]
pub struct DirectoryInfo {
    pub name: String,
    pub category: String,
    pub size: u64,
    pub last_modified: u64,
    pub complete: bool,
}
#[derive(Serialize, Debug)]
pub struct ProjectInfo {
    pub path: String,
    pub kind: String,
    pub last_modified: u64,
    pub size: u64,
    pub directories: Vec<DirectoryInfo>,
}
#[derive(Serialize, Debug)]
pub struct ScanReport {
    pub feedback: ScanFeedback,
    pub projects: Vec<ProjectInfo>,
    pub warnings: Vec<String>,
}
#[derive(Serialize, Debug)]
pub struct CleanupResult {
    pub removed: Vec<DirectoryInfo>,
    pub errors: Vec<String>,
    pub remaining: Option<ProjectInfo>,
}

fn kinds(path: &Path) -> Vec<&'static str> {
    let mut kinds = Vec::new();
    if path.join("package.json").is_file() {
        kinds.push("JavaScript");
    }
    if path.join("Cargo.toml").is_file() {
        kinds.push("Rust");
    }
    if ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"]
        .iter()
        .any(|name| path.join(name).is_file())
    {
        kinds.push("Python");
    }
    if path.join("composer.json").is_file() {
        kinds.push("PHP");
    }
    kinds
}

fn rules(kinds: &[&str]) -> Vec<(&'static str, &'static str)> {
    let mut result = vec![(".cache", "cache")];
    if kinds.contains(&"JavaScript") {
        result.extend([
            ("node_modules", "dependencies"),
            ("dist", "build"),
            ("build", "build"),
            ("out", "build"),
            (".next", "build"),
            (".nuxt", "build"),
            (".output", "build"),
            (".svelte-kit", "build"),
            (".turbo", "cache"),
            (".parcel-cache", "cache"),
            (".webpack", "cache"),
            (".angular/cache", "cache"),
        ]);
    }
    if kinds.contains(&"Rust") {
        result.push(("target", "build"));
    }
    if kinds.contains(&"Python") {
        result.extend([
            (".venv", "dependencies"),
            ("venv", "dependencies"),
            ("__pycache__", "cache"),
            (".pytest_cache", "cache"),
            (".mypy_cache", "cache"),
            (".ruff_cache", "cache"),
            ("build", "build"),
            ("dist", "build"),
        ]);
    }
    if kinds.contains(&"PHP") {
        result.push(("vendor", "dependencies"));
    }
    let mut seen = HashSet::new();
    result.retain(|(name, _)| seen.insert(*name));
    result
}

fn modified(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// Check every component, including parents of nested cache directories. Never traverse links.
fn checked_directory(root: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    let mut target = root.to_path_buf();
    for component in Path::new(name).components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err("Invalid cleanup path".into());
        }
        target.push(component);
        match fs::symlink_metadata(&target) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err(format!("Skipped symbolic link: {name}"))
            }
            Ok(m) if !m.is_dir() => return Err(format!("Not a directory: {name}")),
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("Cannot read {name}: {e}")),
        }
    }
    let resolved = target.canonicalize().map_err(|e| e.to_string())?;
    if !resolved.starts_with(root) || resolved == root {
        return Err("Cleanup target escapes its project".into());
    }
    Ok(Some(target))
}

fn measure(path: &Path) -> (u64, bool) {
    let mut size = 0u64;
    let mut complete = true;
    for entry in WalkDir::new(path).follow_links(false) {
        match entry {
            Ok(entry) if entry.file_type().is_file() => match entry.metadata() {
                Ok(m) => size = size.saturating_add(m.len()),
                Err(_) => complete = false,
            },
            Ok(_) => (),
            Err(_) => complete = false,
        }
    }
    (size, complete)
}

pub fn inspect_project(path: &Path) -> Option<ProjectInfo> {
    let root = path.canonicalize().ok()?;
    let types = kinds(&root);
    if types.is_empty() {
        return None;
    }
    let directories: Vec<_> = rules(&types)
        .into_iter()
        .filter_map(|(name, category)| {
            let target = checked_directory(&root, name).ok()??;
            let (size, complete) = measure(&target);
            Some(DirectoryInfo {
                name: name.into(),
                category: category.into(),
                size,
                last_modified: modified(&target),
                complete,
            })
        })
        .collect();
    if directories.is_empty() {
        return None;
    }
    let last_modified = directories
        .iter()
        .map(|d| d.last_modified)
        .chain([modified(&root)])
        .max()
        .unwrap_or(0);
    Some(ProjectInfo {
        path: root.to_string_lossy().into_owned(),
        kind: types.join(" + "),
        size: directories.iter().map(|d| d.size).sum(),
        last_modified,
        directories,
    })
}

pub fn scan(root: &str, max_depth: usize, include_hidden: bool) -> Result<ScanReport, String> {
    if !(1..=24).contains(&max_depth) {
        return Err("Scan depth must be between 1 and 24".into());
    }
    let root = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("Cannot open scan folder: {e}"))?;
    if !root.is_dir() {
        return Err("Choose a folder to scan".into());
    }
    scan_policy::check_root(&root)?;
    let system_skips = std::cell::Cell::new(0);
    let mut report = ScanReport {
        feedback: ScanFeedback::default(),
        projects: Vec::new(),
        warnings: Vec::new(),
    };
    let excluded = [
        "node_modules",
        "target",
        "vendor",
        "venv",
        ".venv",
        "__pycache__",
        "dist",
        "build",
        "out",
        ".next",
        ".nuxt",
        ".output",
        ".svelte-kit",
        ".cache",
        ".turbo",
        ".git",
        ".parcel-cache",
        ".webpack",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".angular",
    ];
    for entry in WalkDir::new(&root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            if cfg!(target_os = "macos") && scan_policy::skip_macos_location(entry.path()) {
                system_skips.set(system_skips.get() + 1);
                return false;
            }
            let name = entry.file_name().to_string_lossy();
            !entry.file_type().is_symlink()
                && !excluded.contains(&name.as_ref())
                && (include_hidden || !name.starts_with('.'))
        })
    {
        match entry {
            Ok(entry) if entry.file_type().is_dir() => {
                if let Some(project) = inspect_project(entry.path()) {
                    if project.directories.iter().any(|d| !d.complete) && report.warnings.len() < 50
                    {
                        report.warnings.push(format!(
                            "Some files could not be measured in {}. Size is a lower estimate.",
                            project.path
                        ));
                    }
                    report.projects.push(project);
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
    report.projects.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(report)
}

pub fn cleanup(path: &str, directories: Vec<String>) -> Result<CleanupResult, String> {
    let root = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    let types = kinds(&root);
    if types.is_empty() {
        return Err("This folder is no longer a recognized project".into());
    }
    let allowed = rules(&types);
    let mut targets = Vec::new();
    let mut seen = HashSet::new();
    // Validate the whole request before deleting anything.
    for name in directories {
        let category = allowed
            .iter()
            .find(|(candidate, _)| *candidate == name)
            .map(|(_, category)| *category)
            .ok_or_else(|| format!("Cleanup is not allowed for: {name}"))?;
        if seen.insert(name.clone()) {
            if let Some(target) = checked_directory(&root, &name)? {
                targets.push((name, category, target));
            }
        }
    }
    let mut result = CleanupResult {
        removed: Vec::new(),
        errors: Vec::new(),
        remaining: None,
    };
    for (name, category, target) in targets {
        let (size, complete) = measure(&target);
        let last_modified = modified(&target);
        // Recheck immediately before removal in case the selected folder changed.
        match checked_directory(&root, &name) {
            Ok(Some(current)) if current == target => match fs::remove_dir_all(&target) {
                Ok(()) => result.removed.push(DirectoryInfo {
                    name,
                    category: category.into(),
                    size,
                    last_modified,
                    complete,
                }),
                Err(e) => result.errors.push(format!("Could not remove {name}: {e}")),
            },
            Ok(None) => (),
            Ok(_) => result
                .errors
                .push(format!("Folder changed before cleanup: {name}")),
            Err(e) => result.errors.push(e),
        }
    }
    result.remaining = inspect_project(&root);
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
        let report = scan(root.path().to_str().unwrap(), 8, false).unwrap();
        std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(report.feedback.skipped_permissions, 1);
        assert!(report.warnings.is_empty());
        assert_eq!(report.projects.len(), 1);
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o000)).unwrap();
        let error = scan(root.path().to_str().unwrap(), 8, false).err().unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(error.contains("Cannot read the selected folder"));
    }

    use super::*;
    fn fixture(manifest: &str, names: &[&str]) -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(manifest), "{}").unwrap();
        for name in names {
            fs::create_dir_all(root.path().join(name)).unwrap();
            fs::write(root.path().join(name).join("artifact"), b"12345").unwrap();
        }
        root
    }
    #[test]
    fn finds_build_only_project_and_scan_root() {
        let root = fixture("package.json", &["dist", ".turbo"]);
        let report = scan(root.path().to_str().unwrap(), 8, false).unwrap();
        assert_eq!(report.projects.len(), 1);
        assert_eq!(report.projects[0].size, 10);
        assert_eq!(report.projects[0].directories.len(), 2);
    }
    #[test]
    fn supports_python_rust_and_php() {
        for (manifest, dir, kind) in [
            ("pyproject.toml", ".venv", "Python"),
            ("Cargo.toml", "target", "Rust"),
            ("composer.json", "vendor", "PHP"),
        ] {
            let root = fixture(manifest, &[dir]);
            assert_eq!(inspect_project(root.path()).unwrap().kind, kind);
        }
    }
    #[test]
    fn cleans_only_selected_artifacts_and_keeps_remaining_project() {
        let root = fixture("package.json", &["node_modules", "dist"]);
        let result = cleanup(
            root.path().to_str().unwrap(),
            vec!["dist".into(), "dist".into()],
        )
        .unwrap();
        assert_eq!(result.removed.len(), 1);
        assert_eq!(result.removed[0].size, 5);
        assert!(result.errors.is_empty());
        assert_eq!(result.remaining.unwrap().size, 5);
        assert!(root.path().join("package.json").exists());
        assert!(root.path().join("node_modules/artifact").exists());
    }
    #[test]
    fn rejects_entire_request_if_one_target_is_invalid() {
        let root = fixture("package.json", &["dist"]);
        for target in [
            "../other",
            "/tmp",
            ".git",
            "package.json",
            "src",
            "dist/../src",
        ] {
            assert!(cleanup(
                root.path().to_str().unwrap(),
                vec!["dist".into(), target.into()]
            )
            .is_err());
            assert!(root.path().join("dist/artifact").exists());
        }
    }
    #[test]
    fn rejects_unrecognized_project_and_handles_missing_targets() {
        let root = tempfile::tempdir().unwrap();
        assert!(cleanup(root.path().to_str().unwrap(), vec!["dist".into()]).is_err());
        fs::write(root.path().join("package.json"), "{}").unwrap();
        assert!(cleanup(root.path().to_str().unwrap(), vec!["dist".into()])
            .unwrap()
            .removed
            .is_empty());
    }
    #[test]
    fn skips_dependency_projects_and_honors_hidden_option() {
        let root = fixture("package.json", &["node_modules"]);
        let nested = root.path().join("node_modules/nested");
        fs::create_dir_all(nested.join("dist")).unwrap();
        fs::write(nested.join("package.json"), "{}").unwrap();
        let hidden = root.path().join(".projects/demo");
        fs::create_dir_all(hidden.join("dist")).unwrap();
        fs::write(hidden.join("package.json"), "{}").unwrap();
        assert_eq!(
            scan(root.path().to_str().unwrap(), 8, false)
                .unwrap()
                .projects
                .len(),
            1
        );
        assert_eq!(
            scan(root.path().to_str().unwrap(), 8, true)
                .unwrap()
                .projects
                .len(),
            2
        );
        assert!(scan(root.path().to_str().unwrap(), 0, false).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn partial_failure_preserves_the_remaining_project() {
        use std::os::unix::fs::PermissionsExt;
        let root = fixture("package.json", &["dist", "node_modules"]);
        let protected = root.path().join("dist/protected");
        fs::create_dir(&protected).unwrap();
        fs::write(protected.join("file"), "keep").unwrap();
        fs::set_permissions(&protected, fs::Permissions::from_mode(0o555)).unwrap();
        let result = cleanup(
            root.path().to_str().unwrap(),
            vec!["dist".into(), "node_modules".into()],
        )
        .unwrap();
        fs::set_permissions(&protected, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.removed[0].name, "node_modules");
        assert_eq!(result.remaining.unwrap().directories[0].name, "dist");
        assert!(root.path().join("package.json").exists());
    }
    #[test]
    fn nested_cache_cleanup_keeps_sibling_configuration() {
        let root = fixture("package.json", &[".angular/cache"]);
        fs::write(root.path().join(".angular/settings.json"), "keep").unwrap();
        cleanup(root.path().to_str().unwrap(), vec![".angular/cache".into()]).unwrap();
        assert!(root.path().join(".angular/settings.json").exists());
    }
    #[cfg(unix)]
    #[test]
    fn skips_and_refuses_symlink_targets_including_nested_parents() {
        use std::os::unix::fs::symlink;
        let root = fixture("package.json", &["dist"]);
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("important"), "keep").unwrap();
        fs::create_dir(outside.path().join("cache")).unwrap();
        symlink(outside.path(), root.path().join("node_modules")).unwrap();
        symlink(outside.path(), root.path().join(".angular")).unwrap();
        assert_eq!(inspect_project(root.path()).unwrap().directories.len(), 1);
        for name in ["node_modules", ".angular/cache"] {
            assert!(cleanup(root.path().to_str().unwrap(), vec![name.into()]).is_err());
        }
        assert!(outside.path().join("important").exists());
        symlink(
            outside.path().join("important"),
            root.path().join("dist/link"),
        )
        .unwrap();
        assert_eq!(inspect_project(root.path()).unwrap().size, 5);
        cleanup(root.path().to_str().unwrap(), vec!["dist".into()]).unwrap();
        assert!(outside.path().join("important").exists());
    }
}
