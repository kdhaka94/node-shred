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
            if (command === "select_folders")
              return (window as any).pickerResult || [];
            if (command === "validate_scan_folder") {
              if ((window as any).navigationFailure)
                throw new Error("Choose an existing folder");
              return args.path;
            }
            if (command === "open_folder" || command === "reveal_file") {
              if ((window as any).navigationFailure)
                throw new Error(
                  "This folder has moved. Choose an existing folder.",
                );
              return;
            }
            if (command === "get_drives")
              return [{ name: "Projects", path: "/projects" }];
            if (command === "scan_for_projects") {
              if ((window as any).scanFailure)
                throw new Error(
                  "Cannot read the selected folder. Choose an accessible folder.",
                );
              return {
                projects: [fixture],
                warnings: [],
                feedback: (window as any).scanFeedback,
              };
            }
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
  await expect(review.locator(".review-targets")).toContainText("dist");
  await expect(
    review.getByRole("checkbox", { name: "Delete node_modules in demo" }),
  ).not.toBeChecked();
  const confirm = review.getByRole("button", {
    name: "Delete checked folders",
  });
  await expect(confirm).toBeDisabled();
  await review
    .getByRole("checkbox", { name: "Confirm reviewed paths" })
    .check();
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
  await review
    .getByRole("checkbox", { name: "Confirm reviewed paths" })
    .check();
  await review.getByRole("button", { name: "Delete checked files" }).click();
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
  await page
    .getByRole("checkbox", { name: "Select demo", exact: true })
    .check();
  await page.getByRole("button", { name: "Review cleanup" }).click();
  for (const width of [1280, 800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width);
    expect(box!.height).toBeLessThanOrEqual(900);
    expect(
      await page.evaluate(
        () =>
          document.querySelector("dialog")!.scrollWidth <=
          document.querySelector("dialog")!.clientWidth,
      ),
    ).toBe(true);
  }
});

