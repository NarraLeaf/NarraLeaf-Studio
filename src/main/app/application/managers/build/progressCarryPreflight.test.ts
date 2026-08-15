import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_GAME_EXPORT_PROGRESS,
    BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS,
} from "@shared/types/blueprint/graph";
import { collectProgressCarryFindings } from "./progressCarryPreflight";

/**
 * A build target that cannot carry progress, against a project that tries to.
 *
 * The shape worth pinning is the pair of quiet cases: a desktop build must read nothing at all, and
 * a web build of a project with no such node must say nothing - a warning every author sees on every
 * build is a warning nobody reads.
 */

let tempDir: string;

beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-progress-preflight-"));
});

afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
});

function blueprint(id: string, name: string, nodeType: string) {
    return {
        id,
        name,
        owner: { kind: "globalMain" },
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                events: {
                    main: {
                        id: "main",
                        name: "On Click",
                        graph: { nodes: { "node-1": { id: "node-1", type: nodeType } }, edges: [] },
                    },
                },
            },
        },
    };
}

async function writeGraphs(blueprints: Record<string, unknown>): Promise<void> {
    const dir = path.join(tempDir, "editor", "ui");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
        path.join(dir, "uigraphs.json"),
        JSON.stringify({
            schemaVersion: 2,
            graphs: {},
            blueprintDocument: { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints, ownerRecords: {} },
        }),
        "utf-8",
    );
}

describe("the progress carry preflight", () => {
    it("warns once per refusing target, naming the blueprint to open", async () => {
        await writeGraphs({
            "bp-title": blueprint("bp-title", "Title Screen", BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS),
        });

        const findings = await collectProgressCarryFindings({
            projectPath: tempDir,
            platforms: ["windows", "web", "android"],
        });

        expect(findings.map(finding => finding.detail?.platform)).toEqual(["web", "android"]);
        for (const finding of findings) {
            expect(finding.code).toBe("progress-carry-unsupported");
            expect(finding.severity).toBe("warning");
            expect(finding.detail?.blueprints).toBe("Title Screen");
        }
    });

    it("names every blueprint that uses either node, once each", async () => {
        await writeGraphs({
            "bp-title": blueprint("bp-title", "Title Screen", BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS),
            "bp-ending": blueprint("bp-ending", "Ending", BLUEPRINT_NODE_TYPE_GAME_EXPORT_PROGRESS),
        });

        const findings = await collectProgressCarryFindings({ projectPath: tempDir, platforms: ["web"] });

        expect(findings).toHaveLength(1);
        expect(findings[0].detail?.blueprints).toBe("Title Screen, Ending");
    });

    it("says nothing when no target refuses", async () => {
        await writeGraphs({
            "bp-title": blueprint("bp-title", "Title Screen", BLUEPRINT_NODE_TYPE_GAME_IMPORT_PROGRESS),
        });

        const findings = await collectProgressCarryFindings({
            projectPath: tempDir,
            platforms: ["windows", "macos", "linux"],
        });

        expect(findings).toEqual([]);
    });

    it("says nothing when the project carries no progress", async () => {
        await writeGraphs({
            "bp-title": blueprint("bp-title", "Title Screen", "blueprint.game.next"),
        });

        const findings = await collectProgressCarryFindings({ projectPath: tempDir, platforms: ["web"] });

        expect(findings).toEqual([]);
    });

    it("stays quiet on a project with no graphs document at all", async () => {
        const findings = await collectProgressCarryFindings({ projectPath: tempDir, platforms: ["web"] });

        expect(findings).toEqual([]);
    });
});
