import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUpdateWarning,
  checkPackageUpdate,
  fetchLatestVersion,
  handleAutoUpdateResult,
  parseLatestVersion,
  UPDATE_SPEC,
} from "../src/update";
import { isSameMajorVersion, isVersionNewer } from "../src/version";

afterEach(() => vi.unstubAllGlobals());

async function tempDir() {
  const dir = join(
    tmpdir(),
    `opencode-mini-session-test-${crypto.randomUUID()}`,
  );
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

  it("checks major version compatibility separately from update ordering", () => {
    expect(isSameMajorVersion("1.1.4", "1.1.3")).toBe(true);
    expect(isSameMajorVersion("2.0.0", "1.1.3")).toBe(false);
    expect(isSameMajorVersion("invalid", "1.1.3")).toBe(false);
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

describe("v1 registry channel", () => {
  it("queries v1 rather than latest and passes the abort signal", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "1.1.4" }),
    });
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await fetchLatestVersion("opencode-mini-session", signal)).toBe("1.1.4");
    expect(fetch).toHaveBeenCalledWith(
      "https://registry.npmjs.org/opencode-mini-session/v1",
      { signal },
    );
  });

  it("silently handles missing tags, network errors, and malformed payloads", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 4 }) });
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 3; i++) {
      expect(await fetchLatestVersion("opencode-mini-session", new AbortController().signal)).toBeUndefined();
    }
  });
});

describe("checkPackageUpdate", () => {
  it("returns no update when latest is equal or older", async () => {
    const root = await tempDir();
    try {
      const installed = await packageDir(root, "0.4.0");
      const signal = new AbortController().signal;

      await expect(
        checkPackageUpdate(installed, signal, async () => "0.4.0"),
      ).resolves.toEqual({
        updated: false,
      });
      await expect(
        checkPackageUpdate(installed, signal, async () => "0.3.9"),
      ).resolves.toEqual({
        updated: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a same-major update without modifying the package", async () => {
    const root = await tempDir();
    try {
      const wrapper = join(root, "wrapper");
      const installed = await packageDir(
        join(wrapper, "node_modules", "opencode-mini-session"),
        "1.1.3",
      );
      await writeJson(join(wrapper, "package.json"), {
        dependencies: { "opencode-mini-session": "1.1.3" },
      });

      const result = await checkPackageUpdate(
        installed,
        new AbortController().signal,
        async () => "1.1.4",
      );

      expect(result).toEqual({
        updated: true,
        name: "opencode-mini-session",
        current: "1.1.3",
        latest: "1.1.4",
      });
      await expect(readFile(join(wrapper, "package.json"), "utf8")).resolves.toBe(
        JSON.stringify({ dependencies: { "opencode-mini-session": "1.1.3" } }),
      );
      await expect(readFile(join(installed, "package.json"), "utf8")).resolves.toBe(
        JSON.stringify({ name: "opencode-mini-session", version: "1.1.3" }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores a newer major version without modifying the package", async () => {
    const root = await tempDir();
    try {
      const wrapper = join(root, "wrapper");
      const installed = await packageDir(
        join(wrapper, "node_modules", "opencode-mini-session"),
        "1.1.3",
      );
      await writeJson(join(wrapper, "package.json"), {
        dependencies: { "opencode-mini-session": "1.1.3" },
      });

      await expect(
        checkPackageUpdate(
          installed,
          new AbortController().signal,
          async () => "2.0.0",
        ),
      ).resolves.toEqual({ updated: false });
      await expect(readFile(join(wrapper, "package.json"), "utf8")).resolves.toBe(
        JSON.stringify({ dependencies: { "opencode-mini-session": "1.1.3" } }),
      );
      await expect(readFile(join(installed, "package.json"), "utf8")).resolves.toBe(
        JSON.stringify({ name: "opencode-mini-session", version: "1.1.3" }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("update presentation", () => {
  it("builds the manual v1 update warning", () => {
    expect(UPDATE_SPEC).toBe("opencode-mini-session@v1");
    expect(buildUpdateWarning("1.1.4")).toBe(
      `New version available: 1.1.4. Update ${UPDATE_SPEC} with the OpenCode plugin manager, then restart opencode.`,
    );
  });

  it("sets warning and shows a manual update toast", () => {
    const toast = vi.fn();
    const setUpdateWarning = vi.fn();

    handleAutoUpdateResult(
      { ui: { toast } },
      {
        updated: true,
        name: "opencode-mini-session",
        current: "1.1.3",
        latest: "1.1.4",
      },
      setUpdateWarning,
    );

    expect(setUpdateWarning).toHaveBeenCalledWith(
      buildUpdateWarning("1.1.4"),
    );
    expect(toast).toHaveBeenCalledWith({
      variant: "info",
      message:
        buildUpdateWarning("1.1.4"),
      duration: 8000,
    });
  });

  it("does nothing when no update is available", () => {
    const toast = vi.fn();
    const setUpdateWarning = vi.fn();

    handleAutoUpdateResult(
      { ui: { toast } },
      { updated: false },
      setUpdateWarning,
    );

    expect(setUpdateWarning).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
