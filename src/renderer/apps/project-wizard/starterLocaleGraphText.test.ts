/**
 * The words the starter template's blueprints show, in its Chinese and Japanese copies.
 *
 * Those copies are generated from the English one (`scripts/gen-skeleton-locale.mjs`), and
 * `skeletonContentLocale.test.ts` holds them to being exactly what the generator writes. That could
 * not see the generator looking in the wrong place: when a blueprint's graphs moved out from under
 * `program`, the generator went on reading the old field, found nothing there, and wrote every layer
 * name, function name and on-screen literal through untranslated - which is what it would then have
 * been compared against. A Chinese author opened sixty-five layers called `Layer 1`, a function
 * called `UI confirm cue`, and a Global blueprint that logged its welcome in English.
 *
 * So this asks a different question: of the places the generator says hold a word, is the word in
 * the shipped copy still the English one? And, separately, does its list of places include the ones
 * the blueprint model says a layer's name is kept in - read here through the document's own types,
 * so that a move of those fields breaks this file's compile rather than emptying the list.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_FN_CALL, BLUEPRINT_NODE_TYPE_FN_HEAD } from "@shared/types/blueprint/graph";

type Pointer = Array<string | number>;
type Slot = { pointer: Pointer; source: string };
type GraphFile = { blueprintDocument: BlueprintDocument };

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton");
const GENERATOR = path.join(process.cwd(), "scripts/gen-skeleton-locale.mjs");
const VARIANTS = ["content.zh", "content.ja"] as const;

/**
 * Words that are the same in every language the template ships in - a proper noun, a product name.
 * A slot holding one of these is not a word the translation forgot. Add to it only for that reason:
 * anything else belongs in the generator's tables, where the other two languages get their say.
 */
const SAME_IN_EVERY_LANGUAGE = new Set<string>([
    // The EXTRA screen's tab for event pictures. Chinese and Japanese players call them CG too.
    "CG",
]);

let listed: { file: string; slots: Slot[] } | undefined;

/** The generator's own list of the places a blueprint keeps a word, with the English each holds. */
function graphText(): { file: string; slots: Slot[] } {
    listed ??= JSON.parse(
        execFileSync(process.execPath, [GENERATOR, "--graph-text"], { encoding: "utf-8", stdio: "pipe" }),
    ) as { file: string; slots: Slot[] };
    return listed;
}

function readGraphs(variant: string): GraphFile {
    return JSON.parse(fs.readFileSync(path.join(TEMPLATE, variant, graphText().file), "utf-8")) as GraphFile;
}

function at(document: unknown, pointer: Pointer): unknown {
    return pointer.reduce<unknown>(
        (value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined),
        document,
    );
}

const spell = (pointer: Pointer): string => pointer.join(" / ");

describe("the starter template's blueprints in Chinese and Japanese", () => {
    it("are read for words where the blueprint model keeps them", () => {
        const { blueprintDocument } = readGraphs("content");
        const blueprintNames: string[] = [];
        const layerNames: string[] = [];
        const memberNames: string[] = [];
        for (const [blueprintId, blueprint] of Object.entries(blueprintDocument.blueprints)) {
            const base: Pointer = ["blueprintDocument", "blueprints", blueprintId];
            blueprintNames.push(spell([...base, "name"]));
            for (const collection of ["events", "functions"] as const) {
                for (const [layerId, layer] of Object.entries(blueprint.graphs[collection] ?? {})) {
                    if (layer.name) {
                        layerNames.push(spell([...base, "graphs", collection, layerId, "name"]));
                    }
                }
            }
            for (const [variableId, variable] of Object.entries(blueprint.members?.variables ?? {})) {
                if (variable.name) {
                    memberNames.push(spell([...base, "members", "variables", variableId, "name"]));
                }
            }
        }
        // Not vacuous: the template has a blueprint on every interactive element, and a named layer
        // in most of them.
        expect(blueprintNames.length).toBeGreaterThan(100);
        expect(layerNames.length).toBeGreaterThan(50);
        expect(memberNames.length).toBeGreaterThan(0);

        const listedPlaces = new Set(graphText().slots.map(slot => spell(slot.pointer)));
        const expected = [...blueprintNames, ...layerNames, ...memberNames];
        expect(expected.filter(place => !listedPlaces.has(place))).toEqual([]);
    });

    it.each(VARIANTS)("%s says each of those words in its own language", variant => {
        const document = readGraphs(variant);
        const english = graphText().slots.filter(slot => {
            const shipped = at(document, slot.pointer);
            if (typeof shipped !== "string" || shipped === "") {
                return true;
            }
            return shipped === slot.source && !SAME_IN_EVERY_LANGUAGE.has(slot.source);
        });
        expect(english.map(slot => `${spell(slot.pointer)}: ${JSON.stringify(slot.source)}`)).toEqual([]);
    });

    it.each(VARIANTS)("%s labels every Fn call with the name its head has there", variant => {
        // A call keeps a copy of its function's signature and the editor marks the call stale the
        // moment the copy and the head disagree, so a translated head with an English copy - or the
        // other way round - is a warning on every call in a project nobody has touched yet.
        const { blueprintDocument } = readGraphs(variant);
        const heads = new Map<string, unknown>();
        const calls: { fnRef: string; name: unknown }[] = [];
        for (const blueprint of Object.values(blueprintDocument.blueprints)) {
            for (const layer of Object.values(blueprint.graphs.events ?? {})) {
                for (const node of Object.values(layer.graph?.nodes ?? {})) {
                    if (node.type === BLUEPRINT_NODE_TYPE_FN_HEAD) {
                        heads.set(`fn:${blueprint.id}:${node.id}`, node.params?.name);
                    } else if (node.type === BLUEPRINT_NODE_TYPE_FN_CALL) {
                        const snapshot = node.params?.__fnSignatureSnapshot as { name?: unknown } | undefined;
                        calls.push({ fnRef: String(node.params?.fnRef), name: snapshot?.name });
                    }
                }
            }
        }
        expect(calls.length).toBeGreaterThan(0);
        const mismatched = calls
            .filter(call => heads.get(call.fnRef) !== call.name)
            .map(call => `${call.fnRef}: head ${JSON.stringify(heads.get(call.fnRef))}, call ${JSON.stringify(call.name)}`);
        expect(mismatched).toEqual([]);
    });
});
