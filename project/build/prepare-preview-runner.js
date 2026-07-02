#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { rootDir } = require('./utils');

const electronPackageDir = path.dirname(require.resolve('electron'));
const electronDistDir = path.join(electronPackageDir, 'dist');
const targetDir = path.join(rootDir, 'resources', 'preview-runner', 'dist');

if (!fs.existsSync(electronDistDir)) {
    console.error(`[preview-runner] Electron dist not found: ${electronDistDir}`);
    process.exit(1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.cpSync(electronDistDir, targetDir, { recursive: true });

console.log(`[preview-runner] Copied Electron runtime to ${path.relative(rootDir, targetDir)}`);
