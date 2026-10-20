import { mkdir, mkdtemp, readFile, writeFile, rm, stat, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "jsonc-parser";
import { applyMigration, findMigration, isMiniPackage, planMigration, startMigrationCheck } from "../src/migration";
import type { TuiContext } from "../src/opencode";
import { migrationDialogText, type MigrationChoice } from "../src/migration-dialog";

const dirs: string[] = [];
async function fixture(cli = '{ "plugins": ["opencode-mini-session", "other"] }', server?: string) {
  const root = join(tmpdir(), "opencode");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "mini-migration-test-"));
  dirs.push(dir);
  await writeFile(join(dir, "cli.json"), cli);
  if (server !== undefined) await writeFile(join(dir, "opencode.jsonc"), server);
  return dir;
}
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("migration prompt", () => {
  async function setup(choice?: MigrationChoice, local = true, packageInstall = true, dismissed = false) {
    const dir = await fixture();
    const state = { dismissed };
    const session = { offered: false };
    const select = vi.fn(async () => choice);
    const alert = vi.fn(async () => {});
    const localService = vi.fn(async () => local);
    const list = vi.fn(async () => ({ data: [] }));
    const save = vi.fn(async (edit: (draft: typeof state) => void) => edit(state));
    let run!: () => Promise<void>;
    const ctx = {
      storage: {
        store: () => [state, save],
        memory: () => [session, (edit: (draft: typeof session) => void) => edit(session)],
      },
      client: { plugin: { list } },
      data: { location: { default: () => ({ directory: dir }) } },
      keymap: { layer: (factory: () => { mode?: string; commands: { run: () => Promise<void> }[] }) => {
        const layer = factory();
        expect(layer.mode).toBe("global");
        run = layer.commands[0].run;
      } },
      ui: { dialog: { select, alert }, toast: { show: vi.fn() } },
    } as unknown as TuiContext;
    vi.useFakeTimers();
    const controller = new AbortController();
    const options = { directory: dir, packageInstall, localService, prompt: select };
    startMigrationCheck(ctx, controller.signal, options);
    const restart = () => {
      controller.abort();
      session.offered = false;
      startMigrationCheck(ctx, new AbortController().signal, options);
    };
    const reload = () => startMigrationCheck(ctx, new AbortController().signal, options);
    return { dir, state, session, select, alert, localService, list, save, run, controller, restart, reload };
  }

  it("prompts once and does not change configs when deferred", async () => {
    const f = await setup("later");
    const original = await readFile(join(f.dir, "cli.json"), "utf8");
    await vi.advanceTimersByTimeAsync(1500);
    // The timer starts an async filesystem check; wait for its prompt to settle.
    await vi.waitFor(() => expect(f.select).toHaveBeenCalledOnce());
    expect(f.state.dismissed).toBe(false);
    expect(f.session.offered).toBe(true);
    expect(await readFile(join(f.dir, "cli.json"), "utf8")).toBe(original);
    expect(await readdir(f.dir)).toEqual(["cli.json"]);
  });

  it.each([
    { choice: "dismiss" as const, dismissed: true },
    { choice: undefined, dismissed: false },
  ])("only persists Don't ask again: $choice", async ({ choice, dismissed }) => {
    const f = await setup(choice);
    await f.run();
    expect(f.state.dismissed).toBe(dismissed);
    expect(await readdir(f.dir)).toEqual(["cli.json"]);
  });

  it.each(["later" as const, undefined])("asks again after restart when deferred: %s", async (choice) => {
    const f = await setup(choice);
    await f.run();
    expect(f.select).toHaveBeenCalledOnce();
    f.restart();
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(f.select).toHaveBeenCalledTimes(2));
    expect(f.state.dismissed).toBe(false);
  });

  it("does not repeat a deferred offer on hot reload within the same TUI", async () => {
    const f = await setup("later");
    await f.run();
    f.reload();
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.select).toHaveBeenCalledOnce();
  });

  it("does not ask again after restart when permanently dismissed", async () => {
    const f = await setup("dismiss");
    await f.run();
    f.restart();
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.select).toHaveBeenCalledOnce();
    expect(f.state.dismissed).toBe(true);
  });

  it("explains the move and uses the actual destination filename", () => {
    const text = migrationDialogText("/config/opencode.jsonc");
    expect(text.title).toBe("Move opencode-mini-session config to opencode.jsonc?");
    expect(text.explanation).toContain("native OpenCode plugin version display and updates in /plugins");
    expect(text.explanation).toContain("future server-side features");
    expect(text.choices[1].description).toBe("Ask again the next time OpenCode starts.");
    expect(migrationDialogText("/config/opencode.json").title).toBe("Move opencode-mini-session config to opencode.json?");
  });

  it("allows manual migration after the one-time offer was dismissed", async () => {
    const f = await setup("migrate", true, true, true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.select).not.toHaveBeenCalled();
    await f.run();
    expect(f.select).toHaveBeenCalledOnce();
    expect(f.alert).toHaveBeenCalledOnce();
    expect(parse(await readFile(join(f.dir, "opencode.jsonc"), "utf8")).plugins).toEqual(["opencode-mini-session"]);
  });

  it("skips remote services without consuming the offer", async () => {
    const f = await setup("migrate", false);
    await f.run();
    expect(f.select).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
    expect(f.state.dismissed).toBe(false);
  });

  it("skips local-path installs", async () => {
    const f = await setup("migrate", true, false);
    await f.run();
    expect(f.localService).not.toHaveBeenCalled();
    expect(f.select).not.toHaveBeenCalled();
  });

  it("skips existing server installs", async () => {
    const f = await setup("migrate");
    f.list.mockResolvedValue({ data: [{ source: { type: "package", target: "opencode-mini-session" } }] } as never);
    await f.run();
    expect(f.select).not.toHaveBeenCalled();
  });

  it("cancels the startup check when the plugin unloads", async () => {
    const f = await setup("migrate");
    f.controller.abort();
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.localService).not.toHaveBeenCalled();
    expect(f.select).not.toHaveBeenCalled();
  });
});

