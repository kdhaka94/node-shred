interface ProjectListProps {
  projects: ProjectInfo[];
  selectedProjects: Set<string>;
  onProjectSelect: (projects: Set<string>) => void;
  scanning: boolean;
}

interface ProjectInfo {
  path: string;
  last_modified: number;
  size: number;
}

export function ProjectList({ projects, selectedProjects, onProjectSelect, scanning }: ProjectListProps) {
  const formatSize = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="projects-list">
      {projects.map(project => (
        <div key={project.path} className="project-item">
          <input
            type="checkbox"
            checked={selectedProjects.has(project.path)}
            onChange={(e) => {
              onProjectSelect(prev => {
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
  );
}