import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "../../..");

it("waits for the old Electron process before replacing it", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "nls-dev-restart-"));
    const preload = path.join(temp, "mock-dependencies.cjs");
    try {
        // Exercise the actual launcher with fake builds and child processes. The old child reports
        // a clean exit 200 ms after termination, as it can on platforms that do not report signals.
        await writeFile(preload, String.raw`
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const actualLoad = Module._load;
const actualExit = process.exit.bind(process);
const callbacks = {};
let starts = 0;
process.exit = code => { console.log('unexpected session exit', code); actualExit(91); };
setTimeout(() => actualExit(92), 5000);
Module._load = function(request, parent, isMain) {
    if (request === 'fs') return { ...fs, rmSync() {}, mkdirSync() {}, writeFileSync() {}, existsSync() { return true; } };
    if (request === 'esbuild') return {};
    if (request === 'electron') return 'fake-electron';
    if (request === 'child_process') return { spawn() {
        const child = new EventEmitter();
        starts++;
        console.log('started child', starts);
        child.kill = () => { setTimeout(() => child.emit('exit', 0, null), 200); return true; };
        if (starts === 1) setTimeout(() => callbacks.main(), 10);
        if (starts === 2) setTimeout(() => actualExit(0), 250);
        return child;
    } };
    if (request === 'chokidar') return { watch: () => new EventEmitter() };
    if (request === 'ws') return { WebSocketServer: class extends EventEmitter {
        constructor() { super(); this.clients = new Set(); process.nextTick(() => this.emit('listening')); }
        close() {}
    } };
    if (request === '../build/utils') return { rootDir: '/fake', distRoot: '/fake/dist', distWindows: '/fake/dist/windows', DEV_RELOAD_PORT: 1, getRendererApps: () => [], renderHtml: async () => '' };
    if (request === '../build/watch') return { watchBuild: async (options, onSuccess) => { callbacks[options.name] = onSuccess; onSuccess(); return {}; } };
    if (request === '../build/main-bundles') return { mainProcessBundleOptions: name => ({ name }) };
    if (request === '../build/build-runtime') return { buildRuntime: async () => {} };
    if (request === '../build/builtin-plugins') return { sourceRoot: '/fake/plugins', buildBuiltInPlugins: async () => [] };
    if (request === '../build/postCss-plugin') return { postcssPlugin: () => ({}) };
    if (request === '../build/third-party-notices') return { thirdPartyNoticesPlugin: () => ({}) };
    if (request === '../build/rendererChunks') return { rendererChunkOptions: () => ({}), chunkStylesheetPlugin: () => ({}) };
    if (request === '../build/rendererLocales') return { leanLocalePlugin: () => ({}) };
    return actualLoad.call(this, request, parent, isMain);
};
`);
        let stdout: string;
        let exitCode = 0;
        try {
            ({ stdout } = await execFileAsync(process.execPath, ["--require", preload, path.join(root, "project/app/dev-electron.js"), "--window-tag=dev-restart-test"], { timeout: 7000 }));
        } catch (error) {
            const failure = error as Error & { code: number; stdout: string };
            exitCode = failure.code;
            stdout = failure.stdout;
        }
        expect(exitCode, stdout).toBe(0);
        expect(stdout).toContain("started child 2");
        expect(stdout.indexOf("electron process terminated by dev server")).toBeGreaterThan(-1);
        expect(stdout.indexOf("electron process terminated by dev server")).toBeLessThan(stdout.indexOf("started child 2"));
        expect(stdout).not.toContain("unexpected session exit");
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}, 10_000);

it("starts Electron on the next rebuild after a spawn failure", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "nls-dev-spawn-"));
    const preload = path.join(temp, "mock-dependencies.cjs");
    try {
        await writeFile(preload, String.raw`
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const actualLoad = Module._load;
const actualExit = process.exit.bind(process);
const callbacks = {};
let starts = 0;
setTimeout(() => actualExit(92), 2500);
Module._load = function(request, parent, isMain) {
    if (request === 'fs') return { ...fs, rmSync() {}, mkdirSync() {}, writeFileSync() {}, existsSync() { return true; } };
    if (request === 'esbuild') return {};
    if (request === 'electron') return 'fake-electron';
    if (request === 'child_process') return { spawn() {
        const child = new EventEmitter();
        starts++;
        console.log('started child', starts);
        child.kill = () => false;
        if (starts === 1) {
            process.nextTick(() => child.emit('error', new Error('spawn failed')));
            setTimeout(() => callbacks.main(), 20);
        } else {
            child.pid = 123;
            setTimeout(() => actualExit(0), 50);
        }
        return child;
    } };
    if (request === 'chokidar') return { watch: () => new EventEmitter() };
    if (request === 'ws') return { WebSocketServer: class extends EventEmitter {
        constructor() { super(); this.clients = new Set(); process.nextTick(() => this.emit('listening')); }
        close() {}
    } };
    if (request === '../build/utils') return { rootDir: '/fake', distRoot: '/fake/dist', distWindows: '/fake/dist/windows', DEV_RELOAD_PORT: 1, getRendererApps: () => [], renderHtml: async () => '' };
    if (request === '../build/watch') return { watchBuild: async (options, onSuccess) => { callbacks[options.name] = onSuccess; onSuccess(); return {}; } };
    if (request === '../build/main-bundles') return { mainProcessBundleOptions: name => ({ name }) };
    if (request === '../build/build-runtime') return { buildRuntime: async () => {} };
    if (request === '../build/builtin-plugins') return { sourceRoot: '/fake/plugins', buildBuiltInPlugins: async () => [] };
    if (request === '../build/postCss-plugin') return { postcssPlugin: () => ({}) };
    if (request === '../build/third-party-notices') return { thirdPartyNoticesPlugin: () => ({}) };
    if (request === '../build/rendererChunks') return { rendererChunkOptions: () => ({}), chunkStylesheetPlugin: () => ({}) };
    if (request === '../build/rendererLocales') return { leanLocalePlugin: () => ({}) };
    return actualLoad.call(this, request, parent, isMain);
};
`);
        let stdout: string;
        let exitCode = 0;
        try {
            ({ stdout } = await execFileAsync(process.execPath, ["--require", preload, path.join(root, "project/app/dev-electron.js"), "--window-tag=dev-spawn-test"], { timeout: 4000 }));
        } catch (error) {
            const failure = error as Error & { code: number; stdout: string };
            exitCode = failure.code;
            stdout = failure.stdout;
        }
        expect(exitCode, stdout).toBe(0);
        expect(stdout).toContain("started child 2");
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}, 7_000);
