import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";
import type { Setter } from "solid-js";
import { isSameMajorVersion, isVersionNewer } from "./version";

const PACKAGE_NAME = "opencode-mini-session";
export const UPDATE_COMMAND = `opencode plugin ${PACKAGE_NAME}@1 --global --force`;

type PackageJson = {
  name?: string;
  version?: string;
};

export type UpdateResult =
  | { updated: true; name: string; current: string; latest: string }
  | { updated: false };

export async function checkAutoUpdate(
  meta: TuiPluginMeta,
  signal: AbortSignal,
): Promise<UpdateResult> {
  if (meta.source !== "npm") return { updated: false };

  const packageDir = await findPackageDir(dirname(fileURLToPath(import.meta.url)));
  if (!packageDir) return { updated: false };

  return checkPackageUpdate(packageDir, signal);
}

export function startAutoUpdate(
  api: TuiPluginApi,
  meta: TuiPluginMeta,
  setUpdateWarning: Setter<string | undefined>,
) {
  void checkAutoUpdate(meta, api.lifecycle.signal)
    .then((result) => handleAutoUpdateResult(api, result, setUpdateWarning))
    .catch(() => {});
}

export function handleAutoUpdateResult(
  api: { ui: Pick<TuiPluginApi["ui"], "toast"> },
  result: UpdateResult,
  setUpdateWarning: (warning: string | undefined) => void,
) {
  if (result.updated) {
    const warning = buildUpdateWarning(result.latest);
    setUpdateWarning(warning);
    api.ui.toast({
      variant: "info",
      message: `New ${result.name} ${result.latest} version available. Run \`${UPDATE_COMMAND}\` to update, then restart opencode.`,
      duration: 8000,
    });
  }
}

export function buildUpdateWarning(latest: string) {
  return `New version available: ${latest}. Run \`${UPDATE_COMMAND}\` to update, then restart opencode.`;
}

export async function checkPackageUpdate(
  packageDir: string,
  signal: AbortSignal,
  fetchVersion: (name: string, signal: AbortSignal) => Promise<string | undefined> = fetchLatestVersion,
): Promise<UpdateResult> {
  const pkg = await readPackageJson(join(packageDir, "package.json"));
  if (!pkg?.name || !pkg.version) return { updated: false };

  const latest = await fetchVersion(pkg.name, signal);
  if (
    !latest ||
    !isSameMajorVersion(latest, pkg.version) ||
    !isVersionNewer(latest, pkg.version)
  ) {
    return { updated: false };
  }

  return {
    updated: true,
    name: pkg.name,
    current: pkg.version,
    latest,
  };
}

export function parseLatestVersion(data: unknown) {
  return data && typeof data === "object" && typeof (data as { version?: unknown }).version === "string"
    ? (data as { version: string }).version
    : undefined;
}

async function findPackageDir(startDir: string) {
  let dir = startDir;
  for (;;) {
    const pkg = await readPackageJson(join(dir, "package.json"));
    if (pkg?.name === PACKAGE_NAME) return dir;

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function readPackageJson(path: string): Promise<PackageJson | undefined> {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    return data && typeof data === "object" ? (data as PackageJson) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchLatestVersion(name: string, signal: AbortSignal) {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      signal,
    });
    if (!response.ok) return undefined;
    return parseLatestVersion(await response.json());
  } catch {
    return undefined;
  }
}
