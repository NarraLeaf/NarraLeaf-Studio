/**
 * What the CLI can see of a project's interface document.
 *
 * One thing is defended, and it is the thing that was missing: **a component definition's elements
 * are part of the document.** They live in the component's own table rather than in the document's
 * flat one, so a reader that walks only surfaces finds none of them - and then every
 * `componentWidgetMain` blueprint has no element type to check its event heads against, and every
 * head on it is refused as out of scope for a widget nobody could identify. The failure reads as
 * "you may not put a Mouse Click here", which is not true and gives no hint of what is wrong.
 *
 * Asserted against the shipped skeleton rather than a fixture: the skeleton is the document every
 * new project starts from, and a component table it declares is exactly what an author reaches for
 * first.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    elementTypeResolver,
    readUiDocumentTargets,
    resolveBlueprintFile,
    SCRATCH_DIR_NAME,
    scratchFileNameFor,
    widgetElementResolver,
    widgetElementTypeResolver,
} from "./project";

const SKELETON_PROJECT = path.resolve(__dirname, "../../../../resources/templates/skeleton/content");

describe("readUiDocumentTargets", () => {
    it("reads the skeleton's surfaces and its component definitions", () => {
        const targets = readUiDocumentTargets(SKELETON_PROJECT);

        expect(targets.surfaces.length).toBeGreaterThan(0);
        expect(targets.components.length).toBeGreaterThan(0);
        // Every component names a root, and that root is an element the walk reached.
        for (const component of targets.components) {
            expect(component.rootElementId).toBeTruthy();
            expect(targets.elements.some(element => element.id === component.rootElementId)).toBe(true);
        }
    });

    it("tags every element with the tree that owns it, and never with both", () => {
        const targets = readUiDocumentTargets(SKELETON_PROJECT);

        expect(targets.elements.length).toBeGreaterThan(0);
        for (const element of targets.elements) {
            expect(Boolean(element.surfaceId) !== Boolean(element.componentId)).toBe(true);
        }
        expect(targets.elements.some(element => element.componentId)).toBe(true);
    });

    it("puts component elements in the raw pool, which is what the validator reads", () => {
        const targets = readUiDocumentTargets(SKELETON_PROJECT);
        const owned = targets.elements.filter(element => element.componentId);

        for (const element of owned) {
            expect(targets.raw[element.id]?.type).toBe(element.type);
        }
    });

    it("answers with nothing for a directory that holds no document", () => {
        const targets = readUiDocumentTargets(path.join(SKELETON_PROJECT, "does-not-exist"));

        expect(targets).toEqual({ surfaces: [], components: [], elements: [], raw: {} });
    });
});

describe("the resolvers a component blueprint depends on", () => {
    const targets = readUiDocumentTargets(SKELETON_PROJECT);
    const componentElement = targets.elements.find(element => element.componentId);

    it("names the element type behind a componentWidgetMain owner", () => {
        expect(componentElement).toBeDefined();
        const resolve = widgetElementTypeResolver(targets);

        expect(resolve({
            kind: "componentWidgetMain",
            elementId: componentElement!.id,
        })).toBe(componentElement!.type);
    });

    it("hands back the element record without inventing a surface for it", () => {
        const resolve = widgetElementResolver(targets);
        const answer = resolve({ kind: "componentWidgetMain", elementId: componentElement!.id });

        expect(answer?.element).toBeDefined();
        // A definition is instantiated wherever somebody places it, so there is no one surface its
        // elements are on. Absent is the honest answer, and it is what stands the surface-scoped
        // checks down rather than running them against a surface picked at random.
        expect(answer?.surfaceId).toBeUndefined();
    });

    it("fills in the type of an element reference that points into a component", () => {
        const resolve = elementTypeResolver(targets);

        expect(resolve(componentElement!.id)).toBe(componentElement!.type);
    });
});

describe("where a .bp file goes", () => {
    const root = path.join(os.tmpdir(), "nls-blueprint-scratch-test");

    beforeEach(() => {
        process.env.NLS_BLUEPRINT_REPO_ROOT = root;
        fs.mkdirSync(root, { recursive: true });
    });

    afterEach(() => {
        delete process.env.NLS_BLUEPRINT_REPO_ROOT;
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("puts a bare filename in the scratch directory, and creates it", () => {
        const resolved = resolveBlueprintFile("quit.bp", { forWriting: true });
        expect(resolved).toBe(path.join(root, SCRATCH_DIR_NAME, "quit.bp"));
        expect(fs.existsSync(path.join(root, SCRATCH_DIR_NAME))).toBe(true);
    });

    it("leaves anything that looks like a path alone", () => {
        expect(resolveBlueprintFile("./quit.bp", { forWriting: true })).toBe(path.resolve("./quit.bp"));
        expect(resolveBlueprintFile("sub/quit.bp", { forWriting: false })).toBe(path.resolve("sub/quit.bp"));
    });

    it("reads a bare filename from the working directory when the scratch copy is not there", () => {
        const here = path.join(root, "here.bp");
        fs.writeFileSync(here, "", "utf8");
        const previous = process.cwd();
        process.chdir(root);
        try {
            expect(resolveBlueprintFile("here.bp", { forWriting: false })).toBe(here);
        } finally {
            process.chdir(previous);
        }
    });

    it("names the file after the blueprint when nobody named it", () => {
        expect(scratchFileNameFor("Quit confirm")).toBe("quit-confirm.bp");
        expect(scratchFileNameFor("  ")).toBe("blueprint.bp");
    });
});
