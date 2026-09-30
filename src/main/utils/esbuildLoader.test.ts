import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEsbuild, loadEsbuildWith, unpackedEsbuildBinary, type EsbuildRequire } from "./esbuildLoader";

const MAIN_ROOT = path.resolve(__dirname, "..");
const EXECUTABLE = process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
const PACKAGE = `@esbuild/${process.platform}-${process.arch}`;

/** Where a packaged Studio's `require.resolve` puts the binary: inside the archive. */
const IN_ARCHIVE = path.join("C:", "Studio", "resources", "app.asar", "node_modules", ...PACKAGE.split("/"), ...EXECUTABLE.split("/"));
const ON_DISK = IN_ARCHIVE.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);

const originalBinaryPath = process.env.ESBUILD_BINARY_PATH;

afterEach(() => {
    if (originalBinaryPath === undefined) {
        delete process.env.ESBUILD_BINARY_PATH;
    } else {
        process.env.ESBUILD_BINARY_PATH = originalBinaryPath;
    }
});

/** A `require` that answers like a packaged Studio's and records what esbuild would have read. */
function packagedRequire(): EsbuildRequire & { seenBinaryPath: Array<string | undefined> } {
    const seenBinaryPath: Array<string | undefined> = [];
    const requireFn = ((id: string) => {
        expect(id).toBe("esbuild");
        // esbuild reads the variable once, while its module is evaluated - which is this call.
        seenBinaryPath.push(process.env.ESBUILD_BINARY_PATH);
        return { version: "fake" };
    }) as EsbuildRequire & { seenBinaryPath: Array<string | undefined> };
    requireFn.resolve = specifier => {
        expect(specifier).toBe(`${PACKAGE}/${EXECUTABLE}`);
        return IN_ARCHIVE;
    };
    requireFn.seenBinaryPath = seenBinaryPath;
    return requireFn;
}

describe("loading esbuild", () => {
    /*
     * The defect this exists for. In a packaged Studio esbuild resolves its binary to a path inside
     * app.asar and spawns it; spawn is not redirected out of the archive, so every compile failed with
     * ENOENT. An unpacked checkout - every test run and every `yarn dev` - never sees it.
     */
    it("points esbuild at the unpacked binary while it loads inside a packaged Studio", () => {
        delete process.env.ESBUILD_BINARY_PATH;
        const requireFn = packagedRequire();

        loadEsbuildWith(requireFn);

        expect(requireFn.seenBinaryPath).toEqual([ON_DISK]);
    });

    it("leaves the environment as it found it, so nothing Studio starts later inherits the path", () => {
        delete process.env.ESBUILD_BINARY_PATH;
        loadEsbuildWith(packagedRequire());
        expect(process.env.ESBUILD_BINARY_PATH).toBeUndefined();
    });

    it("does not override a binary path the machine already configured", () => {
        process.env.ESBUILD_BINARY_PATH = "/opt/esbuild";
        const requireFn = packagedRequire();

        loadEsbuildWith(requireFn);

        expect(requireFn.seenBinaryPath).toEqual(["/opt/esbuild"]);
        expect(process.env.ESBUILD_BINARY_PATH).toBe("/opt/esbuild");
    });

    it("names the unpacked copy only for a path inside an archive", () => {
        expect(unpackedEsbuildBinary(() => IN_ARCHIVE)).toBe(ON_DISK);
        expect(unpackedEsbuildBinary(() => path.join("D:", "repo", "node_modules", "@esbuild", "x", "esbuild.exe"))).toBeNull();
        expect(unpackedEsbuildBinary(() => {
            throw new Error("no binary package for this platform");
        })).toBeNull();
    });

    it("hands back a working API from a checkout", async () => {
        const esbuild = await loadEsbuild();
        const result = await esbuild.transform("const n: number = 1", { loader: "ts" });
        expect(result.code).toContain("const n = 1");
    });
});

describe("where esbuild is loaded", () => {
    /*
     * esbuild captures its binary path the first time its module is evaluated, so one load anywhere
     * else under src/main that ran first would decide it for the whole process - and the packaged
     * Studio would be back to a binary it cannot start. A type-only import is erased and loads
     * nothing, so it is allowed. Tests are exempt: they run from a checkout, where either load works.
     */
    it("happens only in the loader", () => {
        expect(filesLoadingEsbuild()).toEqual(["utils/esbuildLoader.ts"]);
    });
});

function filesLoadingEsbuild(): string[] {
    // A value import in any spelling; `typeof import("esbuild")` and `import type` are types only.
    const loads = /(?<!typeof\s+)import\(\s*["']esbuild["']\s*\)|require\(\s*["']esbuild["']\s*\)|^\s*import\s+(?!type\b)[^;]*from\s+["']esbuild["']|requireFn\(\s*["']esbuild["']\s*\)/m;
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
                if (loads.test(fs.readFileSync(full, "utf8"))) {
                    found.push(path.relative(MAIN_ROOT, full).replaceAll(path.sep, "/"));
                }
            }
        }
    };
    walk(MAIN_ROOT);
    return found.sort();
}
