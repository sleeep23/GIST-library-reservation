import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(rootDir, "package.json");
const distDir = path.join(rootDir, "dist");
const extensionDistDir = path.join(distDir, "extension");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const zipName = `${packageJson.name}-v${packageJson.version}.zip`;
const zipPath = path.join(distDir, zipName);

await run("npm", ["run", "build:extension"], rootDir);

const manifest = JSON.parse(
  await readFile(path.join(extensionDistDir, "manifest.json"), "utf8")
);

if (manifest.version !== packageJson.version) {
  throw new Error(
    `manifest version ${manifest.version} does not match package version ${packageJson.version}`
  );
}

await assertFile("manifest.json");
await assertFile("content.js");
await assertFile("content.css");
await assertFile("icons/icon128.png");

const contentJs = await readFile(path.join(extensionDistDir, "content.js"), "utf8");
if (/\bprocess\.(env|[A-Za-z_$])/.test(contentJs)) {
  throw new Error("content.js contains a process reference that can break in Chrome");
}

await rm(zipPath, { force: true });
await run(
  "zip",
  [
    "-r",
    zipPath,
    ".",
    "-x",
    "*.map",
    "*/.DS_Store",
    "__MACOSX/*"
  ],
  extensionDistDir
);

console.log(`Created ${zipPath}`);

async function assertFile(relativePath) {
  await readFile(path.join(extensionDistDir, relativePath));
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}
