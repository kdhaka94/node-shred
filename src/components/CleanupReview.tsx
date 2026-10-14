import { useEffect, useRef } from "react";
import type { CleanupPlan } from "../storage";
import {
  activePlanEntries,
  artifactPath,
  formatSize,
  projectName,
} from "../storage";
import { Icon } from "./Icon";
interface Props {
  plan: CleanupPlan | null;
  deleting: boolean;
  acknowledged: boolean;
  progress: string;
  navigationError: string;
  fileManager: string;
  openingPath: string | null;
  onChange: (plan: CleanupPlan) => void;
  onAcknowledge: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
  onOpen: (path: string, file?: boolean) => void;
}
export function CleanupReview({
  plan,
  deleting,
  acknowledged,
  progress,
  navigationError,
  fileManager,
  openingPath,
  onChange,
  onAcknowledge,
  onClose,
  onConfirm,
  onOpen,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (plan && dialog.current && !dialog.current.open) {
      trigger.current = document.activeElement as HTMLElement;
      dialog.current.showModal();
      title.current?.focus();
    } else if (!plan && dialog.current?.open) {
      dialog.current.close();
      if (trigger.current && !trigger.current.hasAttribute("disabled"))
        trigger.current.focus();
      else document.querySelector<HTMLElement>(".panel-heading h2")?.focus();
    }
  }, [plan]);
  const entries = plan ? activePlanEntries(plan) : [];
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  function toggleTarget(path: string, name?: string) {
    if (!plan) return;
    onAcknowledge(false);
    onChange({
      ...plan,
      entries: plan.entries.map((entry) => {
        if (entry.path !== path) return entry;
        if (plan.mode === "files")
          return { ...entry, included: entry.included === false };
        const names = entry.names.includes(name!)
          ? entry.names.filter((n) => n !== name)
          : [...entry.names, name!];
        return {
          ...entry,
          names,
          size: (entry.directories || [])
            .filter((d) => names.includes(d.name))
            .reduce((sum, d) => sum + d.size, 0),
        };
      }),
    });
  }
  return (
    <dialog
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ),
        );
        if (!controls.length) {
          event.preventDefault();
          title.current?.focus();
          return;
        }
        const index = controls.indexOf(document.activeElement as HTMLElement);
        if (
          (event.shiftKey && index <= 0) ||
          (!event.shiftKey && (index === controls.length - 1 || index === -1))
        ) {
          event.preventDefault();
          controls[event.shiftKey ? controls.length - 1 : 0].focus();
        }
      }}
      ref={dialog}
      className="review-dialog"
      aria-labelledby="review-title"
      onCancel={(event) => {
        if (deleting) event.preventDefault();
        else onClose();
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
              onClick={onClose}
              disabled={deleting}
            >
              <Icon name="close" />
            </button>
          </div>
          <p className="eyebrow accent">CHECK EVERY ITEM</p>
          <h2 ref={title} tabIndex={-1} id="review-title">
            Review your cleanup
          </h2>
          <p className="muted" role="status">
            {entries.length} {plan.mode === "projects" ? "projects" : "files"} ·{" "}
            {formatSize(total)} estimated file data
          </p>
          <p className="review-help">
            Uncheck anything you want to keep. Open a folder in {fileManager} to
            inspect it first.
          </p>
          <div
            className="review-list"
            role="group"
            aria-label="Cleanup targets"
            tabIndex={0}
          >
            {plan.entries.map((entry) => (
              <section
                className={`review-entry ${plan.mode === "files" && entry.included === false ? "excluded" : ""}`}
                key={entry.path}
              >
                <div className="review-entry-heading">
                  {plan.mode === "files" && (
                    <input
                      type="checkbox"
                      aria-label={`Delete ${projectName(entry.path)}`}
                      checked={entry.included !== false}
                      onChange={() => toggleTarget(entry.path)}
                      disabled={deleting}
                    />
                  )}
                  <strong>{projectName(entry.path)}</strong>
                  <span>{formatSize(entry.size)}</span>
                </div>
                <p className="full-path">{entry.path}</p>
                <button
                  className="folder-link"
                  disabled={deleting || openingPath === entry.path}
                  onClick={() => onOpen(entry.path, plan.mode === "files")}
                >
                  <Icon name="external" />
                  {plan.mode === "files" ? "Show" : "Open"} in {fileManager}
                </button>
                {plan.mode === "projects" && (
                  <div className="review-targets">
                    {(entry.directories || []).map((directory) => {
                      const path = artifactPath(entry.path, directory.name);
                      return (
                        <div className="review-target" key={directory.name}>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`Delete ${directory.name} in ${projectName(entry.path)}`}
                              checked={entry.names.includes(directory.name)}
                              onChange={() =>
                                toggleTarget(entry.path, directory.name)
                              }
                              disabled={deleting}
                            />
                            <strong>{directory.name}</strong>
                            <span>
                              {!directory.complete && "≥ "}
                              {formatSize(directory.size)}
                            </span>
                          </label>
                          <code className="full-path">{path}</code>
                          <button
                            className="folder-link"
                            onClick={() => onOpen(path)}
                            disabled={deleting || openingPath === path}
                          >
                            <Icon name="external" />
                            Open in {fileManager}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
          {navigationError && (
            <p className="review-error" role="alert">
              {navigationError}
            </p>
          )}
          <div className="permanent-note">
            <Icon name="warning" />
            <p>
              {plan.mode === "projects"
                ? "Selected folders will be permanently deleted. Dependencies need reinstalling and builds need regenerating. Keep anything you can’t recreate."
                : "Selected files will be permanently deleted, not moved to Trash. Keep a copy of anything you may need later."}
            </p>
          </div>
          <label className="acknowledge">
            <input
              type="checkbox"
              aria-label="Confirm reviewed paths"
              checked={acknowledged}
              onChange={(event) => onAcknowledge(event.target.checked)}
              disabled={deleting || !entries.length}
            />
            I’ve reviewed these paths and want to delete the checked items.
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
              onClick={onClose}
            >
              Keep my files
            </button>
            <button
              className="button danger"
              disabled={!entries.length || !acknowledged || deleting}
              onClick={onConfirm}
            >
              {deleting ? <span className="spinner" /> : <Icon name="trash" />}
              {deleting
                ? "Cleaning…"
                : `Delete checked ${plan.mode === "files" ? "files" : "folders"}`}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
