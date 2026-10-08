import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectDirectory, "dist");

const nodeLauncher = `#!/usr/bin/env node
import { runCli } from "./cli.js";

const exitCode = await runCli(process.argv.slice(2));
process.exitCode = exitCode;
`;

const shellLauncher = `#!/usr/bin/env sh
exec node "$(dirname "$0")/authy.js" "$@"
`;

const windowsLauncher = "@echo off\r\nnode \"%~dp0authy.js\" %*\r\n";

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "authy.js"), nodeLauncher, "utf8"),
  writeFile(resolve(outputDirectory, "authy"), shellLauncher, "utf8"),
  writeFile(resolve(outputDirectory, "authy.cmd"), windowsLauncher, "utf8")
]);

await chmod(resolve(outputDirectory, "authy"), 0o755);
