import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "../../..");

it("serialises built-in plugin rebuilds when edits arrive during a build", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "nls-dev-plugin-watch-"));
    const preload = path.join(temp, "mock-dependencies.cjs");
    try {
        await writeFile(preload, String.raw`
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const actualLoad = Module._load;
const actualExit = process.exit.bind(process);
let builds = 0;
let running = 0;
let maxRunning = 0;
setTimeout(() => actualExit(92), 4000);
Module._load = function(request, parent, isMain) {
    if (request === 'fs') return { ...fs, rmSync() {}, mkdirSync() {}, writeFileSync() {}, existsSync() { return true; } };
    if (request === 'esbuild') return {};
    if (request === 'electron') return 'fake-electron';
    if (request === 'child_process') return { spawn() {
        const child = new EventEmitter();
        child.pid = 123;
        child.kill = () => true;
        return child;
    } };
    if (request === 'chokidar') return { watch: root => {
        const watcher = new EventEmitter();
        if (root === '/fake/plugins') {
            setTimeout(() => watcher.emit('all', 'change'), 10);
            setTimeout(() => watcher.emit('all', 'change'), 240);
        }
        return watcher;
    } };
    if (request === 'ws') return { WebSocketServer: class extends EventEmitter {
        constructor() { super(); this.clients = new Set(); process.nextTick(() => this.emit('listening')); }
        close() {}
    } };
    if (request === '../build/utils') return { rootDir: '/fake', distRoot: '/fake/dist', distWindows: '/fake/dist/windows', DEV_RELOAD_PORT: 1, getRendererApps: () => [], renderHtml: async () => '' };
    if (request === '../build/watch') return { watchBuild: async (options, onSuccess) => { onSuccess(); return {}; } };
    if (request === '../build/main-bundles') return { mainProcessBundleOptions: name => ({ name }) };
    if (request === '../build/build-runtime') return { buildRuntime: async () => {} };
    if (request === '../build/builtin-plugins') return { sourceRoot: '/fake/plugins', buildBuiltInPlugins: async () => {
        const build = ++builds;
        if (build === 1) return [];
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise(resolve => setTimeout(resolve, build === 2 ? 600 : 100));
        running--;
        if (builds >= 3 && running === 0) {
            console.log('plugin builds', builds, 'maximum running', maxRunning);
            setTimeout(() => actualExit(0), 20);
        }
        return [];
    } };
    if (request === '../build/postCss-plugin') return { postcssPlugin: () => ({}) };
    if (request === '../build/third-party-notices') return { thirdPartyNoticesPlugin: () => ({}) };
    if (request === '../build/rendererChunks') return { rendererChunkOptions: () => ({}), chunkStylesheetPlugin: () => ({}) };
    if (request === '../build/rendererLocales') return { leanLocalePlugin: () => ({}) };
    return actualLoad.call(this, request, parent, isMain);
};
`);
        const { stdout } = await execFileAsync(process.execPath, ["--require", preload, path.join(root, "project/app/dev-electron.js"), "--window-tag=dev-plugin-watch-test"], { timeout: 5000 });
        expect(stdout).toContain("plugin builds 3 maximum running 1");
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}, 7_000);
