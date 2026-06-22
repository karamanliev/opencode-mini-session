export const MIN_KEYMAP_VERSION = "1.14.42";

export function isVersionAtLeast(version: string, min: string): boolean {
  const a = parseSemver(version);
  const b = parseSemver(min);
  if (!a || !b) return false;

  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }

  return true;
}

function parseSemver(version: string): [number, number, number] | undefined {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