test("native folder selection adds locations, cancellation keeps them, and Open inspects without deleting", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).pickerResult = ["/work/folder with spaces"];
  });
  await page.getByRole("button", { name: "Choose folders…" }).click();
  await expect(
    page.locator(".location").filter({ hasText: "/work/folder with spaces" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open folder with spaces in file manager" })
    .click();
  await page.evaluate(() => {
    (window as any).pickerResult = [];
  });
  await page.getByRole("button", { name: "Choose folders…" }).click();
  await expect(page.locator(".location")).toHaveCount(2);
  const calls = await page.evaluate(() => (window as any).cleanupCalls);
  expect(
    calls.find((call: any) => call.command === "open_folder").args,
  ).toEqual({ path: "/work/folder with spaces" });
  expect(calls.some((call: any) => call.command.startsWith("delete_"))).toBe(
    false,
  );
});
test("an unreadable selected root is actionable while permission skips are summarized", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).scanFeedback = {
      skipped_permissions: 70,
      skipped_system: 9,
      examples: ["/protected/one", "/protected/two"],
    };
  });
  await page.getByRole("button", { name: "Scan folders" }).click();
  const coverage = page.getByRole("region", { name: "Scan coverage" });
  await expect(coverage).toContainText(
    "70 protected or unreadable locations skipped",
  );
  await expect(page.locator(".banner.warning")).toHaveCount(0);
  await coverage.getByText("See examples of skipped locations").click();
  await expect(coverage).toContainText("/protected/one");
  await expect(
    page.getByRole("checkbox", { name: "Select demo", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).scanFailure = true;
  });
  await page.getByRole("button", { name: "Scan folders" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Choose an accessible folder",
  );
});
test("changing locations or settings requires a fresh scan before cleanup", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Scan folders" }).click();
  await page
    .getByRole("checkbox", { name: "Select demo", exact: true })
    .check();
  const review = page.getByRole("button", { name: "Review cleanup" });
  await expect(review).toBeEnabled();
  await page.evaluate(() => {
    (window as any).pickerResult = ["/new-projects"];
  });
  await page.getByRole("button", { name: "Choose folders…" }).click();
  await expect(review).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "Scan again before cleanup",
  );
  await page.getByRole("button", { name: "Scan folders" }).click();
  await page
    .getByRole("checkbox", { name: "Select demo", exact: true })
    .check();
  await expect(review).toBeEnabled();
  await page.getByText("Scan settings", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Scan folder depth" })
    .selectOption("4");
  await expect(review).toBeDisabled();
});
test("review changes reset confirmation and deletion uses only checked folders", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Scan folders" }).click();
  await page
    .getByRole("checkbox", { name: "Select demo", exact: true })
    .check();
  await page.getByRole("button", { name: "Review cleanup" }).click();
  const review = page.getByRole("dialog");
  await expect(review.locator("#review-title")).toBeFocused();
  await review
    .getByRole("checkbox", { name: "Confirm reviewed paths" })
    .check();
  await review.getByRole("checkbox", { name: "Delete dist in demo" }).uncheck();
  await expect(
    review.getByRole("checkbox", { name: "Confirm reviewed paths" }),
  ).not.toBeChecked();
  await expect(
    review.getByRole("button", { name: "Delete checked folders" }),
  ).toBeDisabled();
  await expect(review).toContainText("/projects/demo/.turbo");
  await review
    .locator(".review-target")
    .filter({ hasText: "/projects/demo/.turbo" })
    .getByRole("button")
    .click();
  await review
    .getByRole("checkbox", { name: "Confirm reviewed paths" })
    .check();
  await review.getByRole("button", { name: "Delete checked folders" }).click();
  await expect(review).not.toBeVisible();
  const calls = await page.evaluate(() => (window as any).cleanupCalls);
  expect(
    calls.find((call: any) => call.command === "open_folder").args.path,
  ).toBe("/projects/demo/.turbo");
  expect(
    calls.find((call: any) => call.command === "delete_project_directories")
      .args.directories,
  ).toEqual([".turbo"]);
});
test("Escape restores focus, Tab stays inside review, and empty review cannot delete", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Scan folders" }).click();
  await page
    .getByRole("checkbox", { name: "Select demo", exact: true })
    .check();
  const trigger = page.getByRole("button", { name: "Review cleanup" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  for (let i = 0; i < 22; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("checkbox", { name: "Delete dist in demo" }).uncheck();
  await dialog
    .getByRole("checkbox", { name: "Delete .turbo in demo" })
    .uncheck();
  await expect(
    dialog.getByRole("checkbox", { name: "Confirm reviewed paths" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Delete checked folders" }),
  ).toBeDisabled();
});
test("file reveal, editable review, and changed folder safeguards preserve unchecked files", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Files & downloads" }).click();
  await page.evaluate(() => {
    (window as any).pickerResult = ["/downloads"];
  });
  await page.getByRole("button", { name: "Choose folder…" }).click();
  await expect(
    page.getByRole("textbox", { name: "Folder to scan for files" }),
  ).toHaveValue("/downloads");
  await page.getByRole("button", { name: "Scan folders" }).click();
  await page
    .getByRole("checkbox", { name: "Select installer.dmg", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "Select all visible items" }),
  ).toHaveJSProperty("indeterminate", true);
  await page
    .getByRole("checkbox", { name: "Select notes.pdf", exact: true })
    .check();
  await page.getByRole("button", { name: "Review cleanup" }).click();
  const review = page.getByRole("dialog");
  await review.getByRole("checkbox", { name: "Delete notes.pdf" }).uncheck();
  await review
    .locator(".review-entry")
    .filter({ hasText: "installer.dmg" })
    .getByRole("button")
    .click();
  await review
    .getByRole("checkbox", { name: "Confirm reviewed paths" })
    .check();
  await review.getByRole("button", { name: "Delete checked files" }).click();
  await expect(page.locator(".result-item")).toContainText("notes.pdf");
  const calls = await page.evaluate(() => (window as any).cleanupCalls);
  expect(
    calls.find((call: any) => call.command === "reveal_file").args,
  ).toEqual({ path: "/downloads/installer.dmg" });
  expect(
    calls.find((call: any) => call.command === "delete_selected_files").args
      .paths,
  ).toEqual(["/downloads/installer.dmg"]);
  await page
    .getByRole("checkbox", { name: "Select notes.pdf", exact: true })
    .check();
  await page
    .getByRole("textbox", { name: "Folder to scan for files" })
    .fill("/other");
  await expect(
    page.getByRole("button", { name: "Review cleanup" }),
  ).toBeDisabled();
});
test("navigation errors appear where the user is reviewing", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Scan folders" }).click();
  await page
    .getByRole("checkbox", { name: "Select demo", exact: true })
    .check();
  await page.getByRole("button", { name: "Review cleanup" }).click();
  await page.evaluate(() => {
    (window as any).navigationFailure = true;
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Open in file manager", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "This folder has moved",
  );
});
