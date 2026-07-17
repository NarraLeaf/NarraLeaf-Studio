#!/usr/bin/env node

/*
 * Stage the prebuilt mobile shell templates (@narraleaf/studio-shell) into
 * resources/, from where electron-builder's extraResources copies them into the
 * packaged Studio. The mobile repack reads its templates from there.
 *
 * The staged tree is an exact mirror of the npm package (android/, ios/,
 * manifest.json), which is what lets resolveMobileShellDirForApp point at the
 * node_modules copy in development and at this one when packaged: manifest.json
 * addresses its templates relative to the package root, so both roots are read
 * identically. Both variants are staged even though the packaged Studio only
 * ever repacks the release one — a mirror keeps manifest.json truthful, and the
 * debug template is ~0.9 MB.
 */

const fs = require('fs');
const path = require('path');
const { rootDir } = require('./utils');

const shellPackageDir = path.dirname(require.resolve('@narraleaf/studio-shell/package.json'));
const targetDir = path.join(rootDir, 'resources', 'mobile-shell');
// Mirrors the package's own `files` list, minus the docs.
const payload = ['android', 'ios', 'manifest.json'];

for (const item of payload) {
    if (!fs.existsSync(path.join(shellPackageDir, item))) {
        console.error(`[mobile-shell] Missing "${item}" in ${shellPackageDir}; is @narraleaf/studio-shell installed?`);
        process.exit(1);
    }
}

// Wipe rather than merge: a stale template left behind by an older version of
// the package would otherwise ship inside the installer. Everything but the
// checked-in .gitignore goes, including layout the current package no longer
// has.
fs.mkdirSync(targetDir, { recursive: true });
for (const existing of fs.readdirSync(targetDir)) {
    if (existing === '.gitignore') {
        continue;
    }
    fs.rmSync(path.join(targetDir, existing), { recursive: true, force: true });
}
for (const item of payload) {
    fs.cpSync(path.join(shellPackageDir, item), path.join(targetDir, item), { recursive: true });
}

const { version } = require('@narraleaf/studio-shell/package.json');
console.log(`[mobile-shell] Staged shell templates v${version} to ${path.relative(rootDir, targetDir)}`);
