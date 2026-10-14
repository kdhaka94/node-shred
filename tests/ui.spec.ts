import { test, expect } from "@playwright/test";
const fixture = {
  path: "/projects/demo",
  kind: "JavaScript",
  size: 100 * 1024 * 1024,
  last_modified: Math.floor(Date.now() / 1000) - 90 * 86400,
  directories: [
    {
      name: "node_modules",
      category: "dependencies",
      size: 80 * 1024 * 1024,
      last_modified: 1,
      complete: true,
    },
    {
      name: "dist",
      category: "build",
      size: 15 * 1024 * 1024,
      last_modified: 1,
      complete: true,
    },
    {
      name: ".turbo",
      category: "cache",
      size: 5 * 1024 * 1024,
      last_modified: 1,
      complete: true,
    },
  ],
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ fixture }) => {
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      Object.assign(window, {
        cleanupCalls: calls,
        __TAURI_INTERNALS__: {
          invoke: async (
            command: string,
            args: Record<string, unknown> = {},
          ) => {
            calls.push({ command, args });
            if (command === "get_drives")
              return [{ name: "Projects", path: "/projects" }];
            if (command === "scan_for_projects")
              return { projects: [fixture], warnings: [] };
            if (command === "delete_project_directories") {
              const names = args.directories as string[];
              const removed = fixture.directories.filter((d) =>
                names.includes(d.name),
              );
              const directories = fixture.directories.filter(
                (d) => !names.includes(d.name),
              );
              return {
                removed,
                errors: [],
                remaining: {
                  ...fixture,
                  directories,
                  size: directories.reduce((s, d) => s + d.size, 0),
                },
              };
            }
            if (command === "scan_folder_files")
              return {
                files: [
                  {
                    path: "/downloads/installer.dmg",
                    name: "installer.dmg",
                    kind: "Installers",
                    size: 1024,
                    last_modified: 1,
                  },
                  {
                    path: "/downloads/notes.pdf",
                    name: "notes.pdf",
                    kind: "Documents",
                    size: 100,
                    last_modified: 1,
                  },
                ],
                warnings: [],
              };
            if (command === "delete_selected_files")
              return { removed: args.paths, bytes_freed: 1024, errors: [] };
            throw new Error(`Unexpected command: ${command}`);
          },
        },
      });
    },
    { fixture },
  );
  await page.goto("/");
});
test("review is required and generated folders are removed selectively", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Scan folders" }).click();
  await page
    .getByRole("checkbox", { name: "Select demo", exact: true })
    .check();
  await expect(page.locator(".selected-stat")).toContainText("20 MB");
  await page.getByRole("button", { name: "Review cleanup" }).click();
  const review = page.getByRole("dialog");
  await expect(review.locator(".review-tags")).toContainText("dist");
  await expect(review.locator(".review-tags")).not.toContainText(
    "node_modules",
  );
  const confirm = review.getByRole("button", { name: "Delete selected items" });
  await expect(confirm).toBeDisabled();
  await review.getByRole("checkbox").check();
  await confirm.click();
  await expect(review).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("20 MB");
  await expect(page.locator(".result-item")).toHaveCount(1);
  await expect(page.locator(".item-size")).toContainText("80 MB");
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          cleanupCalls: { command: string; args: unknown }[];
        }
      ).cleanupCalls,
  );
  expect(
    calls.find((call) => call.command === "delete_project_directories")?.args,
  ).toEqual({ path: "/projects/demo", directories: ["dist", ".turbo"] });
});
test("select visible respects search and individual folders override presets", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Scan folders" }).click();
  await page
    .getByRole("searchbox", { name: "Search results" })
    .fill("does not exist");
  await expect(
    page.getByRole("checkbox", { name: "Select all visible items" }),
  ).toBeDisabled();
  await page.getByRole("searchbox", { name: "Search results" }).fill("");
  await page
    .getByRole("checkbox", { name: "Select all visible items" })
    .check();
  await page
    .getByRole("button", { name: "Show cleanup folders for demo" })
    .click();
  await page
    .locator(".directory-row")
    .filter({ hasText: "node_modules" })
    .getByRole("checkbox")
    .check();
  await expect(page.locator(".selected-stat")).toContainText("100 MB");
  await page.getByRole("button", { name: "Caches only", exact: true }).click();
  await expect(page.locator(".selected-stat")).toContainText("5 MB");
});
test("files mode reviews exact paths and removes only selected files", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Files & downloads" }).click();
  await page
    .getByRole("textbox", { name: "Folder to scan for files" })
    .fill("/downloads");
  await page.getByRole("button", { name: "Scan folders" }).click();
  await page
    .getByRole("combobox", { name: "Filter by type" })
    .selectOption("Installers");
  await expect(page.locator(".result-item")).toHaveCount(1);
  await page
    .getByRole("checkbox", { name: "Select installer.dmg", exact: true })
    .check();
  await page.getByRole("button", { name: "Review cleanup" }).click();
  const review = page.getByRole("dialog");
  await expect(review).toContainText("/downloads/installer.dmg");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Delete selected items" }).click();
  await page
    .getByRole("combobox", { name: "Filter by type" })
    .selectOption("all");
  await expect(page.locator(".result-item")).toHaveCount(1);
  await expect(page.locator(".result-item")).toContainText("notes.pdf");
});
test("layout stays within mobile and desktop viewports", async ({ page }) => {
  await page.getByRole("button", { name: "Scan folders" }).click();
  for (const width of [1280, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
