import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildUpdateWarning,
  checkAutoUpdate,
  handleAutoUpdateResult,
  isNodeModulesInstall,
  parseLatestVersion,
  UPDATE_COMMAND,
} from "../src/update";
import { isVersionNewer } from "../src/version";

const signal = new AbortController().signal;

async function tempPackageDir(version = "1.0.0") {
  const root = join(tmpdir(), `opencode-mini-session-test-${crypto.randomUUID()}`);
  const dir = join(root, "node_modules", "opencode-mini-session");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "opencode-mini-session", version }),
    "utf8",
  );
  return { root, dir };
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

describe("isNodeModulesInstall", () => {
  it("detects package installs on windows and posix paths", () => {
    expect(
      isNodeModulesInstall(
        "C:\\Users\\me\\.cache\\opencode\\npm\\opencode-mini-session@latest\\1\\node_modules\\opencode-mini-session",
      ),
    ).toBe(true);
    expect(
      isNodeModulesInstall(
        "/home/me/.cache/opencode/npm/opencode-mini-session@latest/1/node_modules/opencode-mini-session",
      ),
    ).toBe(true);
  });

  it("rejects local checkouts and plugin directories", () => {
    expect(isNodeModulesInstall("/home/me/code/opencode-mini-session")).toBe(
      false,
    );
    expect(
      isNodeModulesInstall("C:\\Users\\me\\opencode\\opencode-mini-session-v2"),
    ).toBe(false);
  });
});

describe("checkAutoUpdate", () => {
  it("skips local installs without hitting the registry", async () => {
    const fetchVersion = vi.fn(async () => "9.9.9");

    await expect(
      checkAutoUpdate(
        signal,
        async () => "/home/me/code/opencode-mini-session",
        fetchVersion,
      ),
    ).resolves.toEqual({ updated: false });
    expect(fetchVersion).not.toHaveBeenCalled();
  });

  it("reports newer registry versions for package installs", async () => {
    const { root, dir } = await tempPackageDir("1.0.0");
    try {
      await expect(
        checkAutoUpdate(signal, async () => dir, async () => "1.1.0"),
      ).resolves.toEqual({
        updated: true,
        name: "opencode-mini-session",
        current: "1.0.0",
        latest: "1.1.0",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns no update when latest is equal or older", async () => {
    const { root, dir } = await tempPackageDir("1.0.0");
    try {
      await expect(
        checkAutoUpdate(signal, async () => dir, async () => "1.0.0"),
      ).resolves.toEqual({ updated: false });
      await expect(
        checkAutoUpdate(signal, async () => dir, async () => "0.9.9"),
      ).resolves.toEqual({ updated: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns no update when the registry is unavailable", async () => {
    const { root, dir } = await tempPackageDir("1.0.0");
    try {
      await expect(
        checkAutoUpdate(signal, async () => dir, async () => undefined),
      ).resolves.toEqual({ updated: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("update presentation", () => {
  it("points to the plugins dialog first with the terminal command as a fallback", () => {
    expect(buildUpdateWarning("0.4.0", true)).toBe(
      `New version available: 0.4.0. Open \`/plugins\` and select the plugin entry for opencode-mini-session to update, or run \`${UPDATE_COMMAND}\` in your terminal.`,
    );
  });

  it("sets the warning and shows a toast when an update is available", () => {
    const show = vi.fn();
    const setUpdateWarning = vi.fn();

    handleAutoUpdateResult(
      { ui: { toast: { show } } } as never,
      {
        updated: true,
        name: "opencode-mini-session",
        current: "0.3.0",
        latest: "0.4.0",
      },
      setUpdateWarning,
      true,
    );

    expect(setUpdateWarning).toHaveBeenCalledWith(
      `New version available: 0.4.0. Open \`/plugins\` and select the plugin entry for opencode-mini-session to update, or run \`${UPDATE_COMMAND}\` in your terminal.`,
    );
    expect(show).toHaveBeenCalledWith({
      variant: "info",
      message:
        "New opencode-mini-session 0.4.0 version available. Open `/plugins` and select the plugin entry for opencode-mini-session to update, or run `opencode plugin update opencode-mini-session` in your terminal.",
      duration: 8000,
    });
  });

  it("keeps CLI-only installs on the command fallback until migrated", () => {
    expect(buildUpdateWarning("0.4.0")).toBe(
      `New version available: 0.4.0. Run \`${UPDATE_COMMAND}\` in your terminal to update. Run \`/mini-migrate\` to enable updates in \`/plugins\`.`,
    );
  });

  it("does nothing when no update is available", () => {
    const show = vi.fn();
    const setUpdateWarning = vi.fn();

    handleAutoUpdateResult(
      { ui: { toast: { show } } } as never,
      { updated: false },
      setUpdateWarning,
    );

    expect(setUpdateWarning).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });
});
