import { ProjectInfo } from "../App";
import { useState } from "react";
import "./ProjectList.css";

interface ProjectListProps {
  projects: ProjectInfo[];
  selectedProjects: Set<string>;
  onProjectSelect: (selected: Set<string>) => void;
  scanning: boolean;
}

export function ProjectList({
  projects,
  selectedProjects,
  onProjectSelect,
  scanning,
}: ProjectListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProjects = projects.filter((project) =>
    project.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleProject = (projectPath: string) => {
    const newSelected = new Set(selectedProjects);
    if (newSelected.has(projectPath)) {
      newSelected.delete(projectPath);
    } else {
      newSelected.add(projectPath);
    }
    onProjectSelect(newSelected);
  };

  const formatSize = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const getDaysAgo = (timestamp: number) => {
    const days = Math.floor((Date.now() - timestamp * 1000) / (1000 * 60 * 60 * 24));
    return `${days} days old`;
  };

  return (
    <div className="project-list-container">
      <div className="search-wrapper">
        <input
          type="search"
          placeholder="Search projects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
        <svg
          className="search-icon"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      <div className="project-grid">
        {scanning ? (
          <div className="loading-state">
            <div className="loading-spinner-wrapper">
              <div className="loading-spinner"></div>
            </div>
            <h3 className="loading-text">Scanning for projects...</h3>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="empty-state">
            No projects found
          </div>
        ) : (
          filteredProjects.map((project) => (
            <div
              key={project.path}
              className="project-card"
            >
              <div className="project-card-content">
                <div className="checkbox-wrapper">
                  <input
                    type="checkbox"
                    checked={selectedProjects.has(project.path)}
                    onChange={() => toggleProject(project.path)}
                    className="project-checkbox"
                  />
                </div>
                <div className="project-info">
                  <div className="project-header">
                    <h3 className="project-name">
                      {project.path.split("/").pop()}
                    </h3>
                    <span className="project-age">
                      {getDaysAgo(project.last_modified)}
                    </span>
                  </div>
                  <p className="project-path">
                    {project.path}
                  </p>
                  <div className="project-meta">
                    <span className="size-badge">
                      {formatSize(project.size)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}