import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tempDir = await mkdtemp(path.join(tmpdir(), "opencode-mini-session-"));
const installDir = path.join(tempDir, "install");
const useShell = process.platform === "win32";
const npm = useShell ? "npm.cmd" : "npm";
const spawnOptions = useShell ? { shell: true } : {};
const quoteForShell = (value) =>
  useShell && /\s/.test(value) ? `"${value}"` : value;

// A parent `npm run` exports the user's npm configuration into the child
// environment. npm 12 rejects some of those values (for example
// `allow-scripts` from ~/.npmrc) on the isolated --prefix install this script
// performs, so strip the known-problematic keys.
const childEnv = { ...process.env };
delete childEnv.npm_config_allow_scripts;
delete childEnv.NPM_CONFIG_ALLOW_SCRIPTS;

try {
  const packed = JSON.parse(
    execFileSync(
      npm,
      ["pack", "--json", "--pack-destination", quoteForShell(tempDir)],
      {
        encoding: "utf8",
        env: childEnv,
        ...spawnOptions,
      },
    ),
  );
  // npm <11 returns an array, npm >=11 returns an object keyed by package name.
  const packedEntry = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  if (!packedEntry?.filename) {
    throw new Error("npm pack did not report a tarball filename");
  }
  const tarball = path.join(tempDir, packedEntry.filename);

  await mkdir(installDir);
  execFileSync(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--no-package-lock",
      "--prefix",
      quoteForShell(installDir),
      quoteForShell(tarball),
    ],
    { stdio: "inherit", env: childEnv, ...spawnOptions },
  );
  const entryPath = path.join(
    installDir,
    "node_modules",
    "opencode-mini-session",
    "dist",
    "index.js",
  );
  const distDir = path.dirname(entryPath);
  for (const file of await readdir(distDir, { recursive: true })) {
    if (!file.endsWith(".js")) continue;
    const source = await readFile(path.join(distDir, file), "utf8");
    if (/jsx(?:-dev)?-runtime/.test(source)) {
      throw new Error(`Packaged TUI output imports a JSX runtime: ${file}`);
    }
  }
  execFileSync(
    "bun",
    [
      "--eval",
      'import plugin from "opencode-mini-session/tui"; import server from "opencode-mini-session"; if (plugin.id !== "opencode-mini-session" || typeof plugin.setup !== "function") throw new Error("Invalid packaged TUI module"); if (server.id !== "opencode-mini-session" || typeof server.setup !== "function") throw new Error("Invalid packaged server module"); await server.setup({options: {}, rpc: {register: async () => ({})}});',
    ],
    { cwd: installDir, stdio: "inherit" },
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
