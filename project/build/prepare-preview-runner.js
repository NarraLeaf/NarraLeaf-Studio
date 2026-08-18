#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { rootDir } = require("./utils");

const electronPackageDir = path.dirname(require.resolve("electron"));
const electronDistDir = path.join(electronPackageDir, "dist");
const targetDir = path.join(rootDir, "resources", "preview-runner", "dist");

if (!fs.existsSync(electronDistDir)) {
  console.error(`[preview-runner] Electron dist not found: ${electronDistDir}`);
  process.exit(1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetDir), { recursive: true });
// `verbatimSymlinks` is load-bearing on macOS. A .app bundle is held together by
// relative symlinks - `Electron Framework.framework/Resources -> Versions/Current/Resources`,
// `Versions/Current -> A` - and fs.cpSync's default is to *resolve* a relative
// link against its source directory and write the absolute result. The copy then
// points every framework lookup back at this machine's node_modules, which
// electron-builder faithfully carries into the installer.
//
// The failure is delayed and does not look like a packaging bug. Preview's
// browser process starts (it reads the framework through paths that happen to
// still exist on the build host), then every sandboxed child - GPU, network
// service - is denied the escape out of the app bundle and dies with
// "icudtl.dat not found in bundle", "GPU process isn't usable. Goodbye.". On any
// other machine the links simply dangle. Verified against Node 22: the option
// exists since 18.17/20.1.
fs.cpSync(electronDistDir, targetDir, { recursive: true, verbatimSymlinks: true });

// The copy above is the only thing standing between a working preview and that
// failure mode, and nothing downstream checks: electron-builder copies symlinks
// verbatim (builder-util/out/fs.js), so a bad link is packaged without complaint
// and only surfaces when an author clicks Preview in an installed Studio. Assert
// it here, where the fix is one option away.
const escaped = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(entryPath);
      const resolved = path.resolve(path.dirname(entryPath), link);
      if (path.isAbsolute(link) || path.relative(targetDir, resolved).startsWith("..")) {
        escaped.push(`${path.relative(targetDir, entryPath)} -> ${link}`);
      }
    } else if (entry.isDirectory()) {
      walk(entryPath);
    }
  }
};
walk(targetDir);
if (escaped.length > 0) {
  console.error(
    "[preview-runner] Symlinks point outside the staged runtime; the packaged preview would be broken:"
  );
  for (const line of escaped) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

console.log(`[preview-runner] Copied Electron runtime to ${path.relative(rootDir, targetDir)}`);
