import { useState } from 'react';
import { SizeSummary } from './SizeSummary';
import { ProjectInfo } from '../App';

interface DriveSelectorProps {
  drives: DriveInfo[];
  selectedDrives: Set<string>;
  onDriveSelect: (drives: Set<string>) => void;
  projects: ProjectInfo[];
  selectedProjects: Set<string>;
}

interface DriveInfo {
  path: string;
  name: string;
}

export function DriveSelector({ drives, selectedDrives, onDriveSelect, projects, selectedProjects }: DriveSelectorProps) {
  const selectAllDrives = () => {
    onDriveSelect(new Set(drives.map(drive => drive.path)));
  };

  const deselectAllDrives = () => {
    onDriveSelect(new Set());
  };

  return (
    <div className="drive-selector">
      <div className="drives-section">
        <div className="section-header">
          <h3>Select Drives to Scan</h3>
      </div>
      <div className="drives-list">
        {drives.map(drive => (
          <label key={drive.path} className="drive-item">
            <input
              type="checkbox"
              checked={selectedDrives.has(drive.path)}
              onChange={(e) => {
                onDriveSelect(prev => {
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
            <span>{drive.name}</span>
          </label>
        ))}
      </div>
      
    </div>
    <SizeSummary
              totalSize={projects.reduce(
                (sum, project) => sum + project.size,
                0
              )}
        selectedSize={projects
          .filter((project) => selectedProjects.has(project.path))
          .reduce((sum, project) => sum + project.size, 0)}
      />
    </div>
  );
}