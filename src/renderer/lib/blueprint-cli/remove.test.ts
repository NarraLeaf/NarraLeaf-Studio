/**
 * `blueprint remove`: what it will take out of a project, and what it refuses to.
 *
 * Asserted against the shipped skeleton, read into memory and never written: it holds one of every
 * case - a widget's blueprint nothing refers to, a page blueprint whose variables two widgets read,
 * the game's own blueprint every screen calls into, and a value blueprint a prop is bound to.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { runCli } from "./cli";
import { planBlueprintRemoval, removeBlueprint, type RemovalElement } from "./remove";

const SKELETON_PROJECT = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");

function readSkeleton(): { document: BlueprintDocument; elements: Record<string, RemovalElement> } {
    const graphs = JSON.parse(fs.readFileSync(path.join(SKELETON_PROJECT, "editor/ui/uigraphs.json"), "utf8"));
    const ui = JSON.parse(fs.readFileSync(path.join(SKELETON_PROJECT, "editor/ui/uidoc.json"), "utf8"));
    return { document: graphs.blueprintDocument, elements: ui.elements };
}

function blueprintOwnedBy(document: BlueprintDocument, kind: string, name: string): Blueprint {
    const found = Object.values(document.blueprints).filter(item => item.owner.kind === kind && item.name === name);
    expect(found, `the skeleton has ${found.length} ${kind} blueprints named ${name}`).toHaveLength(1);
    return found[0]!;
}

function run(...argv: string[]): { code: number; out: string; err: string } {
    const out: string[] = [];
    const err: string[] = [];
    const code = runCli(argv, { out: text => out.push(text), err: text => err.push(text) });
    return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("planBlueprintRemoval", () => {
    it("takes a widget's blueprint nothing refers to, and the owner entry that pointed at it", () => {
        const { document, elements } = readSkeleton();
        const viewer = blueprintOwnedBy(document, "widgetMain", "Viewer");
        const plan = planBlueprintRemoval(document, viewer, elements);
        expect(plan.refusals).toEqual([]);
        expect(plan.ownerKeys).toHaveLength(1);

        removeBlueprint(document, viewer, plan);
        expect(document.blueprints[viewer.id]).toBeUndefined();
        expect(Object.values(document.ownerRecords).some(record => record.blueprintId === viewer.id)).toBe(false);
    });

    it("refuses a page's blueprint, and names every blueprint still reading its variables", () => {
        const { document, elements } = readSkeleton();
        const page = blueprintOwnedBy(document, "surfaceMain", "Extra");
        const plan = planBlueprintRemoval(document, page, elements);
        expect(plan.refusals.some(reason => reason.includes("surfaceMain"))).toBe(true);
        expect(plan.refusals.some(reason => reason.startsWith("\"CG grid\" still names it"))).toBe(true);
        expect(plan.refusals.some(reason => reason.startsWith("\"Viewer\" still names it"))).toBe(true);
    });

    it("refuses the game's own blueprint", () => {
        const { document, elements } = readSkeleton();
        const global = blueprintOwnedBy(document, "globalMain", "Global");
        expect(planBlueprintRemoval(document, global, elements).refusals[0]).toContain("globalMain");
    });

    it("refuses a value blueprint while a prop is still bound to it", () => {
        const { document, elements } = readSkeleton();
        const nametag = blueprintOwnedBy(document, "widgetValue", "Nametag");
        const plan = planBlueprintRemoval(document, nametag, elements);
        expect(plan.refusals).toHaveLength(1);
        expect(plan.refusals[0]).toContain("binds text to it");
    });
});

describe("blueprint remove", () => {
    it("names a blueprint exactly, and lists the candidates when a name is shared", () => {
        const result = run("remove", "--blueprint", "Extra", "--project", SKELETON_PROJECT);
        expect(result.code).toBe(2);
        expect(result.err).toContain("Name one by its id");
    });

    it("writes nothing without --write", () => {
        const before = fs.readFileSync(path.join(SKELETON_PROJECT, "editor/ui/uigraphs.json"), "utf8");
        const { document } = readSkeleton();
        const viewer = blueprintOwnedBy(document, "widgetMain", "Viewer");
        const result = run("remove", "--blueprint", viewer.id, "--project", SKELETON_PROJECT);
        expect(result.code).toBe(0);
        expect(result.out).toContain("Would remove \"Viewer\"");
        expect(fs.readFileSync(path.join(SKELETON_PROJECT, "editor/ui/uigraphs.json"), "utf8")).toBe(before);
    });

    it("stops on a refusal with the reasons", () => {
        const { document } = readSkeleton();
        const page = blueprintOwnedBy(document, "surfaceMain", "Extra");
        const result = run("remove", "--blueprint", page.id, "--project", SKELETON_PROJECT, "--write");
        expect(result.code).toBe(1);
        expect(result.err).toContain("blueprint.remove_refused");
        expect(result.err).toContain("Nothing was written.");
    });
});
