// Build into a temporary directory, keeping exploratory dependencies out of Studio.
import { mkdtemp, writeFile, copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "nls-sequence-browser-"));
await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
const installed = spawnSync("npm", ["install", "--prefix", root, "--no-audit", "--no-fund",
    "esbuild@0.25.11", "narraleaf-react@1.4.1", "react@19.2.0", "react-dom@19.2.0", "motion@11.18.2", "@emotion/is-prop-valid@1.4.0"], { stdio: "inherit" });
if (installed.status !== 0) throw new Error("Experiment dependency installation failed");
const { build } = await import(pathToFileURL(path.join(root, "node_modules/esbuild/lib/main.js")).href);
const out = path.join(root, "web");
await mkdir(out);
await build({ entryPoints: [path.join(here, "frame-sequence-browser.mjs")], bundle: true, format: "esm",
    nodePaths: [path.join(root, "node_modules")], outfile: path.join(out, "frame-sequence-browser.bundle.js") });
await copyFile(path.join(here, "frame-sequence-browser.html"), path.join(out, "index.html"));
console.log(`Built experiment: ${out}`);
console.log(`Serve this directory on localhost, then open index.html; window.sequenceExperiment exposes results and controls.`);
