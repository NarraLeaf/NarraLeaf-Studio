import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "../../..");

async function buildWithOneFailure(mode: "entries" | "plugins") {
    const temp = await mkdtemp(path.join(os.tmpdir(), "nls-plugin-build-completion-"));
    const runner = path.join(temp, "run.cjs");
    try {
        await writeFile(runner, String.raw`
const Module = require('node:module');
const path = require('node:path');
const actualLoad = Module._load;
const mode = process.argv[2];
let active = 0;
const fakeFs = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({ id: 'plugin', entries: mode === 'entries' ? { studio: 'studio.js', runtime: 'runtime.js' } : { studio: 'studio.js' } }),
    readdirSync: () => ['alpha', 'beta'].map(name => ({ name, isDirectory: () => true })),
    mkdirSync() {}, rmSync() {}, copyFileSync() {},
};
Module._load = function(request, parent, isMain) {
    if (request === 'fs') return fakeFs;
    if (request === './utils') return { rootDir: '/fake/root', distRoot: '/fake/dist', isDev: () => true };
    if (request === './third-party-notices') return { thirdPartyNoticesPlugin: () => ({}) };
    if (request === 'esbuild') return { build: async options => {
        if (options.outfile.endsWith('/alpha/studio.js')) throw new Error('controlled failure');
        active++;
        await new Promise(resolve => setTimeout(resolve, 200));
        active--;
    } };
    return actualLoad.call(this, request, parent, isMain);
};
const builders = require(process.argv[3]);
(async () => {
    try {
        if (mode === 'entries') await builders.buildBuiltInPlugin('/fake/root/src/builtin-plugins/alpha');
        else await builders.buildBuiltInPlugins();
        console.log('unexpected success');
    } catch {
        console.log('active builds after rejection', active);
    }
})();
`);
        const result = await execFileAsync(process.execPath, [runner, mode, path.join(root, "project/build/builtin-plugins.js")], { timeout: 3000 });
        return result.stdout;
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}

it.each(["entries", "plugins"] as const)("waits for remaining %s builds before reporting a failure", async mode => {
    const output = await buildWithOneFailure(mode);
    expect(output).toContain("active builds after rejection 0");
    expect(output).not.toContain("unexpected success");
});
