import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface ProjectInfo {
  path: string;
  last_modified: number;
  size: number;
}

interface DriveInfo {
  path: string;
  name: string;
}

function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDrives, setSelectedDrives] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadDrives();
  }, []);

  const loadDrives = async () => {
    try {
      const availableDrives = await invoke<DriveInfo[]>("get_drives");
      setDrives(availableDrives);
      // Auto-select all drives
      setSelectedDrives(new Set(availableDrives.map(drive => drive.path)));
    } catch (error) {
      console.error("Failed to get drives:", error);
    }
  };

  const scanProjects = async () => {
    try {
      setScanning(true);
      setProjects([]); // Clear existing results
      
      for (const drivePath of selectedDrives) {
        const results = await invoke<ProjectInfo[]>("scan_for_projects", {
          rootPath: drivePath
        });
        
        // Filter projects older than 1 month
        const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const filteredProjects = results.filter(
          project => (project.last_modified * 1000) < oneMonthAgo
        );
        
        setProjects(prev => [...prev, ...filteredProjects]);
      }
    } catch (error) {
      console.error("Failed to scan projects:", error);
    } finally {
      setScanning(false);
    }
  };

  const deleteSelected = async () => {
    for (const projectPath of selectedProjects) {
      try {
        await invoke("delete_node_modules", { path: projectPath });
        setSelectedProjects(prev => {
          const next = new Set(prev);
          next.delete(projectPath);
          return next;
        });
      } catch (error) {
        console.error(`Failed to delete ${projectPath}:`, error);
      }
    }
    // Refresh the list after deletion
    await scanProjects();
  };

  const formatSize = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <main className="container">
      <h1>node_modules Cleanup Utility</h1>
      
      <div className="drives-section">
        <h3>Select Drives to Scan</h3>
        <div className="drives-list">
          {drives.map(drive => (
            <label key={drive.path} className="drive-item">
              <input
                type="checkbox"
                checked={selectedDrives.has(drive.path)}
                onChange={(e) => {
                  setSelectedDrives(prev => {
                    const next = new Set(prev);
                    if (e.target.checked) {
                      next.add(drive.path);
                    } else {
                      next.delete(drive.path);
                    }
                    return next;
                  });
                }}
              />
              {drive.name}
            </label>
          ))}
        </div>
      </div>
      
      <div className="controls">
        <button 
          onClick={scanProjects} 
          disabled={scanning || selectedDrives.size === 0}
        >
          {scanning ? "Scanning..." : "Scan Selected Drives"}
        </button>
        
        {selectedProjects.size > 0 && (
          <button onClick={deleteSelected}>
            Delete Selected ({selectedProjects.size})
          </button>
        )}
      </div>

      <div className="projects-list">
        {projects.map(project => (
          <div key={project.path} className="project-item">
            <input
              type="checkbox"
              checked={selectedProjects.has(project.path)}
              onChange={(e) => {
                setSelectedProjects(prev => {
                  const next = new Set(prev);
                  if (e.target.checked) {
                    next.add(project.path);
                  } else {
                    next.delete(project.path);
                  }
                  return next;
                });
              }}
            />
            <div className="project-info">
              <div className="project-path">{project.path}</div>
              <div className="project-details">
                Last modified: {new Date(project.last_modified * 1000).toLocaleDateString()}
                <span className="size">Size: {formatSize(project.size)}</span>
              </div>
            </div>
          </div>
        ))}
        
        {projects.length === 0 && !scanning && (
          <div className="no-projects">
            No unused node_modules folders found
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
