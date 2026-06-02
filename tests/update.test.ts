import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  buildUpdateWarning,
  checkPackageUpdate,
  handleAutoUpdateResult,
  isVersionNewer,
  parseLatestVersion,
  selectUpdateRemoveDir,
} from "../src/update";

async function tempDir() {
  const dir = join(tmpdir(), `opencode-mini-session-test-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, JSON.stringify(data), "utf8");
}

async function packageDir(root: string, version = "0.3.0") {
  await mkdir(root, { recursive: true });
  await writeJson(join(root, "package.json"), {
    name: "opencode-mini-session",
    version,
  });
  return root;
}

describe("isVersionNewer", () => {
  it("compares major, minor, and patch versions", () => {
    expect(isVersionNewer("1.0.1", "1.0.0")).toBe(true);
    expect(isVersionNewer("1.1.0", "1.0.9")).toBe(true);
    expect(isVersionNewer("2.0.0", "1.9.9")).toBe(true);
    expect(isVersionNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isVersionNewer("1.0.0", "1.0.1")).toBe(false);
  });

  it("handles v prefixes, prereleases, and build metadata", () => {
    expect(isVersionNewer("v1.0.1", "1.0.0")).toBe(true);
    expect(isVersionNewer("1.0.0", "1.0.0-beta.1")).toBe(true);
    expect(isVersionNewer("1.0.0-beta.2", "1.0.0-beta.1")).toBe(true);
    expect(isVersionNewer("1.0.0-beta.1", "1.0.0")).toBe(false);
    expect(isVersionNewer("1.0.0+build.2", "1.0.0+build.1")).toBe(false);
  });
});

describe("parseLatestVersion", () => {
  it("accepts npm latest payloads", () => {
    expect(parseLatestVersion({ version: "0.4.0" })).toBe("0.4.0");
  });

  it("rejects invalid payloads", () => {
    expect(parseLatestVersion({ version: 4 })).toBeUndefined();
    expect(parseLatestVersion(null)).toBeUndefined();
    expect(parseLatestVersion("0.4.0")).toBeUndefined();
  });
});

describe("selectUpdateRemoveDir", () => {
  it("selects the wrapper directory for opencode cache layouts", async () => {
    const root = await tempDir();
    try {
      const wrapper = join(root, "wrapper");
      const installed = join(wrapper, "node_modules", "opencode-mini-session");
      await mkdir(installed, { recursive: true });
      await writeJson(join(wrapper, "package.json"), {
        dependencies: { "opencode-mini-session": "0.3.0" },
      });

      await expect(selectUpdateRemoveDir(installed, "opencode-mini-session")).resolves.toBe(wrapper);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the package directory when no wrapper is detected", async () => {
    const root = await tempDir();
    try {
      const installed = join(root, "node_modules", "opencode-mini-session");
      await mkdir(installed, { recursive: true });

      await expect(selectUpdateRemoveDir(installed, "opencode-mini-session")).resolves.toBe(installed);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("checkPackageUpdate", () => {
  it("returns no update when latest is equal or older", async () => {
    const root = await tempDir();
    try {
      const installed = await packageDir(root, "0.4.0");
      const signal = new AbortController().signal;

      await expect(checkPackageUpdate(installed, signal, async () => "0.4.0")).resolves.toEqual({
        updated: false,
      });
      await expect(checkPackageUpdate(installed, signal, async () => "0.3.9")).resolves.toEqual({
        updated: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes the selected directory when an update is needed", async () => {
    const root = await tempDir();
    try {
      const wrapper = join(root, "wrapper");
      const installed = await packageDir(join(wrapper, "node_modules", "opencode-mini-session"));
      await writeJson(join(wrapper, "package.json"), {
        dependencies: { "opencode-mini-session": "0.3.0" },
      });

      const result = await checkPackageUpdate(installed, new AbortController().signal, async () => "0.4.0");

      expect(result).toEqual({
        updated: true,
        name: "opencode-mini-session",
        current: "0.3.0",
        latest: "0.4.0",
        removeDir: wrapper,
      });
      await expect(readFile(join(wrapper, "package.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns metadata when removal fails", async () => {
    const root = await tempDir();
    try {
      const installed = await packageDir(root, "0.3.0");

      const result = await checkPackageUpdate(
        installed,
        new AbortController().signal,
        async () => "0.4.0",
        async () => {
          throw new Error("failed");
        },
      );

      expect(result).toEqual({
        updated: false,
        error: "remove_failed",
        name: "opencode-mini-session",
        current: "0.3.0",
        latest: "0.4.0",
        removeDir: root,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("update presentation", () => {
  it("builds the restart warning", () => {
    expect(buildUpdateWarning("0.4.0")).toBe(
      "New version available: 0.4.0. Restart opencode to finish updating.",
    );
  });

  it("sets warning and shows toast for successful updates", () => {
    const toast = vi.fn();
    const setUpdateWarning = vi.fn();

    handleAutoUpdateResult(
      { ui: { toast } },
      {
        updated: true,
        name: "opencode-mini-session",
        current: "0.3.0",
        latest: "0.4.0",
        removeDir: "/cache/wrapper",
      },
      setUpdateWarning,
    );

    expect(setUpdateWarning).toHaveBeenCalledWith(
      "New version available: 0.4.0. Restart opencode to finish updating.",
    );
    expect(toast).toHaveBeenCalledWith({
      variant: "info",
      message: "opencode-mini-session updated to 0.4.0. Restart opencode to finish.",
    });
  });

  it("shows a warning toast for removal failures", () => {
    const toast = vi.fn();
    const setUpdateWarning = vi.fn();

    handleAutoUpdateResult(
      { ui: { toast } },
      {
        updated: false,
        error: "remove_failed",
        name: "opencode-mini-session",
        current: "0.3.0",
        latest: "0.4.0",
        removeDir: "/cache/wrapper",
      },
      setUpdateWarning,
    );

    expect(setUpdateWarning).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      variant: "warning",
      message: "Could not update opencode-mini-session. Clear the opencode plugin cache and restart.",
    });
  });
});
