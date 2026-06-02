import { readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";
import type { Setter } from "solid-js";

const PACKAGE_NAME = "opencode-mini-session";

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
};

export type UpdateResult =
  | { updated: true; name: string; current: string; latest: string; removeDir: string }
  | {
      updated: false;
      error: "remove_failed";
      name: string;
      current: string;
      latest: string;
      removeDir: string;
    }
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
      message: `New ${result.name} ${result.latest} version available. Restart opencode to apply the update.`,
      duration: 8000
    });
    return;
  }

  if ("error" in result && result.error === "remove_failed") {
    api.ui.toast({
      variant: "warning",
      message: `Could not update ${result.name}. Clear the opencode plugin cache and restart.`,
      duration: 8000
    });
  }
}

export function buildUpdateWarning(latest: string) {
  return `New version available: ${latest}. Restart opencode to finish updating.`;
}

export async function checkPackageUpdate(
  packageDir: string,
  signal: AbortSignal,
  fetchVersion: (name: string, signal: AbortSignal) => Promise<string | undefined> = fetchLatestVersion,
  remove: (path: string) => Promise<void> = (path) =>
    rm(path, { recursive: true, force: true }),
): Promise<UpdateResult> {
  const pkg = await readPackageJson(join(packageDir, "package.json"));
  if (!pkg?.name || !pkg.version) return { updated: false };

  const latest = await fetchVersion(pkg.name, signal);
  if (!latest || !isVersionNewer(latest, pkg.version)) return { updated: false };

  const removeDir = await selectUpdateRemoveDir(packageDir, pkg.name);
  try {
    await remove(removeDir);
  } catch {
    return {
      updated: false,
      error: "remove_failed",
      name: pkg.name,
      current: pkg.version,
      latest,
      removeDir,
    };
  }

  return {
    updated: true,
    name: pkg.name,
    current: pkg.version,
    latest,
    removeDir,
  };
}

export function parseLatestVersion(data: unknown) {
  return data && typeof data === "object" && typeof (data as { version?: unknown }).version === "string"
    ? (data as { version: string }).version
    : undefined;
}

export async function selectUpdateRemoveDir(packageDir: string, name: string) {
  const nodeModulesDir = dirname(packageDir);
  if (basename(nodeModulesDir) !== "node_modules") return packageDir;

  const wrapperDir = dirname(nodeModulesDir);
  const wrapperPkg = await readPackageJson(join(wrapperDir, "package.json"));
  return wrapperPkg?.dependencies?.[name] ? wrapperDir : packageDir;
}

export function isVersionNewer(latest: string, current: string) {
  const next = parseVersion(latest);
  const prev = parseVersion(current);
  if (!next || !prev) return false;

  for (let i = 0; i < 3; i++) {
    if (next.parts[i] !== prev.parts[i]) return next.parts[i] > prev.parts[i];
  }

  if (!next.pre.length && prev.pre.length) return true;
  if (next.pre.length && !prev.pre.length) return false;

  for (let i = 0; i < Math.max(next.pre.length, prev.pre.length); i++) {
    const a = next.pre[i];
    const b = prev.pre[i];
    if (a === undefined) return false;
    if (b === undefined) return true;
    if (a === b) continue;

    const aNumber = /^\d+$/.test(a) ? Number(a) : undefined;
    const bNumber = /^\d+$/.test(b) ? Number(b) : undefined;
    if (aNumber !== undefined && bNumber !== undefined) return aNumber > bNumber;
    if (aNumber !== undefined) return false;
    if (bNumber !== undefined) return true;
    return a > b;
  }

  return false;
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

function parseVersion(version: string) {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.+)?$/);
  if (!match) return undefined;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]?.split(".") ?? [],
  };
}
