import { ProjectInfo } from "../App";
import "./SummaryPanel.css";

interface SummaryPanelProps {
  projects: ProjectInfo[];
  selectedProjects: Set<string>;
}

export function SummaryPanel({ projects, selectedProjects }: SummaryPanelProps) {
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

  const totalSize = projects.reduce((sum, project) => sum + project.size, 0);
  const selectedSize = projects
    .filter(project => selectedProjects.has(project.path))
    .reduce((sum, project) => sum + project.size, 0);

  const selectedPercentage = totalSize > 0 ? (selectedSize / totalSize) * 100 : 0;

  return (
    <div className="summary-panel">
      <div className="stat-card">
        <div className="stat-header">
          <span className="stat-label">Total Space Used</span>
          <span className="stat-value">{formatSize(totalSize)}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: '100%' }}></div>
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-header">
          <span className="stat-label">Selected for Deletion</span>
          <span className="stat-value">{formatSize(selectedSize)}</span>
        </div>
        <div className="progress-bar">
          <div 
            className="progress-fill progress-fill-selected" 
            style={{ width: `${selectedPercentage}%` }}
          ></div>
        </div>
      </div>

      <div className="quick-stats">
        <div className="stat-box">
          <div className="stat-number">{projects.length}</div>
          <div className="stat-label">Total Projects</div>
        </div>
        <div className="stat-box">
          <div className="stat-number selected">{selectedProjects.size}</div>
          <div className="stat-label">Selected</div>
        </div>
      </div>
    </div>
  );
} 