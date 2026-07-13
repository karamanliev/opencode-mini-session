import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@babel/core";
import typescriptPreset from "@babel/preset-typescript";
import solidPreset from "babel-preset-solid";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const sourcePath of await sourceFiles(sourceDir)) {
  const relativePath = path.relative(sourceDir, sourcePath);
  const outputPath = path.join(
    distDir,
    relativePath.replace(/\.[cm]?tsx?$/, ".js"),
  );
  const source = await readFile(sourcePath, "utf8");
  const transformed = await babel.transformAsync(source, {
    filename: sourcePath,
    configFile: false,
    babelrc: false,
    plugins: [appendJsExtensions],
    presets: [
      [solidPreset, { moduleName: "@opentui/solid", generate: "universal" }],
      [typescriptPreset],
    ],
  });

  if (!transformed?.code) {
    throw new Error(`Babel transform returned empty output for ${relativePath}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${transformed.code}\n`);
}

function appendJsExtensions() {
  return {
    visitor: {
      ImportDeclaration(importPath) {
        appendExtension(importPath.node.source);
      },
      ExportNamedDeclaration(exportPath) {
        if (exportPath.node.source) appendExtension(exportPath.node.source);
      },
      ExportAllDeclaration(exportPath) {
        appendExtension(exportPath.node.source);
      },
    },
  };
}

function appendExtension(source) {
  if (source.value.startsWith(".") && !path.extname(source.value)) {
    source.value = `${source.value}.js`;
  }
}

async function sourceFiles(dir) {
  const files = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(entryPath));
    } else if (entry.isFile() && /\.[cm]?tsx?$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}