describe("migration planning", () => {
  it("matches npm package entries but not local paths or other plugins", () => {
    for (const entry of ["opencode-mini-session", "opencode-mini-session@latest", { package: "opencode-mini-session@2.1.0", options: { agent: "custom" } }]) expect(isMiniPackage(entry)).toBe(true);
    for (const entry of ["./opencode-mini-session", "file:///plugins/opencode-mini-session", "other", "opencode-mini-session-extra", "-opencode-mini-session", null]) expect(isMiniPackage(entry)).toBe(false);
  });

  it("moves the complete entry and preserves comments and unrelated settings", () => {
    const entry = { package: "opencode-mini-session@^2", options: { agent: "custom", enableThinking: false } };
    const cli = `{
      // Preserve theme
      "theme": { "name": "gruvbox" },
      "plugins": ["other", ${JSON.stringify(entry)}, "last"],
    }`;
    const server = '{\n // Preserve models\n "model": "test/model",\n "plugins": ["server-plugin"],\n}\n';
    const result = planMigration(cli, server)!;
    expect(parse(result.cliText)).toEqual({ theme: { name: "gruvbox" }, plugins: ["other", "last"] });
    expect(parse(result.serverText)).toEqual({ model: "test/model", plugins: ["server-plugin", entry] });
    expect(result.cliText).toContain("// Preserve theme");
    expect(result.serverText).toContain("// Preserve models");
  });

  it("keeps an exact version pin instead of silently unpinning", () => {
    const result = planMigration('{"plugins":["opencode-mini-session@2.1.0"]}', '{}')!;
    expect(parse(result.serverText).plugins).toEqual(["opencode-mini-session@2.1.0"]);
  });

  it("preserves comments inside the migrated options", () => {
    const cli = '{"plugins":[{"package":"opencode-mini-session","options":{\n // custom agent\n "agent":"custom"\n}}]}';
    const result = planMigration(cli, '{}')!;
    expect(result.serverText).toContain("// custom agent");
    expect(parse(result.serverText).plugins[0].options.agent).toBe("custom");
  });

  it.each([
    '{"plugins":["other"]}',
    '{"plugins":["./opencode-mini-session"]}',
    '{"plugins":["opencode-mini-session","opencode-mini-session@latest"]}',
    '{"plugins":[{"package":"opencode-mini-session","options":{"prompt":"{file:prompt.txt}"}}]}',
  ])("skips ineligible CLI entries: %s", (cli) => {
    expect(planMigration(cli, '{}')).toBeUndefined();
  });

  it.each([
    '{"plugins":["opencode-mini-session"]}',
    '{"plugins":[{"package":"opencode-mini-session@latest","options":{}}]}',
    '{"plugins":["-opencode-mini-session"]}',
    '{"plugins":["-*"]}',
  ])("does not override existing server config: %s", (server) => {
    expect(planMigration('{"plugins":["opencode-mini-session"]}', server)).toBeUndefined();
  });

  it.each(['{bad}', '{"plugins":{}}', '{"plugins":[],"plugins":[]}', '[]', ''])('rejects invalid or ambiguous configs: %s', (text) => {
    expect(() => planMigration('{"plugins":["opencode-mini-session"]}', text)).toThrow();
  });
});

