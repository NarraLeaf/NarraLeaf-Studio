import { execFileSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { describe, expect, it } from "vitest";
import { publishedSubPath, sevenZipPath } from "./sevenZipBinary";

const require_ = createRequire(__filename);
const MAIN_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(MAIN_ROOT, "..", "..");

describe("sevenZipPath", () => {
    it("names a file that is actually on disk", () => {
        expect(fs.existsSync(sevenZipPath()), sevenZipPath()).toBe(true);
    });

    it("names it inside the package that publishes it", () => {
        const packageDir = path.dirname(require_.resolve("7zip-bin"));
        expect(path.relative(packageDir, sevenZipPath()).startsWith("..")).toBe(false);
    });

    /*
     * The package composes `<its directory>/<platform>/<arch>/<executable>`, and only the leading
     * directory is ever wrong. Both separators, because the value is read back from a path the
     * package built with the host's own `path.join` and the tests run on all three hosts.
     */
    it("keeps the platform and architecture the package chose, and drops only the directory", () => {
        expect(publishedSubPath("/somewhere/else/win/x64/7za.exe")).toEqual(["win", "x64", "7za.exe"]);
        expect(publishedSubPath("C:\\bundle\\dir\\mac\\arm64\\7za")).toEqual(["mac", "arm64", "7za"]);
        expect(publishedSubPath("/a/linux/ia32/7za")).toEqual(["linux", "ia32", "7za"]);
    });

    /*
     * The regression this file exists for.
     *
     * `7zip-bin` decides where its executable is at import time, from its own `__dirname`. esbuild
     * inlines it into any bundle that does not name it `external`, and the inlined copy then answers
     * with a path under the bundle's directory - `dist/main/win/x64/7za.exe`, which nothing has ever
     * put a file at. It reaches an author as a spawn ENOENT while a protected build looks for the C
     * toolchain it was about to unpack, and it has been fixed twice by adding the package to one
     * more `external` list, a rule four esbuild configurations hold only in comments.
     *
     * So this bundles the module exactly the way `project/build/build-main.js` bundles the main
     * process - inlining the package - and asks the bundle where 7za is. Reading the answer back
     * from a real bundle is the only way to see what the inlining does; calling the module from
     * source cannot, because from source the package's own guess is already right.
     *
     * The bundle is written under the repository rather than into the system temp directory
     * deliberately: resolving `7zip-bin` at run time walks up from wherever the bundle sits, so a
     * bundle outside the tree would fail to resolve for a reason that has nothing to do with what is
     * being checked. `dist/` because it is ignored by git, so a run killed before the cleanup leaves
     * nothing in the working tree.
     */
    it("survives being bundled into a directory that has no 7za in it", async () => {
        const esbuild = await import("esbuild");
        const distDir = path.join(REPO_ROOT, "dist");
        fs.mkdirSync(distDir, { recursive: true });
        const outDir = fs.mkdtempSync(path.join(distDir, "sevenzip-bundle-"));
        try {
            const outfile = path.join(outDir, "bundle.cjs");
            await esbuild.build({
                entryPoints: [path.join(__dirname, "sevenZipBinary.ts")],
                outfile,
                platform: "node",
                format: "cjs",
                bundle: true,
                // Exactly the main process's list, which does not name 7zip-bin: that is the whole
                // point. Adding it here would test the workaround instead of the fix.
                external: ["electron", "esbuild", "@narraleaf/bindings", "koffi", "electron-updater"],
                target: ["node18"],
                tsconfig: path.join(MAIN_ROOT, "tsconfig.json"),
            });
            const bundled = require_(outfile) as { sevenZipPath(): string };
            const resolved = bundled.sevenZipPath();
            expect(resolved.startsWith(outDir), `${resolved} points at the bundle, not the package`).toBe(false);
            expect(fs.existsSync(resolved), resolved).toBe(true);
        } finally {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    }, 30_000);

    /*
     * And the executable a build hands to the OS has to be one the OS can start, which the previous
     * checks do not prove on their own - `existsSync` says yes to a path inside an asar as well,
     * because Electron patches `fs` to answer for the archive's contents.
     */
    it("names something this machine can run", () => {
        const banner = execFileSync(sevenZipPath(), [], { encoding: "utf8" });
        expect(banner).toMatch(/7-Zip/);
    });
});

describe("the package's own path7za", () => {
    /*
     * The way this comes back.
     *
     * Nothing about `path7za` announces that it is only right in some bundles, so the natural thing
     * for a new caller to write is `import { path7za } from "7zip-bin"` - which is how the compile
     * worker acquired the defect after the packaging worker had already been fixed for it. A file
     * added here fails until it either goes through `sevenZipPath` or says why it may not.
     *
     * Test files are exempt: they run from source, where the package's own answer is correct, and
     * several of them use it deliberately as the oracle for what the corrected path should equal.
     */
    it("is read in exactly one place under src/main", () => {
        expect(filesImporting7zipBin()).toEqual(["buildWorker/sevenZipBinary.ts"]);
    });
});

function filesImporting7zipBin(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
                if (/from ["']7zip-bin["']|require\(["']7zip-bin["']\)/.test(fs.readFileSync(full, "utf8"))) {
                    found.push(path.relative(MAIN_ROOT, full).replaceAll(path.sep, "/"));
                }
            }
        }
    };
    walk(MAIN_ROOT);
    return found.sort();
}

describe("the asar copy", () => {
    /*
     * The archive is handed to `execFile`, and what a path inside `app.asar` does there depends on
     * which process is asking - the game-build worker runs with Electron's asar patch off entirely.
     * `unpackAsarPath` sidesteps the question by naming the copy on disk, which exists because
     * `asarUnpack` in electron-builder.yml puts every node_modules file there. This asserts the two
     * still agree: a pattern that stopped covering this package would leave the rewritten path
     * pointing at nothing, and only in a packaged Studio.
     */
    it("is put on disk by an asarUnpack pattern that covers this package", () => {
        // Line endings are normalized first: this repository holds both, and a pattern anchored on
        // "\n" reads a CRLF file as having no list at all.
        const config = fs.readFileSync(path.join(REPO_ROOT, "electron-builder.yml"), "utf8").replaceAll("\r\n", "\n");
        const unpacked = /^asarUnpack:\n((?:[ \t]+-[ \t].*\n)+)/m.exec(config);
        expect(unpacked, "electron-builder.yml must list asarUnpack patterns").not.toBeNull();
        const patterns = unpacked![1].split("\n").map(line => line.replace(/^\s*-\s*/, "").trim()).filter(Boolean);

        // Matched on the segments rather than against the repository root, because the root is not
        // reliably the parent: a worktree reaches the dependencies through a link to the main
        // checkout, and the resolved path is the real one on the other side of it. What the pattern
        // has to cover is where the file sits inside its package tree, which is the same either way.
        const resolved = sevenZipPath().replaceAll(path.sep, "/");
        expect(resolved, resolved).toContain("/node_modules/7zip-bin/");
        expect(patterns).toContain("node_modules/**/*");
    });
});
