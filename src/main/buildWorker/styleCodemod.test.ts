import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "../../..");

it("rewrites renderer style literals without changing comments or test fixtures", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "nls-style-codemod-"));
    const preload = path.join(temp, "mock-fs.cjs");
    try {
        await writeFile(preload, String.raw`
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const path = require('node:path');
const actualRead = fs.readFileSync.bind(fs);
const actualReadDir = fs.readdirSync.bind(fs);
const actualStat = fs.statSync.bind(fs);
const actualWrite = fs.writeFileSync.bind(fs);
const tick = String.fromCharCode(96);
const contents = new Map([
    ['sample.tsx', '/* text-[11px] */\nconst className = "text-[11px]";\n'],
    ['apostrophe.tsx', "const view = <><p>Don't edit</p><div className='text-[11px]' /></>;\n"],
    ['nested.tsx', 'const pattern = /text-\\[11px\\]/;\nconst style = ' + tick + 'text-[11px] ' + '$' + '{true ? "text-gray-200" : ""}' + tick + ';\n'],
    ['typed.ts', 'const value = <string>"text-[11px]";\n'],
    ['preview.tsx', 'const style = "border-white/10 bg-white/5";\n'],
    ['sample.test.tsx', 'const fixture = "text-[11px]";\n'],
]);
const normalise = file => typeof file === 'string' ? file.split(path.sep).join('/') : '';
const isFixture = file => normalise(file).includes('/src/renderer/') && contents.has(path.basename(file));
fs.readdirSync = (...args) => normalise(args[0]).endsWith('/src/renderer') ? [...contents.keys()] : actualReadDir(...args);
fs.statSync = (...args) => isFixture(args[0]) ? { isDirectory: () => false } : actualStat(...args);
fs.readFileSync = (...args) => isFixture(args[0]) ? contents.get(path.basename(args[0])) : actualRead(...args);
fs.writeFileSync = (...args) => isFixture(args[0]) ? console.log('changed', JSON.stringify([path.basename(args[0]), args[1]])) : actualWrite(...args);
syncBuiltinESMExports();
`);
        const { stdout } = await execFileAsync(process.execPath, ["--require", preload, "scripts/style-codemod.mjs"], { cwd: root, timeout: 5000 });
        const changes = stdout.split("\n").filter(line => line.startsWith("changed ")).map(line => JSON.parse(line.slice(8)));
        expect(changes).toEqual([
            ["sample.tsx", '/* text-[11px] */\nconst className = "text-2xs";\n'],
            ["apostrophe.tsx", "const view = <><p>Don't edit</p><div className='text-2xs' /></>;\n"],
            ["nested.tsx", 'const pattern = /text-\\[11px\\]/;\nconst style = `text-2xs ${true ? "text-fg" : ""}`;\n'],
            ["typed.ts", 'const value = <string>"text-2xs";\n'],
        ]);
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});
