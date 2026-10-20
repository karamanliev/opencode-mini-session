import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { applyEdits, modify, parseTree, getNodeValue, findNodeAtLocation, type Node, type ParseError } from "jsonc-parser";
import type { TuiContext } from "./opencode";
import { isNodeModulesInstall } from "./update";
import { fileURLToPath } from "node:url";
import type { MigrationChoice } from "./migration-dialog";

const PACKAGE = "opencode-mini-session";
type Document = { path: string; text: string | undefined; mode: number };
export type Migration = { cli: Document; server: Document; cliText: string; serverText: string };

function target(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && "package" in entry && typeof entry.package === "string") return entry.package;
}

export function isMiniPackage(entry: unknown) {
  const name = target(entry);
  return name === PACKAGE || name?.startsWith(`${PACKAGE}@`) === true;
}

function document(text: string): { entries: unknown[]; tree: Node } {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  if (errors.length || tree?.type !== "object") throw new Error("Invalid configuration JSONC.");
  // Ambiguous duplicate properties must never be rewritten.
  const validate = (node: Node) => {
    if (node.type === "object") {
      const keys = node.children?.map((property) => property.children?.[0].value) ?? [];
      if (new Set(keys).size !== keys.length) throw new Error("Duplicate configuration keys.");
    }
    node.children?.forEach(validate);
  };
  validate(tree);
  const value = getNodeValue(tree);
  if (value.plugins !== undefined && !Array.isArray(value.plugins)) throw new Error("Plugins must be an array.");
  return { entries: value.plugins ?? [], tree };
}

function edit(text: string, path: (string | number)[], value: unknown) {
  const indent = text.match(/\n([\t ]+)\S/)?.[1] ?? "  ";
  return applyEdits(text, modify(text, path, value, {
    formattingOptions: { insertSpaces: !indent.includes("\t"), tabSize: indent.length, eol: text.includes("\r\n") ? "\r\n" : "\n" },
  }));
}

export function planMigration(cliText: string, serverText: string): { cliText: string; serverText: string } | undefined {
  const cliDoc = document(cliText);
  const serverDoc = document(serverText);
  const cli = cliDoc.entries;
  const server = serverDoc.entries;
  if (getNodeValue(cliDoc.tree).plugin !== undefined || getNodeValue(serverDoc.tree).plugin !== undefined) return;
  const matches = cli.flatMap((entry, index) => isMiniPackage(entry) ? [index] : []);
  if (matches.length !== 1) return;
  if (cli.some((entry) => target(entry) === `-${PACKAGE}` || target(entry) === "-*")) return;
  // Do not override existing installs, disabled directives, or legacy config.
  if (server.some((entry) => isMiniPackage(entry) || target(entry) === `-${PACKAGE}` || target(entry) === "-*")) return;
  const index = matches[0];
  const entry = cli[index];
  // Relative file substitutions could resolve differently after moving files.
  if (/\{(?:file|env):/.test(JSON.stringify(entry))) return;
  const inserted = server.length || getNodeValue(serverDoc.tree).plugins
    ? edit(serverText, ["plugins", -1], entry)
    : edit(serverText, ["plugins"], [entry]);
  // Transfer the original value text as well, including comments inside options.
  const from = findNodeAtLocation(cliDoc.tree, ["plugins", index])!;
  const to = findNodeAtLocation(document(inserted).tree, ["plugins", server.length])!;
  return {
    cliText: edit(cliText, ["plugins", index], undefined),
    serverText: inserted.slice(0, to.offset) + cliText.slice(from.offset, from.offset + from.length) + inserted.slice(to.offset + to.length),
  };
}

async function readDocument(path: string): Promise<Document> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Migration requires regular configuration files.");
    return { path, text: await readFile(path, "utf8"), mode: info.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, text: undefined, mode: 0o600 };
    throw error;
  }
}

export async function findMigration(directory: string): Promise<Migration | undefined> {
  const cli = await readDocument(join(directory, "cli.json"));
  if (cli.text === undefined) return;
  const json = await readDocument(join(directory, "opencode.json"));
  const jsonc = await readDocument(join(directory, "opencode.jsonc"));
  // Both files can contribute settings. Require a manual migration when ambiguous.
  if (json.text !== undefined && jsonc.text !== undefined) return;
  const server = json.text !== undefined ? json : jsonc;
  const original = server.text ?? '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  const edits = planMigration(cli.text, original);
  if (!edits) return;
  return { cli, server, ...edits };
}

async function unchanged(doc: Document) {
  const current = await readDocument(doc.path);
  if (current.text !== doc.text) throw new Error("Configuration changed. Run /mini-migrate to try again.");
}

