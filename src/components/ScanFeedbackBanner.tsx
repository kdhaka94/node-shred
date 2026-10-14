import type { ScanFeedback } from "../storage";
import { Icon } from "./Icon";
export function ScanFeedbackBanner({ feedback }: { feedback: ScanFeedback }) {
  const total = feedback.skipped_permissions + feedback.skipped_system;
  if (!total) return null;
  return (
    <section className="scan-feedback" aria-label="Scan coverage">
      <div role="status">
        <Icon name="shield" />
        <p>
          <strong>Scan continued in accessible folders.</strong>
          <span>
            {feedback.skipped_permissions > 0 &&
              `${feedback.skipped_permissions} protected or unreadable locations skipped. `}
            {feedback.skipped_system > 0 &&
              `${feedback.skipped_system} system locations excluded. `}
            You can narrow your scan to Projects or Downloads.
          </span>
        </p>
      </div>
      {feedback.examples.length > 0 && (
        <details>
          <summary>See examples of skipped locations</summary>
          <ul>
            {feedback.examples.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
          <p>
            These locations were not scanned or selected for cleanup. You don’t
            need to grant broad system access.
          </p>
        </details>
      )}
    </section>
  );
}
