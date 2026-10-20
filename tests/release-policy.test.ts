import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("release channel policy", () => {
  function policy(version: string) {
    return JSON.parse(execFileSync("node", ["scripts/release-policy.mjs", version], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  }

  it("keeps stable releases on latest", () => {
    expect(policy("2.2.0")).toEqual({ distTag: "latest", prerelease: false });
  });

  it.each(["2.2.0-beta.1", "2.2.0-beta.2"])("publishes %s only to beta", (version) => {
    expect(policy(version)).toEqual({ distTag: "beta", prerelease: true });
  });

  it.each(["2.2.0-rc.1", "v2.2.0", "2.2", "bad"])("rejects unsupported release versions: %s", (version) => {
    expect(() => policy(version)).toThrow();
  });
});
