export const MIN_KEYMAP_VERSION = "1.14.42";

export function isVersionAtLeast(version: string, min: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(min);
  if (!a || !b) return false;

  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  }

  return true;
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

export function parseVersion(version: string) {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.+)?$/);
  if (!match) return undefined;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]?.split(".") ?? [],
  };
}
