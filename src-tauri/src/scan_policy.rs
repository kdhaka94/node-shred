use serde::Serialize;
use std::{fs, io, path::Path};

#[derive(Default, Debug, Serialize)]
pub struct ScanFeedback {
    pub skipped_permissions: usize,
    pub skipped_system: usize,
    pub examples: Vec<String>,
}
impl ScanFeedback {
    pub fn permission_skip(&mut self, error: &io::Error, path: &Path) -> bool {
        if error.kind() != io::ErrorKind::PermissionDenied {
            return false;
        }
        self.skipped_permissions += 1;
        if self.examples.len() < 3 {
            self.examples.push(path.to_string_lossy().into_owned());
        }
        true
    }
}

// Match system roots, not arbitrary folders named "Library" or "System" in a project.
// Mounted macOS disks have the same layout below /Volumes/<disk>.
pub fn macos_system_root(path: &Path) -> bool {
    let parts: Vec<_> = path
        .components()
        .filter_map(|part| match part {
            std::path::Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .collect();
    let parts = if parts.first() == Some(&"Volumes") {
        if parts.len() < 3 {
            return false;
        }
        &parts[2..]
    } else {
        &parts[..]
    };
    parts.len() == 1
        && [
            "System",
            "Library",
            "usr",
            "bin",
            "sbin",
            "private",
            "dev",
            "etc",
            "var",
            "Applications",
            "cores",
        ]
        .contains(&parts[0])
}
pub fn skip_macos_location(path: &Path) -> bool {
    if macos_system_root(path) || path.extension().is_some_and(|extension| extension == "app") {
        return true;
    }
    let parts: Vec<_> = path
        .components()
        .filter_map(|part| match part {
            std::path::Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .collect();
    parts.len() == 3 && parts[0] == "Users" && parts[2] == "Library"
}

pub fn check_root(root: &Path) -> Result<(), String> {
    if cfg!(target_os = "macos") && macos_system_root(root) {
        return Err("System locations are excluded from cleanup scans. Choose your Home, Projects, or Downloads folder.".into());
    }
    fs::read_dir(root).map(|_| ()).map_err(|error| {
        if error.kind() == io::ErrorKind::PermissionDenied {
            format!("Cannot read the selected folder: {}. {}", root.display(), if cfg!(target_os = "macos") { "Choose an accessible folder or check this app's Files & Folders permission in System Settings." } else { "Choose an accessible folder or check its permissions." })
        } else { format!("Cannot read the selected folder {}: {error}", root.display()) }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excludes_mac_system_and_volume_roots_without_excluding_user_projects() {
        for path in [
            "/System",
            "/usr",
            "/Library",
            "/private",
            "/Volumes/Macintosh HD/System",
            "/Volumes/External/Library",
        ] {
            assert!(macos_system_root(Path::new(path)), "{path}");
        }
        for path in [
            "/",
            "/Users/dev/Projects/Library",
            "/Users/dev/System",
            "/Volumes/Work/projects",
            "/private/tmp/project",
        ] {
            assert!(!macos_system_root(Path::new(path)), "{path}");
        }
        assert!(skip_macos_location(Path::new("/Users/dev/Library")));
        assert!(skip_macos_location(Path::new(
            "/Users/dev/Applications/Tool.app"
        )));
        assert!(!skip_macos_location(Path::new(
            "/Users/dev/Projects/Library"
        )));
    }
    #[test]
    fn permission_counts_are_not_capped_but_examples_are() {
        let mut feedback = ScanFeedback::default();
        for _ in 0..80 {
            assert!(feedback.permission_skip(
                &io::Error::from(io::ErrorKind::PermissionDenied),
                Path::new("/protected")
            ));
        }
        assert_eq!(feedback.skipped_permissions, 80);
        assert_eq!(feedback.examples.len(), 3);
        assert!(!feedback.permission_skip(
            &io::Error::from(io::ErrorKind::NotFound),
            Path::new("/missing")
        ));
        assert_eq!(feedback.skipped_permissions, 80);
    }
}
