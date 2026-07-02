import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

const RUNTIME_ROOT = path.resolve(__dirname);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const STATIC_IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*from\s+)?["']([^"']+)["']/g;

const FORBIDDEN_IMPORTS = [
    {
        pattern: /^@\/apps\/workspace(?:\/|$)/,
        reason: "Workspace app UI must stay outside the game runtime.",
    },
    {
        pattern: /^@\/lib\/app\/bridge(?:\/|$)/,
        reason: "Studio renderer bridge must stay outside the game runtime.",
    },
    {
        pattern: /^@\/lib\/plugins(?:\/|$)/,
        reason: "Studio plugin runtime is not part of Phase 1 preview.",
    },
    {
        pattern: /^@\/lib\/workspace\/services(?:\/|$)/,
        reason: "Workspace services must compile the pack before launch, not run in the game runtime.",
    },
    {
        pattern: /^@services(?:\/|$)/,
        reason: "Workspace service aliases must not be consumed by the game runtime.",
    },
    {
        pattern: /^@\/components\/AppLayout(?:\/|$)/,
        reason: "Studio window layout must not be inherited by the game runtime.",
    },
    {
        pattern: /^@\/apps\/(?!dev-mode\/nlr(?:\/|$))/,
        reason: "Only the isolated NLR story runtime helpers may be reused from apps/ during Phase 1.",
    },
];

async function listRuntimeSourceFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listRuntimeSourceFiles(fullPath));
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".test.ts")) {
            files.push(fullPath);
        }
    }
    return files;
}

describe("runtime import boundary", () => {
    it("does not import Studio workspace, bridge, layout, or plugin modules", async () => {
        const violations: string[] = [];

        for (const filePath of await listRuntimeSourceFiles(RUNTIME_ROOT)) {
            const source = await fs.readFile(filePath, "utf-8");
            for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
                const specifier = match[1] ?? "";
                const forbidden = FORBIDDEN_IMPORTS.find(item => item.pattern.test(specifier));
                if (forbidden) {
                    violations.push(`${path.relative(RUNTIME_ROOT, filePath)} imports ${specifier}: ${forbidden.reason}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });
});
