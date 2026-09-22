import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_NAMED_FILES, unsimulatedFs as fs, writeArchiveNamedTree } from "@shared/utils/asarPatchSimulation";
import { splitAssetStorageId } from "@shared/utils/assetStorageId";
import { encodeProjectConfig } from "@shared/utils/nlproj";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { compileGameRuntimeArtifact } from "./gameRuntimeArtifactCompiler";

// Electron's asar patch, reproduced: see asarPatchSimulation.ts. The compiler reads Studio's own
// runtime bundle through the patched module on purpose and everything of the author's through the
// unpatched one; under plain node both would pass, so the patch is put back for this file.
vi.mock("fs", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsModule());
vi.mock("fs/promises", async () => (await import("@shared/utils/asarPatchSimulation")).simulatedFsPromisesModule());
afterAll(async () => (await import("@shared/utils/asarPatchSimulation")).restoreOriginalFs());

const MODEL_ID = "3c1d0a70-0000-4000-8000-0000000000aa";

let tempDir = "";

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-compile-asar-"));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function write(file: string, content: string | Uint8Array): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

/** The runtime bundle as build-runtime.js leaves it, reduced to the files the compiler insists on. */
function createRuntimeDist(dir: string): void {
    for (const name of ["main.js", "bindings.js", "vendor.js", "preload.js", "renderer.js", "renderer.css", "index.html"]) {
        write(path.join(dir, name), `// ${name}`);
    }
    write(path.join(dir, "build-manifest.json"), JSON.stringify({ mode: "production", engineVersion: "0.44.0-test" }));
}

/** The least a project needs to compile: a config, one surface, an empty graph document. */
function createMinimalProject(projectPath: string): void {
    write(
        path.join(projectPath, "Fixture Project.nlproj"),
        encodeProjectConfig({ name: "Fixture Project", identifier: "fixture.project", metadata: {} }) as unknown as Uint8Array,
    );
    write(path.join(projectPath, "editor", "ui", "uidoc.json"), JSON.stringify({
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "ui-doc",
        name: "Fixture UI",
        surfaces: [{
            id: "surface-main",
            name: "Main",
            host: "app",
            kind: "appSurface",
            designSize: { width: 1280, height: 720 },
            rootElementId: "root",
        }],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                name: "Root",
                parentId: null,
                childrenIds: [],
                layout: { x: 0, y: 0, width: 1280, height: 720 },
            },
        },
    }));
    write(path.join(projectPath, "editor", "ui", "uigraphs.json"), JSON.stringify({
        schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
        graphs: {},
        blueprintDocument: {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {},
            ownerRecords: {},
            persistentVariables: {},
        },
    }));
    write(path.join(projectPath, "assets", "assets.metadata.image.json"), "{}");
}

/**
 * A model bundle is the one asset stored as a folder the author handed over whole, so it is where an
 * author's `bundle.asar` or `old.asar/` reaches the compile with its own name.
 */
function writeModelBundle(projectPath: string): { bundleDir: string; bytes: ReturnType<typeof writeArchiveNamedTree> } {
    const [a, b, rest] = splitAssetStorageId(MODEL_ID);
    const bundleDir = path.join(projectPath, "assets", "content", a, b, rest);
    write(path.join(bundleDir, "Hiyori.model3.json"), '{"FileReferences":{"Textures":[]}}');
    const bytes = writeArchiveNamedTree(bundleDir);
    write(path.join(projectPath, "assets", "assets.metadata.model.json"), JSON.stringify({
        [MODEL_ID]: { id: MODEL_ID, name: "Hiyori.model3.json", source: "local", extras: { modelEntry: "Hiyori.model3.json" } },
    }));
    return { bundleDir, bytes };
}

describe("compiling a project whose files are named like archives", () => {
    it("copies a model bundle holding them byte for byte, and still reads Studio's own runtime", async () => {
        const projectPath = path.join(tempDir, "project");
        const runtimeDistDir = path.join(tempDir, "runtime-dist");
        createRuntimeDist(runtimeDistDir);
        createMinimalProject(projectPath);
        const { bytes } = writeModelBundle(projectPath);

        const result = await compileGameRuntimeArtifact({
            projectPath,
            runtimeDistDir,
            runtimeVersion: "0.0.1-test",
            entry: { kind: "surface", surfaceId: "surface-main" },
            outputRoot: path.join(projectPath, ".nlstudio", "preview"),
            preview: { controlPort: 47391, controlToken: "token" },
        });

        for (const relative of ARCHIVE_NAMED_FILES) {
            const copied = fs.readFileSync(path.join(result.appDir, "assets", MODEL_ID, ...relative.split("/")));
            expect(copied.equals(bytes[relative])).toBe(true);
        }
        expect(fs.readFileSync(path.join(result.appDir, "main.js"), "utf-8")).toBe("// main.js");
    });
});
