import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { FileEntry } from "@shared/utils/fs";
import {
    buildProjectScriptListing,
    scriptBindingsByRef,
    walkProjectScripts,
} from "./projectScripts";

function file(fileName: string): FileEntry {
    const dot = fileName.lastIndexOf(".");
    return {
        type: "file",
        fileName,
        name: dot > 0 ? fileName.slice(0, dot) : fileName,
        ext: dot > 0 ? fileName.slice(dot + 1) : null,
    };
}

function directory(fileName: string): FileEntry {
    return { type: "directory", fileName, name: fileName, ext: null };
}

function reader(tree: Record<string, FileEntry[]>) {
    return async (relativePath: string) => tree[relativePath] ?? null;
}

describe("walking the scripts folder", () => {
    it("finds sources at any depth and sorts them", async () => {
        const found = await walkProjectScripts(
            reader({
                scripts: [file("title.ts"), directory("menus"), file("README.md")],
                "scripts/menus": [file("pause.js"), file("options.ts")],
            }),
        );
        expect(found).toEqual(["scripts/menus/options.ts", "scripts/menus/pause.js", "scripts/title.ts"]);
    });

    it("does not descend into the two reserved names", async () => {
        const visited: string[] = [];
        const tree: Record<string, FileEntry[]> = {
            scripts: [directory("node_modules"), directory(".narraleaf"), file("a.ts")],
            // Present on purpose: reaching either of these is the failure.
            "scripts/node_modules": [file("index.ts")],
            "scripts/.narraleaf": [file("script.d.ts")],
        };
        const found = await walkProjectScripts(async relativePath => {
            visited.push(relativePath);
            return tree[relativePath] ?? null;
        });
        expect(found).toEqual(["scripts/a.ts"]);
        expect(visited).toEqual(["scripts"]);
    });

    it("answers with nothing when the folder is not there", async () => {
        expect(await walkProjectScripts(reader({}))).toEqual([]);
    });
});

describe("joining files with the blueprints that run them", () => {
    const document = {
        blueprints: {
            "bp-1": {
                id: "bp-1",
                name: "Start button",
                owner: { kind: "widgetMain", surfaceId: "s1", elementId: "e1" },
                program: { kind: "scriptModule", scriptRef: "scripts/title.ts" },
            },
            "bp-2": {
                id: "bp-2",
                name: "Quit button",
                owner: { kind: "widgetMain", surfaceId: "s1", elementId: "e2" },
                program: { kind: "scriptModule", scriptRef: "scripts/title.ts" },
            },
            "bp-graph": {
                id: "bp-graph",
                name: "A graph",
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                program: { kind: "graph", graphs: { eventIds: [], events: {}, functionIds: [], functions: {} } },
            },
            "bp-dangling": {
                id: "bp-dangling",
                name: "Renamed away",
                owner: { kind: "surfaceMain", surfaceId: "s2" },
                program: { kind: "scriptModule", scriptRef: "scripts/gone.ts" },
            },
        },
    } as unknown as BlueprintDocument;

    it("groups every blueprint that names one file", () => {
        const bindings = scriptBindingsByRef(document);
        expect(bindings.get("scripts/title.ts")?.map(binding => binding.name)).toEqual([
            "Start button",
            "Quit button",
        ]);
        expect(bindings.has("scripts/graph.ts")).toBe(false);
    });

    it("keeps a file nothing runs, and a reference to a file that is gone", () => {
        const listing = buildProjectScriptListing(
            ["scripts/title.ts", "scripts/helpers.ts"],
            scriptBindingsByRef(document),
        );
        expect(listing.map(entry => [entry.scriptRef, entry.exists, entry.boundTo.length])).toEqual([
            // A blueprint names it and it is not on disk - the state that used to show as
            // "This file is missing." with no way to see it from the other side.
            ["scripts/gone.ts", false, 1],
            // Nothing runs it; it is still the author's file and still in the folder.
            ["scripts/helpers.ts", true, 0],
            ["scripts/title.ts", true, 2],
        ]);
    });

    it("names the file rather than the path in the row's own label", () => {
        const listing = buildProjectScriptListing(["scripts/menus/pause.ts"], new Map());
        expect(listing[0]?.fileName).toBe("pause.ts");
    });
});
