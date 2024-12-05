import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { ProjectList } from "./components/ProjectList";
import { DriveSelector } from "./components/DriveSelector";
import { SizeSummary } from "./components/SizeSummary";

export interface ProjectInfo {
  path: string;
  last_modified: number;
  size: number;
}

export interface DriveInfo {
  path: string;
  name: string;
}

function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
    new Set()
  );
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDrives, setSelectedDrives] = useState<Set<string>>(new Set());

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

        const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const filteredProjects = results.filter(
          (project) => project.last_modified * 1000 < oneMonthAgo
        );

        setProjects((prev) => [...prev, ...filteredProjects]);
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
        setSelectedProjects((prev) => {
          const next = new Set(prev);
          next.delete(projectPath);
          return next;
        });
      } catch (error) {
        console.error(`Failed to delete ${projectPath}:`, error);
      }
    }
    await scanProjects();
  };

  return (
    <main className="container">
      <h1>node_modules Cleanup Utility</h1>

      <DriveSelector
        drives={drives}
        selectedDrives={selectedDrives}
        onDriveSelect={setSelectedDrives}
        projects={projects}
        selectedProjects={selectedProjects}
      />

      <div className="main-content">
        <div className="left-panel">
          <div className="controls">
            <button
              onClick={scanProjects}
              disabled={scanning || selectedDrives.size === 0}
            >
              {scanning ? "Scanning..." : "Scan selected drive"}
            </button>

            <button
              onClick={() =>
                setSelectedProjects(new Set(projects.map((p) => p.path)))
              }
            >
              Select All
            </button>
            <button onClick={() => setSelectedProjects(new Set())}>
              Deselect All
            </button>

            <button
              onClick={deleteSelected}
              disabled={selectedProjects.size === 0}
            >
              Delete Modules
            </button>

          </div>

          <ProjectList
            projects={projects}
            selectedProjects={selectedProjects}
            onProjectSelect={setSelectedProjects}
            scanning={scanning}
          />
        </div>
      </div>
    </main>
  );
}

export default App;
