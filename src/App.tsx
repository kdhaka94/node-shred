import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "./components/Icon";
import {
  CATEGORIES,
  chosenDirectories,
  formatSize,
  matchesFilters,
  projectName,
  ageLabel,
} from "./storage";
import type {
  ProjectInfo,
  FileInfo,
  DriveInfo,
  DirectoryInfo,
} from "./storage";
import "./App.css";
export type { ProjectInfo, DriveInfo } from "./storage";

type Mode = "projects" | "files";
interface Plan {
  mode: Mode;
  entries: { path: string; names: string[]; size: number }[];
}
const PRESETS = [
  { id: "cache", label: "Caches only", categories: ["cache"] },
  { id: "build", label: "Fresh build", categories: ["cache", "build"] },
  {
    id: "all",
    label: "Full reset",
    categories: ["cache", "build", "dependencies"],
  },
];
function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function App() {
  const [mode, setMode] = useState<Mode>("projects");
  const [locations, setLocations] = useState<DriveInfo[]>([]);
  const [roots, setRoots] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState("");
  const [fileRoot, setFileRoot] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [depth, setDepth] = useState(8);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState(new Set(["cache", "build"]));
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [days, setDays] = useState(0);
  const [minimum, setMinimum] = useState(0);
  const [sort, setSort] = useState("size");
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [freed, setFreed] = useState(0);
  const [progress, setProgress] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = scanning || deleting;
  const desktop =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  useEffect(() => {
    if (!desktop) return;
    invoke<DriveInfo[]>("get_drives")
      .then((items) => {
        setLocations(items);
        if (items[0]) {
          setRoots(new Set([items[0].path]));
          setFileRoot(`${items[0].path.replace(/[\\/]$/, "")}/Downloads`);
        }
      })
      .catch((error) => setWarnings([errorText(error)]));
  }, [desktop]);
  useEffect(() => {
    if (plan && dialog.current && !dialog.current.open)
      dialog.current.showModal();
    if (!plan) dialog.current?.close();
  }, [plan]);

  const items = mode === "projects" ? projects : files;
  const visible = useMemo(
    () =>
      [...items]
        .filter((item) => matchesFilters(item, search, kind, days, minimum))
        .sort((a, b) =>
          sort === "name"
            ? projectName(a.path).localeCompare(projectName(b.path))
            : sort === "age"
              ? a.last_modified - b.last_modified
              : b.size - a.size,
        ),
    [items, search, kind, days, minimum, sort],
  );
  const directoryChoices = (project: ProjectInfo) =>
    chosenDirectories(project, categories, overrides);
  const eligibleSize = (item: ProjectInfo | FileInfo) =>
    "directories" in item
      ? directoryChoices(item).reduce((sum, d) => sum + d.size, 0)
      : item.size;
  const eligible = (item: ProjectInfo | FileInfo) =>
    !("directories" in item) || directoryChoices(item).length > 0;
  const selectedItems = items.filter(
    (item) => selected.has(item.path) && eligible(item),
  );
  const selectedBytes = selectedItems.reduce(
    (sum, item) => sum + eligibleSize(item),
    0,
  );
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  const visibleEligible = visible.filter(eligible);
  const allVisibleSelected =
    visibleEligible.length > 0 &&
    visibleEligible.every((item) => selected.has(item.path));
  const hiddenSelection = selectedItems.filter(
    (item) => !visible.some((v) => v.path === item.path),
  ).length;
  const activePreset = Object.keys(overrides).length
    ? "custom"
    : PRESETS.find(
        (p) =>
          p.categories.length === categories.size &&
          p.categories.every((c) => categories.has(c)),
      )?.id;
  const breakdown =
    mode === "projects"
      ? CATEGORIES.map((c) => ({
          label: c.label,
          id: c.id,
          size: projects.reduce(
            (sum, p) =>
              sum +
              p.directories
                .filter((d) => d.category === c.id)
                .reduce((subtotal, d) => subtotal + d.size, 0),
            0,
          ),
        }))
      : ["Archives", "Installers", "Media", "Images", "Documents", "Other"].map(
          (type, index) => ({
            label: type,
            id: `file-${index}`,
            size: files
              .filter((f) => f.kind === type)
              .reduce((sum, f) => sum + f.size, 0),
          }),
        );

  function toggle(path: string, setter = setSelected) {
    setter((previous) => {
      const next = new Set(previous);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }
  function changeMode(next: Mode) {
    setMode(next);
    setSelected(new Set());
    setKind("all");
    setSearch("");
    setScanned(false);
    setWarnings([]);
    setNotice("");
  }
  function addLocation(event: React.FormEvent) {
    event.preventDefault();
    const path = folder.trim();
    if (!path) return;
    if (!locations.some((location) => location.path === path))
      setLocations((previous) => [
        ...previous,
        { path, name: projectName(path) },
      ]);
    setRoots((previous) => new Set([...previous, path]));
    setFolder("");
  }
  async function scan() {
    setScanning(true);
    setScanned(false);
    setSelected(new Set());
    setOverrides({});
    setWarnings([]);
    setNotice("");
    const errors: string[] = [];
    try {
      if (mode === "files") {
        setFiles([]);
        setProgress("Reading your folder…");
        const report = await invoke<{ files: FileInfo[]; warnings: string[] }>(
          "scan_folder_files",
          { rootPath: fileRoot.trim(), recursive },
        );
        setFiles(report.files);
        errors.push(...report.warnings);
      } else {
        setProjects([]);
        const found = new Map<string, ProjectInfo>();
        let index = 0;
        for (const root of roots) {
          setProgress(`Scanning folder ${++index} of ${roots.size}…`);
          try {
            const report = await invoke<{
              projects: ProjectInfo[];
              warnings: string[];
            }>("scan_for_projects", {
              rootPath: root,
              maxDepth: depth,
              includeHidden: hidden,
            });
            report.projects.forEach((p) => found.set(p.path, p));
            errors.push(...report.warnings);
          } catch (error) {
            errors.push(`${root}: ${errorText(error)}`);
          }
        }
        setProjects([...found.values()]);
      }
    } catch (error) {
      errors.push(errorText(error));
    } finally {
      setWarnings(errors);
      setScanning(false);
      setScanned(true);
      setProgress("");
    }
  }
  function toggleDirectory(project: ProjectInfo, name: string) {
    const choices = directoryChoices(project).map((d) => d.name);
    setOverrides((previous) => ({
      ...previous,
      [project.path]: choices.includes(name)
        ? choices.filter((d) => d !== name)
        : [...choices, name],
    }));
  }
  function review() {
    setAcknowledged(false);
    setPlan({
      mode,
      entries: selectedItems.map((item) => ({
        path: item.path,
        size: eligibleSize(item),
        names:
          "directories" in item
            ? directoryChoices(item).map((d) => d.name)
            : [],
      })),
    });
  }
  async function performCleanup() {
    if (!plan || !acknowledged) return;
    setDeleting(true);
    setNotice("");
    const errors: string[] = [];
    let bytes = 0;
    let count = 0;
    const failed = new Set<string>();
    try {
      if (plan.mode === "files") {
        const result = await invoke<{
          removed: string[];
          bytes_freed: number;
          errors: string[];
        }>("delete_selected_files", { paths: plan.entries.map((e) => e.path) });
        const removed = new Set(result.removed);
        setFiles((previous) => previous.filter((f) => !removed.has(f.path)));
        plan.entries.forEach((e) => {
          if (!removed.has(e.path)) failed.add(e.path);
        });
        bytes = result.bytes_freed;
        count = result.removed.length;
        errors.push(...result.errors);
      } else {
        let index = 0;
        for (const entry of plan.entries) {
          setProgress(`Cleaning project ${++index} of ${plan.entries.length}…`);
          try {
            const result = await invoke<{
              removed: DirectoryInfo[];
              errors: string[];
              remaining: ProjectInfo | null;
            }>("delete_project_directories", {
              path: entry.path,
              directories: entry.names,
            });
            bytes += result.removed.reduce((sum, d) => sum + d.size, 0);
            count += result.removed.length;
            setProjects((previous) =>
              previous.flatMap((p) =>
                p.path === entry.path
                  ? result.remaining
                    ? [result.remaining]
                    : []
                  : [p],
              ),
            );
            if (result.errors.length) {
              failed.add(entry.path);
              errors.push(...result.errors.map((e) => `${entry.path}: ${e}`));
            }
          } catch (error) {
            failed.add(entry.path);
            errors.push(`${entry.path}: ${errorText(error)}`);
          }
        }
      }
      setFreed((previous) => previous + bytes);
      if (count)
        setNotice(
          `Cleanup complete. Removed ${count} ${plan.mode === "files" ? "file" : "folder"}${count === 1 ? "" : "s"} · ${formatSize(bytes)} of file data cleared.`,
        );
    } catch (error) {
      plan.entries.forEach((e) => failed.add(e.path));
      errors.push(errorText(error));
    } finally {
      setWarnings(errors);
      setSelected(failed);
      setDeleting(false);
      setPlan(null);
      setProgress("");
    }
  }

  return (
    <div className="shell">
      <aside className="navigation">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <Icon name="layers" />
          </span>
          Node<span>Shred</span>
          <span className="version">LOCAL</span>
        </a>
        <p className="eyebrow nav-label">YOUR STORAGE</p>
        <nav aria-label="Cleanup views">
          <button
            className={`nav-item ${mode === "projects" ? "active" : ""}`}
            onClick={() => changeMode("projects")}
            disabled={busy}
          >
            <Icon name="grid" />
            Project cleaner
            <Icon name="chevron" />
          </button>
          <button
            className={`nav-item ${mode === "files" ? "active" : ""}`}
            onClick={() => changeMode("files")}
            disabled={busy}
          >
            <Icon name="download" />
            Files & downloads
            <Icon name="chevron" />
          </button>
        </nav>
        <section className="sources">
          <div className="section-heading">
            <h2>{mode === "projects" ? "Scan locations" : "Scan folder"}</h2>
            <Icon name="folder" />
          </div>
          <p className="muted small">
            {mode === "projects"
              ? "Choose where to look for projects."
              : "Review individual files before removing them."}
          </p>
          {mode === "projects" ? (
            <>
              <div className="location-list">
                {locations.map((location) => (
                  <label
                    key={location.path}
                    className="location"
                    title={location.path}
                  >
                    <input
                      type="checkbox"
                      checked={roots.has(location.path)}
                      onChange={() => toggle(location.path, setRoots)}
                      disabled={busy}
                    />
                    <span>
                      <strong>{location.name}</strong>
                      <small>{location.path}</small>
                    </span>
                  </label>
                ))}
              </div>
              <form onSubmit={addLocation} className="folder-form">
                <label className="sr-only" htmlFor="folder">
                  Add a project folder path
                </label>
                <input
                  id="folder"
                  placeholder="Paste a folder path…"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  disabled={busy}
                />
                <button
                  aria-label="Add folder"
                  disabled={busy || !folder.trim()}
                >
                  <Icon name="plus" />
                </button>
              </form>
            </>
          ) : (
            <>
              <label className="sr-only" htmlFor="fileRoot">
                Folder to scan for files
              </label>
              <input
                id="fileRoot"
                className="file-root"
                placeholder="Paste a folder path…"
                value={fileRoot}
                onChange={(e) => setFileRoot(e.target.value)}
                disabled={busy}
              />
              <label className="check-option">
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(e) => setRecursive(e.target.checked)}
                  disabled={busy}
                />
                Include subfolders
              </label>
            </>
          )}
          {mode === "projects" && (
            <details className="scan-settings">
              <summary>Scan settings</summary>
              <label>
                Folder depth
                <select
                  aria-label="Scan folder depth"
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                  disabled={busy}
                >
                  {[4, 8, 12, 24].map((n) => (
                    <option key={n} value={n}>
                      {n} levels
                    </option>
                  ))}
                </select>
              </label>
              <label className="check-option">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  disabled={busy}
                />
                Include hidden project folders
              </label>
            </details>
          )}
        </section>
        <div className="nav-bottom">
          <Icon name="shield" />
          <div>
            <strong>You’re in control</strong>
            <p>Every cleanup starts with a review of your selection.</p>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span>
            Workspace <span className="breadcrumb-slash">/</span>{" "}
            <strong>
              {mode === "projects" ? "Project cleaner" : "Files & downloads"}
            </strong>
          </span>
          <span className="local-badge">
            <span />
            Local filesystem
          </span>
        </header>
        <div className="workspace-body">
          <section className="page-heading">
            <div>
              <p className="eyebrow accent">LESS CLUTTER. MORE POSSIBILITY.</p>
              <h1>
                Make room for what’s next<span>.</span>
              </h1>
              <p className="muted">
                {mode === "projects"
                  ? "Find bulky dependencies, old builds, and caches. Keep the things that matter."
                  : "Find the files taking up space. Choose exactly what you’re ready to let go."}
              </p>
            </div>
            <button
              className="button primary scan-button"
              onClick={scan}
              disabled={
                busy ||
                !desktop ||
                (mode === "projects" ? roots.size === 0 : !fileRoot.trim())
              }
            >
              {scanning ? <span className="spinner" /> : <Icon name="search" />}
              {scanning ? "Scanning…" : "Scan folders"}
              {!scanning && <Icon name="arrow" />}
            </button>
          </section>
          {!desktop && (
            <div className="banner info" role="status">
              <Icon name="shield" />
              Open the desktop app to scan and clean your files. You can explore
              the interface here.
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <Icon name="check" />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <Icon name="close" />
              </button>
            </div>
          )}
          {warnings.length > 0 && (
            <details className="banner warning" open>
              <summary>
                <Icon name="warning" />
                {warnings.length}{" "}
                {warnings.length === 1 ? "item needs" : "items need"} attention
              </summary>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <section className="stats" aria-label="Storage summary">
            <div className="stat">
              <span>
                Identified storage <Icon name="layers" />
              </span>
              <strong>{formatSize(totalBytes)}</strong>
              <small>
                {items.length}{" "}
                {mode === "projects"
                  ? "projects with cleanup folders"
                  : "files found"}
              </small>
            </div>
            <div className="stat selected-stat">
              <span>
                Selected to clear <Icon name="trash" />
              </span>
              <strong>{formatSize(selectedBytes)}</strong>
              <small>
                {selectedItems.length}{" "}
                {mode === "projects" ? "projects" : "files"} in your cleanup
                plan
              </small>
            </div>
            <div className="stat">
              <span>
                Cleared this session <Icon name="spark" />
              </span>
              <strong className="accent">{formatSize(freed)}</strong>
              <small>A little more breathing room</small>
            </div>
          </section>
          <div className="content-layout">
            <section className="results-panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {mode === "projects" ? "Your projects" : "Your files"}{" "}
                    <span className="count-badge">{visible.length}</span>
                  </h2>
                  <p className="muted small">
                    {scanning
                      ? progress
                      : scanned
                        ? "Scan complete · largest items first by default"
                        : "Choose a folder and start with a scan"}
                  </p>
                </div>
                <label className="search-box">
                  <Icon name="search" />
                  <input
                    aria-label="Search results"
                    type="search"
                    placeholder={
                      mode === "projects" ? "Search projects…" : "Search files…"
                    }
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </div>
              <div className="filters">
                <select
                  aria-label="Filter by type"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  disabled={busy}
                >
                  <option value="all">All types</option>
                  {(mode === "projects"
                    ? ["JavaScript", "Python", "Rust", "PHP"]
                    : [
                        "Archives",
                        "Installers",
                        "Media",
                        "Images",
                        "Documents",
                        "Other",
                      ]
                  ).map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by age"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  disabled={busy}
                >
                  <option value={0}>Any age</option>
                  {[7, 30, 90, 180, 365].map((n) => (
                    <option key={n} value={n}>
                      Older than {n} days
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by minimum size"
                  value={minimum}
                  onChange={(e) => setMinimum(Number(e.target.value))}
                  disabled={busy}
                >
                  <option value={0}>Any size</option>
                  <option value={104857600}>Over 100 MB</option>
                  <option value={1073741824}>Over 1 GB</option>
                </select>
                <select
                  className="sort-select"
                  aria-label="Sort results"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  disabled={busy}
                >
                  <option value="size">Largest first</option>
                  <option value="age">Oldest first</option>
                  <option value="name">Name A–Z</option>
                </select>
              </div>
              <div className="selection-toolbar">
                <label>
                  <input
                    type="checkbox"
                    aria-label="Select all visible items"
                    checked={allVisibleSelected}
                    disabled={busy || !visibleEligible.length}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        visibleEligible.forEach((item) =>
                          allVisibleSelected
                            ? next.delete(item.path)
                            : next.add(item.path),
                        );
                        return next;
                      })
                    }
                  />
                  Select visible
                </label>
                <span>
                  {selectedItems.length} selected
                  {hiddenSelection > 0 &&
                    ` · ${hiddenSelection} hidden by filters`}
                </span>
                {selected.size > 0 && (
                  <button
                    className="text-button"
                    onClick={() => setSelected(new Set())}
                    disabled={busy}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="result-list" aria-busy={scanning}>
                {scanning ? (
                  <div className="empty-state">
                    <span className="scan-orbit">
                      <Icon name="search" />
                    </span>
                    <h3>Looking for breathing room</h3>
                    <p>{progress}</p>
                    <span className="spinner" />
                  </div>
                ) : visible.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-art">
                      <Icon
                        name={mode === "projects" ? "folder" : "download"}
                      />
                      <span className="mini-spark">
                        <Icon name="spark" />
                      </span>
                    </span>
                    <h3>
                      {items.length
                        ? "Nothing matches these filters"
                        : scanned
                          ? "Nothing to clean here"
                          : "A fresh start is a scan away"}
                    </h3>
                    <p>
                      {items.length
                        ? "Try another search, age, or size filter."
                        : scanned
                          ? mode === "projects"
                            ? "Try another folder. We look for JavaScript, Python, Rust, and PHP project artifacts."
                            : "Try another folder or include subfolders."
                          : "Your folders, their storage, and your next cleanup plan will appear here."}
                    </p>
                    {items.length > 0 && (
                      <button
                        className="button secondary"
                        onClick={() => {
                          setSearch("");
                          setKind("all");
                          setDays(0);
                          setMinimum(0);
                        }}
                      >
                        Reset filters
                      </button>
                    )}
                  </div>
                ) : (
                  visible.map((item) => {
                    const project = "directories" in item ? item : null;
                    const choices = project ? directoryChoices(project) : [];
                    return (
                      <article
                        key={item.path}
                        className={`result-item ${selected.has(item.path) ? "is-selected" : ""}`}
                      >
                        <div className="result-row">
                          <input
                            type="checkbox"
                            aria-label={`Select ${projectName(item.path)}`}
                            checked={selected.has(item.path)}
                            onChange={() => toggle(item.path)}
                            disabled={busy || !eligible(item)}
                          />
                          <span
                            className={`item-symbol ${project ? "project-symbol" : "file-symbol"}`}
                          >
                            <Icon name={project ? "folder" : "file"} />
                          </span>
                          <div className="item-info">
                            <div className="item-title">
                              <h3>{projectName(item.path)}</h3>
                              <span className="type-badge">{item.kind}</span>
                            </div>
                            <p title={item.path}>{item.path}</p>
                            <span className="item-age">
                              <Icon name="clock" />
                              {ageLabel(item.last_modified)}
                              {project &&
                                ` · ${project.directories.length} cleanup folders`}
                            </span>
                          </div>
                          <div className="item-size">
                            <strong>{formatSize(item.size)}</strong>
                            {project && (
                              <small>
                                {formatSize(eligibleSize(item))} selected types
                              </small>
                            )}
                          </div>
                          {project && (
                            <button
                              className={`expand-button ${expanded.has(item.path) ? "expanded" : ""}`}
                              aria-label={`Show cleanup folders for ${projectName(item.path)}`}
                              aria-expanded={expanded.has(item.path)}
                              onClick={() => toggle(item.path, setExpanded)}
                            >
                              <Icon name="chevron" />
                            </button>
                          )}
                        </div>
                        {project && expanded.has(item.path) && (
                          <div className="directory-list">
                            {project.directories.map((directory) => (
                              <label
                                key={directory.name}
                                className="directory-row"
                              >
                                <input
                                  type="checkbox"
                                  checked={choices.some(
                                    (d) => d.name === directory.name,
                                  )}
                                  onChange={() =>
                                    toggleDirectory(project, directory.name)
                                  }
                                  disabled={busy}
                                />
                                <span
                                  className={`category-dot ${directory.category}`}
                                />
                                <code>{directory.name}</code>
                                <span className="muted">
                                  {directory.category}
                                </span>
                                <strong>
                                  {!directory.complete && "≥ "}
                                  {formatSize(directory.size)}
                                </strong>
                                {!directory.complete && (
                                  <span title="Some files were unreadable. Size is a lower estimate.">
                                    <Icon name="warning" />
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
              <div className="results-footer">
                <Icon name="shield" />
                <span>
                  {mode === "projects"
                    ? "Choose cleanup folders, then review their full paths."
                    : "Hidden files and symbolic links are excluded from the scan."}
                </span>
              </div>
            </section>
            <aside className="cleanup-panel">
              <div className="section-heading">
                <h2>Cleanup plan</h2>
                <Icon name="spark" />
              </div>
              <p className="muted small">
                {mode === "projects"
                  ? "Choose how much of a fresh start you need."
                  : "Only your selected files will be removed."}
              </p>
              {mode === "projects" && (
                <>
                  <div className="presets">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        className={activePreset === preset.id ? "active" : ""}
                        onClick={() => {
                          setCategories(new Set(preset.categories));
                          setOverrides({});
                        }}
                        disabled={busy}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="category-options">
                    {CATEGORIES.map((category) => (
                      <label key={category.id}>
                        <input
                          type="checkbox"
                          checked={categories.has(category.id)}
                          onChange={() => {
                            toggle(category.id, setCategories);
                            setOverrides({});
                          }}
                          disabled={busy}
                        />
                        <span>
                          <strong>{category.label}</strong>
                          <small>{category.description}</small>
                        </span>
                        <span className={`category-dot ${category.id}`} />
                      </label>
                    ))}
                  </div>
                  {activePreset === "custom" && (
                    <p className="custom-note">
                      Custom folders selected in your project details.
                    </p>
                  )}
                </>
              )}
              <div className="storage-breakdown">
                <p className="eyebrow">STORAGE BREAKDOWN</p>
                <div className="storage-bar">
                  {totalBytes ? (
                    breakdown.map((part) => (
                      <span
                        key={part.id}
                        className={part.id}
                        style={{ width: `${(part.size / totalBytes) * 100}%` }}
                        title={`${part.label}: ${formatSize(part.size)}`}
                      />
                    ))
                  ) : (
                    <span className="empty-bar" />
                  )}
                </div>
                {breakdown.map((part) => (
                  <div className="breakdown-row" key={part.id}>
                    <span className={`category-dot ${part.id}`} />
                    {part.label}
                    <strong>{formatSize(part.size)}</strong>
                  </div>
                ))}
              </div>
              <div className="plan-total">
                <span>Ready to clear</span>
                <strong>{formatSize(selectedBytes)}</strong>
                <p>
                  {selectedItems.length
                    ? `${selectedItems.length} ${mode === "projects" ? "projects" : "files"} selected`
                    : "Select items to build your plan"}
                </p>
                <button
                  className="button primary"
                  disabled={busy || !selectedItems.length}
                  onClick={review}
                >
                  <Icon name="trash" />
                  Review cleanup
                  <Icon name="arrow" />
                </button>
                <small>Nothing is deleted until you confirm.</small>
              </div>
            </aside>
          </div>
          <footer className="page-footer">
            <span>Built for a lighter workspace.</span>
            <span>
              Storage estimates measure file data; disk space recovered may
              differ.
            </span>
          </footer>
        </div>
      </main>
      <dialog
        ref={dialog}
        className="review-dialog"
        aria-labelledby="review-title"
        onCancel={(event) => {
          if (deleting) event.preventDefault();
          else setPlan(null);
        }}
      >
        {plan && (
          <>
            <div className="dialog-header">
              <span className="review-icon">
                <Icon name="trash" />
              </span>
              <button
                aria-label="Close cleanup review"
                onClick={() => setPlan(null)}
                disabled={deleting}
              >
                <Icon name="close" />
              </button>
            </div>
            <p className="eyebrow accent">ONE LAST LOOK</p>
            <h2 id="review-title">Review your cleanup</h2>
            <p className="muted">
              {plan.entries.length}{" "}
              {plan.mode === "projects" ? "projects" : "files"} ·{" "}
              {formatSize(plan.entries.reduce((sum, e) => sum + e.size, 0))}{" "}
              estimated file data
            </p>
            <div className="review-list">
              {plan.entries.map((entry) => (
                <div key={entry.path}>
                  <strong>{projectName(entry.path)}</strong>
                  <p>{entry.path}</p>
                  {entry.names.length > 0 && (
                    <div className="review-tags">
                      {entry.names.map((name) => (
                        <code key={name}>{name}</code>
                      ))}
                    </div>
                  )}
                  <span>{formatSize(entry.size)}</span>
                </div>
              ))}
            </div>
            <div className="permanent-note">
              <Icon name="warning" />
              <p>
                {plan.mode === "projects"
                  ? "These folders will be permanently deleted. Packages need reinstalling and builds need regenerating. Check for anything you want to keep inside them."
                  : "These files will be permanently deleted, not moved to Trash. Make sure you have a copy of anything you may need later."}
              </p>
            </div>
            <label className="acknowledge">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                disabled={deleting}
              />
              I’ve reviewed the paths and want to delete these items.
            </label>
            {deleting && (
              <p className="muted small" role="status">
                {progress || "Deleting selected files…"}
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={deleting}
                onClick={() => setPlan(null)}
              >
                Keep my files
              </button>
              <button
                className="button danger"
                disabled={!acknowledged || deleting}
                onClick={performCleanup}
              >
                {deleting ? (
                  <span className="spinner" />
                ) : (
                  <Icon name="trash" />
                )}
                {deleting ? "Cleaning…" : "Delete selected items"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
export default App;
