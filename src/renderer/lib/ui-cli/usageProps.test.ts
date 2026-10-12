import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { widgetKnownPropKeys } from "./catalog";
import { findUsages } from "./usage";

/**
 * `ui_usage` prints how the shipped skeleton uses a widget, as text to copy. Every prop it prints
 * has to be one the widget really has: an agent pasting a key the widget does not know gets it
 * refused by `ui_patch` ("has no prop") and kept-but-ignored by `ui_apply`, so a stale key in the
 * template teaches exactly the mistake the catalogue tools exist to prevent.
 *
 * Every copy of the template is checked - the base and each language variant - because each one is
 * what a project in that language is made from and searched by `ui_usage`.
 */

const SKELETON = path.resolve(__dirname, "../../../../resources/templates/skeleton");

function skeletonDocuments(): { name: string; document: UIDocument }[] {
    return fs.readdirSync(SKELETON)
        .filter(entry => entry === "content" || entry.startsWith("content."))
        .map(entry => path.join(SKELETON, entry, "editor", "ui", "uidoc.json"))
        .filter(file => fs.existsSync(file))
        .map(file => ({ name: path.relative(SKELETON, file), document: JSON.parse(fs.readFileSync(file, "utf8")) as UIDocument }));
}

describe("the skeleton's widget usages", () => {
    it("are found in every copy of the template", () => {
        expect(skeletonDocuments().map(item => item.name)).toContain(path.join("content", "editor", "ui", "uidoc.json"));
    });

    for (const { name, document } of skeletonDocuments()) {
        it(`set only props their widget has, in ${name}`, () => {
            const types = new Set([
                ...Object.values(document.elements).map(element => element.type),
                ...(document.components ?? []).flatMap(component => Object.values(component.elements).map(element => element.type)),
            ]);
            const stray: string[] = [];
            for (const type of types) {
                const known = widgetKnownPropKeys(type);
                if (!known || !type.startsWith("nl.")) {
                    continue;
                }
                for (const site of findUsages(document, type)) {
                    for (const key of Object.keys(site.element.props ?? {})) {
                        if (key !== "appearance" && !known.has(key)) {
                            stray.push(`${site.owner} / ${site.path}: ${type}.${key}`);
                        }
                    }
                }
            }
            expect(stray).toEqual([]);
        });
    }
});
