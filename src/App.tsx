import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { ProjectList } from "./components/ProjectList";
import { DriveSelector } from "./components/DriveSelector";
import { SummaryPanel } from "./components/SummaryPanel";

export interface ProjectInfo {
  path: string;
  last_modified: number;
  size: number;
}

export interface DriveInfo {
  path: string;
  name: string;
}

export interface CleanupOption {
  id: string;
  label: string;
  directories: string[];
}

const CLEANUP_OPTIONS: CleanupOption[] = [
  {
    id: 'node_modules',
    label: 'node_modules only',
    directories: ['node_modules']
  },
  {
    id: 'build',
    label: 'Build directories',
    directories: ['node_modules', 'dist', 'build', '.next', 'out']
  },
  {
    id: 'all_cache',
    label: 'All cache and build',
    directories: ['node_modules', 'dist', 'build', '.next', 'out', '.cache', '.parcel-cache', '.webpack']
  }
];

function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDrives, setSelectedDrives] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<number | 'all'>('all');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedCleanupOption, setSelectedCleanupOption] = useState<string>('node_modules');

  useEffect(() => {
    loadDrives();
  }, []);

  const loadDrives = async () => {
    try {
      const availableDrives = await invoke<DriveInfo[]>("get_drives");
      setDrives(availableDrives);
      setSelectedDrives(new Set(availableDrives.map((drive) => drive.path)));
    } catch (error) {
      console.error("Failed to get drives:", error);
    }
  };

  const scanProjects = async () => {
    try {
      setScanning(true);
      setProjects([]);

      for (const drivePath of selectedDrives) {
        const results = await invoke<ProjectInfo[]>("scan_for_projects", {
          rootPath: drivePath,
        });
        setProjects((prev) => [...prev, ...results]);
      }
    } catch (error) {
      console.error("Failed to scan projects:", error);
    } finally {
      setScanning(false);
    }
  };

  const deleteSelected = async () => {
    setDeleting(true);
    setDeleteError(null);
    const failedDeletions: { path: string; error: string }[] = [];
    const selectedOption = CLEANUP_OPTIONS.find(opt => opt.id === selectedCleanupOption);

    if (!selectedOption) {
      setDeleteError('Invalid cleanup option selected');
      setDeleting(false);
      return;
    }

    for (const projectPath of selectedProjects) {
      try {
        await invoke("delete_project_directories", { 
          path: projectPath,
          directories: selectedOption.directories
        });
        // Remove from selected projects one by one as they succeed
        setSelectedProjects((prev) => {
          const next = new Set(prev);
          next.delete(projectPath);
          return next;
        });
      } catch (error) {
        console.error(`Failed to delete ${projectPath}:`, error);
        failedDeletions.push({
          path: projectPath,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Update projects list
    setProjects((prev) => 
      prev.filter(project => 
        !selectedProjects.has(project.path) || 
        failedDeletions.some(fd => fd.path === project.path)
      )
    );

    // Show error message if any deletions failed
    if (failedDeletions.length > 0) {
      setDeleteError(
        `Failed to delete ${failedDeletions.length} project${failedDeletions.length > 1 ? 's' : ''}`
      );
    }

    setDeleting(false);
  };

  const filteredProjects = projects.filter(
    (project) => dateFilter === 'all' || project.last_modified * 1000 < Date.now() - dateFilter * 24 * 60 * 60 * 1000
  );

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1 className="title">NodeShred</h1>
          <p className="subtitle">Clean up unused node_modules and reclaim your disk space</p>
        </header>

        <div className="layout">
          <div className="sidebar">
            <div className="sidebar-content">
              <DriveSelector
                drives={drives}
                selectedDrives={selectedDrives}
                onDriveSelect={setSelectedDrives}
                projects={filteredProjects}
                selectedProjects={selectedProjects}
              />

              <SummaryPanel
                projects={filteredProjects}
                selectedProjects={selectedProjects}
              />
            </div>
          </div>

          <div className="main-content">
            <div className="action-bar">
              <div className="action-group">
                <button
                  onClick={scanProjects}
                  disabled={scanning || selectedDrives.size === 0}
                  className={`btn btn-primary ${scanning ? 'btn-loading' : ''}`}
                >
                  {scanning ? (
                    <>
                      <span className="spinner"></span>
                      Scanning...
                    </>
                  ) : (
                    "Scan Selected Drives"
                  )}
                </button>

                <div className="date-filter">
                  <label htmlFor="dateFilter" className="date-filter-label">
                    Show projects
                  </label>
                  <select
                    id="dateFilter"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="date-filter-select"
                  >
                    <option value="all">All projects</option>
                    <option value={7}>Older than 7 days</option>
                    <option value={30}>Older than 30 days</option>
                    <option value={90}>Older than 90 days</option>
                    <option value={180}>Older than 180 days</option>
                    <option value={365}>Older than 1 year</option>
                  </select>
                </div>
              </div>

              <div className="action-group">
                <button
                  onClick={() => setSelectedProjects(new Set(filteredProjects.map((p) => p.path)))}
                  className="btn btn-secondary"
                  disabled={filteredProjects.length === 0 || deleting}
                >
                  Select All
                </button>

                <button
                  onClick={() => setSelectedProjects(new Set())}
                  className="btn btn-secondary"
                  disabled={selectedProjects.size === 0 || deleting}
                >
                  Deselect All
                </button>

                <select
                  value={selectedCleanupOption}
                  onChange={(e) => setSelectedCleanupOption(e.target.value)}
                  className="cleanup-select"
                  disabled={deleting}
                >
                  {CLEANUP_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <button
                  onClick={deleteSelected}
                  disabled={selectedProjects.size === 0 || deleting}
                  className={`btn btn-danger ${deleting ? 'btn-loading' : ''}`}
                >
                  {deleting ? (
                    <>
                      <span className="spinner"></span>
                      Deleting...
                    </>
                  ) : (
                    `Delete Selected (${selectedProjects.size})`
                  )}
                </button>
              </div>
            </div>

            {deleteError && (
              <div className="error-banner">
                <div className="error-content">
                  <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{deleteError}</span>
                </div>
                <button 
                  className="error-close"
                  onClick={() => setDeleteError(null)}
                  aria-label="Dismiss error"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            <ProjectList
              projects={filteredProjects}
              selectedProjects={selectedProjects}
              onProjectSelect={setSelectedProjects}
              scanning={scanning}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
