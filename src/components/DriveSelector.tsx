import { DriveInfo, ProjectInfo } from "../App";
import "./DriveSelector.css";

interface DriveSelectorProps {
  drives: DriveInfo[];
  selectedDrives: Set<string>;
  onDriveSelect: (selected: Set<string>) => void;
  projects: ProjectInfo[];
  selectedProjects: Set<string>;
}

export function DriveSelector({
  drives,
  selectedDrives,
  onDriveSelect,
}: DriveSelectorProps) {
  const toggleDrive = (drivePath: string) => {
    const newSelected = new Set(selectedDrives);
    if (newSelected.has(drivePath)) {
      newSelected.delete(drivePath);
    } else {
      newSelected.add(drivePath);
    }
    onDriveSelect(newSelected);
  };

  return (
    <div className="drive-selector">
      <div className="drive-header">
        <h2 className="drive-title">Storage Drives</h2>
        <span className="drive-badge">{drives.length}</span>
      </div>

      <div className="drive-list">
        {drives.map((drive) => (
          <label key={drive.path} className="drive-item">
            <div className="drive-item-content">
              <input
                type="checkbox"
                checked={selectedDrives.has(drive.path)}
                onChange={() => toggleDrive(drive.path)}
                className="drive-checkbox"
              />
              <div className="drive-info">
                <span className="drive-name">{drive.name}</span>
                <span className="drive-path">{drive.path}</span>
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}