async function atomicWrite(doc: Document, text: string) {
  const temp = `${doc.path}.${randomUUID()}.tmp`;
  const file = await open(temp, "wx", doc.mode);
  try {
    await file.writeFile(text);
    await file.sync();
    await file.close();
    await rename(temp, doc.path);
  } finally {
    await file.close().catch(() => {});
    await unlink(temp).catch(() => {});
  }
}

export async function applyMigration(
  plan: Migration,
  write: typeof atomicWrite = atomicWrite,
): Promise<string[]> {
  const lockPath = `${plan.cli.path}.mini-migration.lock`;
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await unchanged(plan.cli);
    await unchanged(plan.server);
    const suffix = `.mini-backup-${randomUUID()}`;
    const backups: string[] = [];
    for (const doc of [plan.cli, plan.server]) {
      if (doc.text === undefined) continue;
      const backup = doc.path + suffix;
      // Configs may contain credentials. Create private backups before writing either file.
      const file = await open(backup, "wx", 0o600);
      try {
        await file.writeFile(doc.text);
        await file.sync();
      } finally {
        await file.close();
      }
      backups.push(backup);
    }
    await unchanged(plan.cli);
    await unchanged(plan.server);
    // Add the server first. If removal fails, the original TUI install still works.
    await write(plan.server, plan.serverText);
    try {
      await unchanged(plan.cli);
      await write(plan.cli, plan.cliText);
    } catch (error) {
      // Restore only our own write, never a subsequent external edit.
      if ((await readDocument(plan.server.path)).text === plan.serverText) {
        if (plan.server.text === undefined) await unlink(plan.server.path);
        else await write(plan.server, plan.server.text);
      }
      throw error;
    }
    return backups;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function isLocalService(ctx: TuiContext) {
  const endpoint = await Service.discover();
  if (!endpoint) return false;
  const url = new URL(endpoint.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
  const local = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
  const [expected, connected] = await Promise.all([local.server.info(), ctx.client.server.info()]);
  return expected.pid === connected.pid && expected.paths.tmp === connected.paths.tmp;
}

export function startMigrationCheck(
  ctx: TuiContext,
  signal: AbortSignal,
  options: {
    directory?: string;
    packageInstall?: boolean;
    localService?: (ctx: TuiContext) => Promise<boolean>;
    prompt?: (ctx: TuiContext, plan: Migration) => Promise<MigrationChoice | undefined>;
  } = {},
) {
  const [state, save] = ctx.storage.store("package-migration-v2", { initial: { dismissed: false } });
  const [session, updateSession] = ctx.storage.memory("package-migration-session-v2", { initial: { offered: false } });
  let busy = false;
  const run = async (manual = false) => {
    if (busy || signal.aborted || (!manual && (state.dismissed || session.offered))) return;
    busy = true;
    try {
      if (!(options.packageInstall ?? isNodeModulesInstall(fileURLToPath(import.meta.url))) ||
        !await (options.localService ?? isLocalService)(ctx)) return;
      const plugins = await ctx.client.plugin.list({ location: ctx.location ?? ctx.data.location.default() });
      if (plugins.data.some((plugin) => plugin.source.type === "package" && isMiniPackage(plugin.source.target))) return;
      const plan = await findMigration(options.directory ?? join(homedir(), ".config", "opencode"));
      if (!plan || signal.aborted) {
        if (manual) ctx.ui.toast.show({ message: "No eligible CLI-only package entry found. Custom config locations require manual migration." });
        return;
      }
      updateSession((draft) => { draft.offered = true; });
      if (signal.aborted) return;
      const choice = options.prompt
        ? await options.prompt(ctx, plan)
        : await (await import("./components/MigrationDialog.js")).showMigrationDialog(ctx, {
            cli: plan.cli.path,
            server: plan.server.path,
          });
      if (signal.aborted) return;
      if (choice === "dismiss") await save((draft) => { draft.dismissed = true; });
      if (choice !== "migrate" || signal.aborted) return;
      await applyMigration(plan);
      await ctx.ui.dialog.alert({ title: "Migration complete", message: "Configuration backups were saved beside the original files. Restart OpenCode and its local service, then use the plugin entry in /plugins to update opencode-mini-session." });
    } catch {
      if (!signal.aborted) ctx.ui.toast.show({ variant: "warning", message: "opencode-mini-session migration could not complete. Your original installation is retained. Run /mini-migrate to retry or migrate manually." });
    } finally {
      busy = false;
    }
  };
  ctx.keymap.layer(() => ({
    mode: "global",
    commands: [{ id: "mini.migrate", title: "Move opencode-mini-session configuration", palette: true, slash: { name: "mini-migrate" }, run: () => run(true) }],
  }));
  const timer = setTimeout(() => void run(), 1500);
  signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
}
