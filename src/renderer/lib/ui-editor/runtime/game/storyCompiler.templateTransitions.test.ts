/**
 * Every transition the shipped skeleton template stores still names an engine transition by the time
 * the compiler sees it.
 *
 * Two things stand between the file on disk and the compiler, and each of them has silently eaten a
 * transition: the migration ladder rewrites refs, and the compiler's `createTransition` answers a
 * `kind` it does not know with a warning and a cut. A row that loses its `kind` in the first passes
 * the second's type check and lands in that warning, so the template it ships with is the case worth
 * pinning - it is what every author sees on the first run of a new project.
 *
 * Read off the shipped files rather than restated here, because restating them is exactly the step
 * that would keep passing after the template moved to a kind nothing compiles.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Transition } from "narraleaf-react";
import type { StoryBlock, StoryDocument, StoryTransitionRef } from "@shared/types/story";
import { migrateStoryDocumentToLatest } from "@shared/story/migrateStoryDocument";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";

const SKELETON_STORIES = path.join(process.cwd(), "resources/templates/skeleton/content/editor/story/stories");

/** The diagnostic `createTransition`'s `default:` arm emits - the one this file exists to keep empty. */
const UNSUPPORTED = /is not supported by public NLR imports/;

function shippedStoryDocuments(): StoryDocument[] {
    return fs.readdirSync(SKELETON_STORIES, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(SKELETON_STORIES, entry.name, "storydoc.json"))
        .filter(file => fs.existsSync(file))
        .map(file => JSON.parse(fs.readFileSync(file, "utf-8")) as StoryDocument);
}

/**
 * Every transition ref the shipped documents store, at the version they store it.
 *
 * Filtered on `kind` because one payload's `transition` is a transform ref instead (the NVL panel's),
 * and that one is not this file's subject.
 */
function shippedTransitions(): { schemaVersion: number; transition: StoryTransitionRef }[] {
    const found: { schemaVersion: number; transition: StoryTransitionRef }[] = [];
    for (const document of shippedStoryDocuments()) {
        const walk = (node: unknown): void => {
            if (Array.isArray(node)) {
                node.forEach(walk);
                return;
            }
            if (!node || typeof node !== "object") {
                return;
            }
            const record = node as Record<string, unknown>;
            const transition = record.transition as Record<string, unknown> | undefined;
            if (transition && typeof transition === "object" && typeof transition.kind === "string") {
                found.push({ schemaVersion: document.schemaVersion, transition: transition as StoryTransitionRef });
            }
            Object.values(record).forEach(walk);
        };
        walk(document.scenes);
    }
    return found;
}

/** A one-row scene whose background change carries `transition`, stamped at `schemaVersion`. */
function backgroundDocument(schemaVersion: number, transition: StoryTransitionRef): StoryDocument {
    const bg: StoryBlock = {
        id: "bg",
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "setBackground", assetId: "asset-bg", transition },
    };
    return {
        schemaVersion,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": { id: "scene-1", name: "Scene 1", runtimeName: "Scene 1", rootBlockIds: ["bg"], blocks: { bg } },
        },
    } as StoryDocument;
}

/**
 * The engine transition a compiled scene carries, found by walking the recorded actions.
 *
 * Where NLR parks the instance inside an action is an engine implementation detail, so the walk looks
 * for the base class rather than a path an engine bump could move.
 */
function findTransition(compiled: Awaited<ReturnType<typeof compileStudioStoryToNlr>>): Transition | undefined {
    const seen = new Set<unknown>();
    const visit = (node: unknown, depth: number): Transition | undefined => {
        if (!node || typeof node !== "object" || depth > 24 || seen.has(node)) {
            return undefined;
        }
        seen.add(node);
        if (node instanceof Transition) {
            return node;
        }
        for (const value of Object.values(node as Record<string, unknown>)) {
            const found = visit(value, depth + 1);
            if (found) {
                return found;
            }
        }
        return undefined;
    };
    return visit(compiled.actionIdBindings.map(binding => binding.action), 0);
}

describe("the shipped skeleton template's transitions", () => {
    const transitions = shippedTransitions();

    it("stores some, so the sweep below is not vacuous", () => {
        expect(transitions.length).toBeGreaterThan(0);
        expect(transitions.every(entry => entry.transition.kind !== "none")).toBe(true);
    });

    it("each compiles to a real engine transition after the migration the read performs", async () => {
        for (const { schemaVersion, transition } of transitions) {
            const document = migrateStoryDocumentToLatest(backgroundDocument(schemaVersion, transition));
            const compiled = await compileStudioStoryToNlr({
                document,
                sceneId: "scene-1",
                resolveAssetUrl: async assetId => `nlr://${assetId}`,
            });

            const label = `kind=${transition.kind} at v${schemaVersion}`;
            expect(compiled.diagnostics.filter(entry => UNSUPPORTED.test(entry.message)), label).toEqual([]);
            expect(findTransition(compiled), label).toBeInstanceOf(Transition);
        }
    });

    it("compiles every shipped scene without an unsupported transition", async () => {
        for (const document of shippedStoryDocuments()) {
            const migrated = migrateStoryDocumentToLatest(document);
            for (const sceneId of Object.keys(migrated.scenes)) {
                const compiled = await compileStudioStoryToNlr({
                    document: migrated,
                    sceneId,
                    resolveAssetUrl: async assetId => `nlr://${assetId}`,
                });
                expect(
                    compiled.diagnostics.filter(entry => UNSUPPORTED.test(entry.message)),
                    `${migrated.name} / ${migrated.scenes[sceneId].name}`,
                ).toEqual([]);
            }
        }
    });
});
