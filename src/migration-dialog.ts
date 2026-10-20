import { basename } from "node:path";

export type MigrationChoice = "migrate" | "later" | "dismiss";

export function migrationDialogText(serverPath: string) {
  return {
    title: `Move opencode-mini-session config to ${basename(serverPath)}?`,
    explanation:
      "This enables native OpenCode plugin version display and updates in /plugins. It also gives opencode-mini-session room to grow with future server-side features. Your existing settings will be preserved.",
    choices: [
      {
        title: "Migrate",
        value: "migrate" as const,
        description: "Back up existing configs and move the configuration. Restart OpenCode afterward.",
      },
      {
        title: "Not now",
        value: "later" as const,
        description: "Ask again the next time OpenCode starts.",
      },
      {
        title: "Don't ask again",
        value: "dismiss" as const,
        description: "Keep the current setup. You can still run /mini-migrate later.",
      },
    ],
  };
}
