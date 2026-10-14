import { expect, test } from "bun:test";
import {
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
