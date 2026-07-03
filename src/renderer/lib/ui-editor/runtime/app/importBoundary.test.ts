import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * The runtime/app orchestration layer is shared by Studio Dev Mode AND the
 * standalone game runtime build (see project/build/build-runtime.js
 * runtimeAliasPlugin). It therefore must not import Studio-app-only modules.
 * This mirrors src/runtime/runtimeImportBoundary.test.ts but runs against
 * this directory so violations fail fast at test time instead of at the
 * runtime esbuild step.
 */

const APP_ROOT = path.resolve(__dirname);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const STATIC_IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*from\s+)?["']([^"']+)["']/g;

const FORBIDDEN_IMPORTS = [
    { pattern: /^@\/apps(?:\/|$)/, reason: "App-specific UI must stay outside the shared game app layer." },
    { pattern: /^@\/lib\/app\/bridge(?:\/|$)/, reason: "Studio renderer IPC bridge must be injected via the host interface." },
    { pattern: /^@\/lib\/plugins(?:\/|$)/, reason: "Studio plugin runtime is not part of the shared game app layer." },
    { pattern: /^@\/lib\/workspace(?:\/|$)/, reason: "Workspace services/hooks must not be consumed by the shared game app layer." },
    { pattern: /^@services(?:\/|$)/, reason: "Workspace service aliases must not be consumed by the shared game app layer." },
    { pattern: /^@\/components\/AppLayout(?:\/|$)/, reason: "Studio window layout must not be inherited by the shared game app layer." },
];

async function listSourceFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listSourceFiles(fullPath));
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !/\.test\.tsx?$/.test(entry.name)) {
            files.push(fullPath);
        }
    }
    return files;
}

describe("runtime/app import boundary", () => {
    it("does not import Studio app, bridge, workspace, or plugin modules", async () => {
        const violations: string[] = [];

        for (const filePath of await listSourceFiles(APP_ROOT)) {
            const source = await fs.readFile(filePath, "utf-8");
            for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
                const specifier = match[1] ?? "";
                const forbidden = FORBIDDEN_IMPORTS.find(item => item.pattern.test(specifier));
                if (forbidden) {
                    violations.push(`${path.relative(APP_ROOT, filePath)} imports ${specifier}: ${forbidden.reason}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });
});