describe("migration files", () => {
  it("creates a server config and a private backup before removing the CLI entry", async () => {
    const dir = await fixture();
    const plan = (await findMigration(dir))!;
    const backups = await applyMigration(plan);
    expect(backups).toHaveLength(1);
    expect(await readFile(backups[0], "utf8")).toBe(plan.cli.text);
    expect((await stat(backups[0])).mode & 0o777).toBe(0o600);
    expect(parse(await readFile(join(dir, "cli.json"), "utf8")).plugins).toEqual(["other"]);
    expect(parse(await readFile(join(dir, "opencode.jsonc"), "utf8")).plugins).toEqual(["opencode-mini-session"]);
    expect(await findMigration(dir)).toBeUndefined();
  });

  it("uses existing opencode.json and backs up both files", async () => {
    const dir = await fixture();
    await writeFile(join(dir, "opencode.json"), '{"model":"test/model"}');
    const plan = (await findMigration(dir))!;
    expect(plan.server.path).toBe(join(dir, "opencode.json"));
    const backups = await applyMigration(plan);
    expect(backups).toHaveLength(2);
    expect(await readFile(backups[1], "utf8")).toBe('{"model":"test/model"}');
    expect(parse(await readFile(plan.server.path, "utf8")).model).toBe("test/model");
  });

  it("skips when both server config formats exist", async () => {
    const dir = await fixture(undefined, '{}');
    await writeFile(join(dir, "opencode.json"), '{}');
    expect(await findMigration(dir)).toBeUndefined();
  });

  it("refuses to overwrite configs changed after the prompt", async () => {
    const dir = await fixture(undefined, '{}');
    const plan = (await findMigration(dir))!;
    await writeFile(plan.cli.path, '{"plugins":["other"]}');
    await expect(applyMigration(plan)).rejects.toThrow("Configuration changed");
    expect(await readFile(plan.server.path, "utf8")).toBe('{}');
    expect(await readdir(dir)).toEqual(expect.not.arrayContaining(["cli.json.mini-migration.lock"]));
  });

  it("refuses symlinked configs", async () => {
    const dir = await fixture();
    await writeFile(join(dir, "real.json"), '{}');
    await symlink(join(dir, "real.json"), join(dir, "opencode.jsonc"));
    await expect(findMigration(dir)).rejects.toThrow("regular configuration files");
  });

  it("does not touch files if another migration holds the lock", async () => {
    const dir = await fixture();
    const plan = (await findMigration(dir))!;
    await writeFile(`${plan.cli.path}.mini-migration.lock`, "locked");
    await expect(applyMigration(plan)).rejects.toThrow();
    expect(await readFile(plan.cli.path, "utf8")).toBe(plan.cli.text);
    expect(await readFile(`${plan.cli.path}.mini-migration.lock`, "utf8")).toBe("locked");
  });

  it.each([undefined, '{"model":"test/model"}'])("rolls back the server write if CLI removal fails: %s", async (server) => {
    const dir = await fixture(undefined, server);
    const plan = (await findMigration(dir))!;
    const write = async (doc: { path: string }, text: string) => {
      if (doc.path === plan.cli.path) throw new Error("Simulated CLI write failure");
      await writeFile(doc.path, text);
    };
    await expect(applyMigration(plan, write)).rejects.toThrow("Simulated CLI write failure");
    expect(await readFile(plan.cli.path, "utf8")).toBe(plan.cli.text);
    if (server === undefined) await expect(stat(plan.server.path)).rejects.toMatchObject({ code: "ENOENT" });
    else expect(await readFile(plan.server.path, "utf8")).toBe(server);
  });
});
