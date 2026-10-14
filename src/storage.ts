export interface DirectoryInfo {
  name: string;
  category: string;
  size: number;
  last_modified: number;
  complete: boolean;
}
export interface ProjectInfo {
  path: string;
  kind: string;
  last_modified: number;
  size: number;
  directories: DirectoryInfo[];
}
export interface DriveInfo {
  path: string;
  name: string;
}
export interface FileInfo {
  path: string;
  name: string;
  kind: string;
  last_modified: number;
  size: number;
}
export type Category = "cache" | "build" | "dependencies";
export const CATEGORIES: {
  id: Category;
  label: string;
  description: string;
}[] = [
  {
    id: "cache",
    label: "Tool caches",
    description: "Temporary data from your development tools",
  },
  {
    id: "build",
    label: "Build outputs",
    description: "Compiled apps and generated bundles",
  },
  {
    id: "dependencies",
    label: "Dependencies",
    description: "Packages and virtual environments; reinstall to work again",
  },
];
export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit < 2 ? 0 : 1 })} ${units[unit]}`;
}
export function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}
export function ageLabel(timestamp: number): string {
  if (!timestamp) return "Unknown";
  const days = Math.max(0, Math.floor((Date.now() / 1000 - timestamp) / 86400));
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}
export function chosenDirectories(
  project: ProjectInfo,
  categories: Set<string>,
  overrides: Record<string, string[]>,
): DirectoryInfo[] {
  const override = overrides[project.path];
  return project.directories.filter((d) =>
    override ? override.includes(d.name) : categories.has(d.category),
  );
}
export function matchesFilters(
  item: { path: string; kind: string; last_modified: number; size: number },
  search: string,
  kind: string,
  days: number,
  minimum: number,
): boolean {
  return (
    item.path.toLowerCase().includes(search.toLowerCase()) &&
    (kind === "all" || item.kind.includes(kind)) &&
    item.size >= minimum &&
    (!days ||
      (item.last_modified > 0 &&
        item.last_modified < Date.now() / 1000 - days * 86400))
  );
}
