import { expect, test } from "bun:test";
import {
  activePlanEntries,
  artifactPath,
  mergeScanFeedback,
  chosenDirectories,
  formatSize,
  matchesFilters,
  projectName,
} from "../src/storage";
import type { ProjectInfo } from "../src/storage";
const project: ProjectInfo = {
  path: "/projects/demo",
  kind: "JavaScript",
  size: 100,
  last_modified: Math.floor(Date.now() / 1000) - 90 * 86400,
  directories: [
    {
      name: "node_modules",
      category: "dependencies",
      size: 80,
      last_modified: 1,
      complete: true,
    },
    {
      name: "dist",
      category: "build",
      size: 15,
      last_modified: 1,
      complete: true,
    },
    {
      name: ".turbo",
      category: "cache",
      size: 5,
      last_modified: 1,
      complete: true,
    },
  ],
};
test("cache and build selections exclude dependencies from the estimate", () => {
  expect(
    chosenDirectories(project, new Set(["cache", "build"]), {}).reduce(
      (sum, d) => sum + d.size,
      0,
    ),
  ).toBe(20);
});
test("per-project overrides can select a folder outside the preset", () => {
  expect(
    chosenDirectories(project, new Set(["cache"]), {
      [project.path]: ["node_modules"],
    }).map((d) => d.name),
  ).toEqual(["node_modules"]);
});
test("an empty override stays empty", () => {
  expect(
    chosenDirectories(project, new Set(["cache", "build"]), {
      [project.path]: [],
    }),
  ).toEqual([]);
});
test("search, type, age, and size filters apply together", () => {
  expect(matchesFilters(project, "DEMO", "JavaScript", 30, 100)).toBe(true);
  expect(matchesFilters(project, "other", "all", 0, 0)).toBe(false);
  expect(matchesFilters(project, "", "Python", 0, 0)).toBe(false);
  expect(matchesFilters(project, "", "all", 180, 0)).toBe(false);
  expect(matchesFilters(project, "", "all", 0, 101)).toBe(false);
  expect(
    matchesFilters({ ...project, last_modified: 0 }, "", "all", 30, 0),
  ).toBe(false);
});
test("project names support Windows and Unix paths", () => {
  expect(projectName("C:\\Users\\developer\\demo")).toBe("demo");
  expect(projectName("/projects/demo/")).toBe("demo");
});
test("size formatting handles zero and terabytes", () => {
  expect(formatSize(0)).toBe("0 B");
  expect(formatSize(1024)).toBe("1 KB");
  expect(formatSize(1024 ** 4)).toBe("1 TB");
});

test("permission totals survive aggregation while examples remain bounded", () => {
  const feedback = mergeScanFeedback(
    { skipped_permissions: 50, skipped_system: 2, examples: ["/a", "/b"] },
    {
      skipped_permissions: 30,
      skipped_system: 4,
      examples: ["/b", "/c", "/d"],
    },
  );
  expect(feedback).toEqual({
    skipped_permissions: 80,
    skipped_system: 6,
    examples: ["/a", "/b", "/c"],
  });
});
test("artifact paths preserve Windows separators and nested target paths", () => {
  expect(artifactPath("C:\\Projects\\app\\", ".angular/cache")).toBe(
    "C:\\Projects\\app\\.angular\\cache",
  );
  expect(artifactPath("/projects/app/", "dist")).toBe("/projects/app/dist");
});
test("unchecked review entries never reach cleanup", () => {
  const entries = [
    { path: "/one", size: 10, names: ["dist"], included: true },
    { path: "/two", size: 20, names: [], included: false },
  ];
  expect(
    activePlanEntries({ mode: "files", entries }).map((e) => e.path),
  ).toEqual(["/one"]);
  expect(
    activePlanEntries({ mode: "projects", entries }).map((e) => e.path),
  ).toEqual(["/one"]);
});
