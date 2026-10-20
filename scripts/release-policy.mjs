import { fileURLToPath } from "node:url";

export function releasePolicy(version) {
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    return { distTag: "latest", prerelease: false };
  }
  if (/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) {
    return { distTag: "beta", prerelease: true };
  }
  throw new Error(`Unsupported release version: ${version}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(releasePolicy(process.argv[2])));
}
