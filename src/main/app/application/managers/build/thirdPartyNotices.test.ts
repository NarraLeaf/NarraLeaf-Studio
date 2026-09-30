import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { afterEach, describe, expect, it } from "vitest";
import type { Plugin } from "esbuild";
import {
    composeThirdPartyNotices,
    gameThirdPartyNotices,
    readThirdPartyNoticesDocument,
    type ThirdPartyNoticesDocument,
} from "./thirdPartyNotices";
import type { GameRuntimePluginSource } from "../preview/compiler/gameRuntimeArtifactCompiler";

/*
 * The generator runs inside Studio's build scripts, so these drive it the way they do: a real
 * esbuild bundle over a fixture `node_modules`, with the plugin writing into a fixture `dist/`. The
 * other half - picking a game's notice out of those documents - is then read back from that same
 * `dist/`, so both sides are tested against one real output rather than against a hand-written copy
 * of the format.
 */

const require_ = createRequire(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..", "..");

type Generator = {
    ALLOWED_LICENSES: Set<string>;
    NOTICES_FILENAME: string;
    NOTICES_DOCUMENT_FILENAME: string;
    isAllowedExpression(expression: string): boolean;
    thirdPartyNoticesPlugin(options: { distRoot: string; repositoryRoot: string; shipsWith?: string[] }): Plugin;
};

const generator = require_(path.join(REPO_ROOT, "project", "build", "third-party-notices.js")) as Generator;

const MIT_TEXT = "MIT License\r\n\r\nCopyright (c) Alpha Authors\r\n\r\nPermission is hereby granted...   \r\n\r\n";

const temporaryDirs: string[] = [];

afterEach(() => {
    for (const dir of temporaryDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

type FixturePackage = {
    name: string;
    version: string;
    license?: string;
    repository?: string;
    files?: Record<string, string>;
};

/**
 * A repository in a temporary directory: `src/<entry>.js` files importing the given packages from
 * a `node_modules` of its own, and an empty `dist/`.
 */
function fixture(packages: FixturePackage[], entries: Record<string, string[]>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nls-notices-"));
    temporaryDirs.push(root);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture-repo", version: "1.0.0" }));
    for (const pkg of packages) {
        const dir = path.join(root, "node_modules", ...pkg.name.split("/"));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
            name: pkg.name,
            version: pkg.version,
            main: "index.js",
            ...(pkg.license ? { license: pkg.license } : {}),
            ...(pkg.repository ? { repository: pkg.repository } : {}),
        }));
        // Something the bundle has to keep, so the package's bytes survive tree-shaking.
        fs.writeFileSync(path.join(dir, "index.js"), `module.exports = function () { return ${JSON.stringify(pkg.name)}; };\n`);
        for (const [file, text] of Object.entries(pkg.files ?? {})) {
            fs.writeFileSync(path.join(dir, file), text);
        }
    }
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    for (const [entry, imports] of Object.entries(entries)) {
        fs.writeFileSync(
            path.join(root, "src", `${entry}.js`),
            imports.map((name, index) => `const p${index} = require(${JSON.stringify(name)});\nconsole.log(p${index}());\n`).join(""),
        );
    }
    return { root, dist: path.join(root, "dist") };
}

async function bundle(
    repo: { root: string; dist: string },
    entry: string,
    outfile: string,
    shipsWith: string[] = [],
) {
    const esbuild = await import("esbuild");
    return esbuild.build({
        entryPoints: [path.join(repo.root, "src", `${entry}.js`)],
        outfile: path.join(repo.dist, outfile),
        bundle: true,
        platform: "node",
        format: "cjs",
        absWorkingDir: repo.root,
        logLevel: "silent",
        plugins: [generator.thirdPartyNoticesPlugin({ distRoot: repo.dist, repositoryRoot: repo.root, shipsWith })],
    });
}

function readNotices(dist: string, ...scope: string[]): string {
    return fs.readFileSync(path.join(dist, ...scope, generator.NOTICES_FILENAME), "utf-8");
}

function readDocument(dist: string, ...scope: string[]): ThirdPartyNoticesDocument {
    return JSON.parse(fs.readFileSync(path.join(dist, ...scope, generator.NOTICES_DOCUMENT_FILENAME), "utf-8"));
}

const ALPHA: FixturePackage = {
    name: "alpha",
    version: "1.0.0",
    license: "MIT",
    repository: "git+https://github.com/example/alpha.git",
    files: { LICENSE: MIT_TEXT },
};
const SCOPED: FixturePackage = {
    name: "@scope/beta",
    version: "2.0.0",
    license: "(MIT OR Apache-2.0)",
    files: { "LICENSE-MIT": "MIT text for beta", NOTICE: "Beta NOTICE" },
};
/** States its licence and ships no file for it. */
const FIELD_ONLY: FixturePackage = { name: "gamma", version: "0.1.0", license: "ISC" };

describe("the licence allow-list", () => {
    it("reads SPDX expressions the way the licences combine", () => {
        expect(generator.isAllowedExpression("MIT")).toBe(true);
        expect(generator.isAllowedExpression("(MIT OR GPL-3.0-only)")).toBe(true);
        expect(generator.isAllowedExpression("MIT AND Zlib")).toBe(true);
        expect(generator.isAllowedExpression("Apache-2.0 WITH LLVM-exception")).toBe(true);
        expect(generator.isAllowedExpression("MIT AND GPL-3.0-only")).toBe(false);
        expect(generator.isAllowedExpression("GPL-3.0-or-later")).toBe(false);
        expect(generator.isAllowedExpression("UNLICENSED")).toBe(false);
        expect(generator.isAllowedExpression("SEE LICENSE IN LICENSE.txt")).toBe(false);
        expect(generator.isAllowedExpression("(MIT")).toBe(false);
    });

    it("fails the bundle on a licence outside the list, naming the package, and records nothing", async () => {
        const repo = fixture([
            ALPHA,
            { name: "copyleft", version: "3.1.4", license: "GPL-3.0-only", files: { COPYING: "GPL text" } },
        ], { main: ["alpha", "copyleft"] });

        await expect(bundle(repo, "main", "runtime/main.js"))
            .rejects.toThrow(/main\.js includes "copyleft@3\.1\.4" is licensed "GPL-3\.0-only", which is not one of the allowed licences/);
        expect(fs.existsSync(path.join(repo.dist, "runtime", generator.NOTICES_DOCUMENT_FILENAME))).toBe(false);
        expect(fs.existsSync(path.join(repo.dist, generator.NOTICES_FILENAME))).toBe(false);
    });

    it("fails the bundle on a package with no licence information at all", async () => {
        const repo = fixture([{ name: "mystery", version: "0.0.1" }], { main: ["mystery"] });
        await expect(bundle(repo, "main", "runtime/main.js"))
            .rejects.toThrow(/"mystery@0\.0\.1" declares no licence and ships no licence file/);
    });

    it("fails the bundle on a package whose licence file has no identifier to check", async () => {
        const repo = fixture([{ name: "unnamed", version: "1.2.3", files: { LICENSE: "Some licence" } }], { main: ["unnamed"] });
        await expect(bundle(repo, "main", "runtime/main.js"))
            .rejects.toThrow(/"unnamed@1\.2\.3" ships LICENSE but its package\.json names no licence/);
    });

    it("fails an MPL-2.0 package that does not say where its source is", async () => {
        const repo = fixture([{ name: "weak", version: "1.0.0", license: "MPL-2.0", files: { LICENSE: "MPL text" } }], { main: ["weak"] });
        await expect(bundle(repo, "main", "runtime/main.js"))
            .rejects.toThrow(/"weak@1\.0\.0" is licensed "MPL-2\.0", which requires the notice to say where its source is published/);
    });
});

describe("the generated notice", () => {
    it("lists what the bundle contains, with each package's own licence text", async () => {
        const repo = fixture([ALPHA, SCOPED, FIELD_ONLY], { main: ["alpha", "gamma"], web: ["@scope/beta"] });
        await bundle(repo, "main", "runtime/main.js");
        await bundle(repo, "web", "runtime/web.js");

        const text = readNotices(repo.dist, "runtime");
        expect(text.startsWith("THIRD-PARTY SOFTWARE NOTICES\n")).toBe(true);
        // Sorted by name by code unit: the scoped package first.
        const order = ["@scope/beta 2.0.0", "alpha 1.0.0", "gamma 0.1.0"].map(line => text.indexOf(`\n${line}\n`));
        expect(order.every(index => index > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        // The text as the package ships it, normalised: LF, no trailing spaces, no trailing blank lines.
        expect(text).toContain("alpha 1.0.0\nLicense: MIT\nSource: https://github.com/example/alpha\n\nMIT License\n\nCopyright (c) Alpha Authors\n\nPermission is hereby granted...\n");
        expect(text).not.toContain("\r");
        // Two files each under its own name.
        expect(text).toContain("LICENSE-MIT\n-----------\nMIT text for beta\n\nNOTICE\n------\nBeta NOTICE\n");
        // The field is used, and said to be used, only when there is no file.
        expect(text).toContain('gamma 0.1.0\nLicense: ISC\n\nThis package ships no licence file. Its package.json states the licence as "ISC".\n');
        // The repository's own source is not third-party.
        expect(text).not.toContain("fixture-repo");

        const document = readDocument(repo.dist, "runtime");
        expect(document.outputs).toEqual({ "main.js": ["alpha@1.0.0", "gamma@0.1.0"], "web.js": ["@scope/beta@2.0.0"] });
        // Studio's own notice is every scope together.
        expect(readNotices(repo.dist)).toBe(text);
    });

    it("carries a package the bundle ships beside itself rather than inlining", async () => {
        const repo = fixture([ALPHA, FIELD_ONLY], { main: ["alpha"] });
        await bundle(repo, "main", "runtime/main.js", ["gamma"]);
        expect(readDocument(repo.dist, "runtime").outputs["main.js"]).toEqual(["alpha@1.0.0", "gamma@0.1.0"]);
    });

    it("is the same bytes however many times and in whatever order it is built", async () => {
        const repo = fixture([ALPHA, SCOPED, FIELD_ONLY], { main: ["alpha", "gamma"], web: ["@scope/beta", "alpha"] });
        const files = () => [
            path.join(repo.dist, "runtime", generator.NOTICES_DOCUMENT_FILENAME),
            path.join(repo.dist, "runtime", generator.NOTICES_FILENAME),
            path.join(repo.dist, generator.NOTICES_FILENAME),
        ].map(file => fs.readFileSync(file, "utf-8"));

        await bundle(repo, "main", "runtime/main.js");
        await bundle(repo, "web", "runtime/web.js");
        const first = files();

        await bundle(repo, "main", "runtime/main.js");
        await bundle(repo, "web", "runtime/web.js");
        expect(files()).toEqual(first);

        fs.rmSync(repo.dist, { recursive: true, force: true });
        await bundle(repo, "web", "runtime/web.js");
        await bundle(repo, "main", "runtime/main.js");
        expect(files()).toEqual(first);
    });

    it("drops a package once no output contains it", async () => {
        const repo = fixture([ALPHA, FIELD_ONLY], { main: ["alpha", "gamma"], leaner: ["alpha"] });
        await bundle(repo, "main", "runtime/main.js");
        expect(readNotices(repo.dist, "runtime")).toContain("gamma 0.1.0");

        // The same output rebuilt from an entry that no longer uses gamma.
        const esbuild = await import("esbuild");
        await esbuild.build({
            entryPoints: [path.join(repo.root, "src", "leaner.js")],
            outfile: path.join(repo.dist, "runtime", "main.js"),
            bundle: true,
            platform: "node",
            absWorkingDir: repo.root,
            logLevel: "silent",
            plugins: [generator.thirdPartyNoticesPlugin({ distRoot: repo.dist, repositoryRoot: repo.root })],
        });
        expect(readNotices(repo.dist, "runtime")).not.toContain("gamma");
        expect(Object.keys(readDocument(repo.dist, "runtime").packages)).toEqual(["alpha@1.0.0"]);
    });
});

describe("a game's notice", () => {
    async function builtFixture() {
        const repo = fixture([ALPHA, SCOPED, FIELD_ONLY, { ...ALPHA, name: "delta", repository: undefined }], {
            main: ["alpha"],
            renderer: ["@scope/beta"],
            web: ["gamma"],
            pluginRuntime: ["delta"],
            pluginStudio: ["gamma"],
        });
        await bundle(repo, "main", "runtime/main.js", ["delta"]);
        await bundle(repo, "renderer", "runtime/renderer.js");
        await bundle(repo, "web", "runtime/web.js");
        await bundle(repo, "pluginRuntime", "builtin-plugins/sample/runtime.js");
        await bundle(repo, "pluginStudio", "builtin-plugins/sample/main.js");
        return repo;
    }

    function plugin(installPath: string, builtIn: boolean): GameRuntimePluginSource {
        return {
            manifest: { id: "narraleaf.sample", name: "Sample" } as GameRuntimePluginSource["manifest"],
            entry: "runtime.js",
            entryPath: path.join(installPath, "runtime.js"),
            installPath,
            builtIn,
        };
    }

    it("names exactly what that kind of package carries", async () => {
        const repo = await builtFixture();
        const runtimeDistDir = path.join(repo.dist, "runtime");

        const desktop = await gameThirdPartyNotices({ runtimeDistDir, shell: "electron", plugins: [] });
        expect(desktop).toContain("\nalpha 1.0.0\n");
        expect(desktop).toContain("\n@scope/beta 2.0.0\n");
        // Shipped beside main.js, which only a desktop game carries.
        expect(desktop).toContain("\ndelta 1.0.0\n");
        // Only in web.js.
        expect(desktop).not.toContain("gamma");

        const web = await gameThirdPartyNotices({ runtimeDistDir, shell: "web", plugins: [] });
        expect(web).toContain("\n@scope/beta 2.0.0\n");
        expect(web).toContain("\ngamma 0.1.0\n");
        expect(web).not.toContain("alpha");
        expect(web).not.toContain("delta");
    });

    it("adds a built-in plugin's runtime entry and never its Studio entry or a third-party plugin", async () => {
        const repo = await builtFixture();
        const runtimeDistDir = path.join(repo.dist, "runtime");
        const installPath = path.join(repo.dist, "builtin-plugins", "sample");

        const withPlugin = await gameThirdPartyNotices({ runtimeDistDir, shell: "web", plugins: [plugin(installPath, true)] });
        expect(withPlugin).toContain("\ndelta 1.0.0\n");
        // gamma is in the plugin's Studio entry too, but it is here because of web.js alone.
        expect(withPlugin.match(/\ngamma 0\.1\.0\n/g)).toHaveLength(1);

        const thirdParty = await gameThirdPartyNotices({ runtimeDistDir, shell: "web", plugins: [plugin(installPath, false)] });
        expect(thirdParty).not.toContain("delta");
    });

    it("is the build scripts' own text when it ships every output they recorded", async () => {
        const repo = await builtFixture();
        const document = await readThirdPartyNoticesDocument(path.join(repo.dist, "runtime"), "the game runtime");
        const everything = composeThirdPartyNotices([{ document, outputs: Object.keys(document.outputs) }]);
        expect(everything).toBe(readNotices(repo.dist, "runtime"));
    });

    it("refuses to package without the runtime's document", async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "nls-notices-"));
        temporaryDirs.push(empty);
        await expect(gameThirdPartyNotices({ runtimeDistDir: empty, shell: "electron", plugins: [] }))
            .rejects.toThrow(/The third-party notice of the game runtime is missing/);
    });
});
