import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Setter } from "solid-js";
import type { TuiContext } from "./opencode";
import { isVersionNewer } from "./version";

const PACKAGE_NAME = "opencode-mini-session";
export const UPDATE_COMMAND = `opencode plugin update ${PACKAGE_NAME}`;

type PackageJson = {
  name?: string;
  version?: string;
};

export type UpdateCheckResult =
  | { updated: false }
  | { updated: true; name: string; current: string; latest: string };

export function startAutoUpdate(
  ctx: TuiContext,
  setUpdateWarning: Setter<string | undefined>,
  signal: AbortSignal,
) {
  void checkAutoUpdate(signal)
    .then(async (result) => {
      if (!result.updated || signal.aborted) return;
      const plugins = await ctx.client.plugin.list({
        location: ctx.location ?? ctx.data.location.default(),
      }).catch(() => ({ data: [] }));
      const managed = plugins.data.some((plugin) =>
        plugin.source.type === "package" &&
        (plugin.source.target === PACKAGE_NAME || plugin.source.target.startsWith(`${PACKAGE_NAME}@`)),
      );
      if (!signal.aborted) handleAutoUpdateResult(ctx, result, setUpdateWarning, managed);
    })
    .catch(() => {});
}

export function handleAutoUpdateResult(
  ctx: Pick<TuiContext, "ui">,
  result: UpdateCheckResult,
  setUpdateWarning: (warning: string | undefined) => void,
  managed = false,
) {
  if (!result.updated) return;

  setUpdateWarning(buildUpdateWarning(result.latest, managed));
  ctx.ui.toast.show({
    variant: "info",
    message: `New ${result.name} ${result.latest} version available. ${updateInstructions(managed)}`,
    duration: 8000,
  });
}

export function buildUpdateWarning(latest: string, managed = false) {
  return `New version available: ${latest}. ${updateInstructions(managed)}`;
}

function updateInstructions(managed: boolean) {
  return managed
    ? `Open \`/plugins\` and select the plugin entry for ${PACKAGE_NAME} to update, or run \`${UPDATE_COMMAND}\` in your terminal.`
    : `Run \`${UPDATE_COMMAND}\` in your terminal to update. Run \`/mini-migrate\` to enable updates in \`/plugins\`.`;
}

export async function checkAutoUpdate(
  signal: AbortSignal,
  findDir: (startDir: string) => Promise<string | undefined> = findPackageDir,
  fetchVersion: (
    name: string,
    signal: AbortSignal,
  ) => Promise<string | undefined> = fetchLatestVersion,
): Promise<UpdateCheckResult> {
  const packageDir = await findDir(dirname(fileURLToPath(import.meta.url)));
  if (!packageDir) return { updated: false };
  if (!isNodeModulesInstall(packageDir)) return { updated: false };

  const pkg = await readPackageJson(join(packageDir, "package.json"));
  if (!pkg?.name || !pkg.version) return { updated: false };

  const latest = await fetchVersion(pkg.name, signal);
  if (!latest || !isVersionNewer(latest, pkg.version)) return { updated: false };

  return {
    updated: true,
    name: pkg.name,
    current: pkg.version,
    latest,
  };
}

export function isNodeModulesInstall(packageDir: string) {
  return packageDir.replaceAll("\\", "/").includes("/node_modules/");
}

export function parseLatestVersion(data: unknown) {
  return data &&
    typeof data === "object" &&
    typeof (data as { version?: unknown }).version === "string"
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
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
      { signal },
    );
    if (!response.ok) return undefined;
    return parseLatestVersion(await response.json());
  } catch {
    return undefined;
  }
}
