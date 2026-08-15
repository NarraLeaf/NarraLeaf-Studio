import { describe, expect, it } from "vitest";
import { PROJECT_DOCUMENT_SPECS } from "@shared/documents/specs";
import {
    CHANGE_CATEGORY_BY_DOCUMENT_KIND,
    CHANGE_CATEGORY_LABEL_KEY,
    CHANGE_CATEGORY_ORDER,
    changeCategoryOf,
    type ChangeCategory,
} from "./changeCategory";

/**
 * The classification has to be TOTAL and it has to follow the project's own layout.
 *
 * Both halves have a way of failing quietly. A path nobody thought of falls to `other`, which is
 * correct but is also what a broken prefix looks like - so the cases below name real paths from
 * `ProjectNameConvention` rather than invented ones. And every registered spec is checked to land
 * somewhere, so a format that gains a spec without gaining a heading is a failure here rather than a
 * file filed under "Other" in front of the author.
 */

const entry = (path: string, documentKind?: string) =>
    ({ path, ...(documentKind ? { documentKind: documentKind as never } : {}) });

describe("changeCategoryOf", () => {
    it("files every document kind under a heading that exists", () => {
        for (const [kind, category] of Object.entries(CHANGE_CATEGORY_BY_DOCUMENT_KIND)) {
            expect(CHANGE_CATEGORY_ORDER, `${kind} is filed under an unknown heading`)
                .toContain(category);
        }
    });

    it("names every heading", () => {
        for (const category of CHANGE_CATEGORY_ORDER) {
            expect(CHANGE_CATEGORY_LABEL_KEY[category]).toBe(`documentDiff.category.${category}`);
        }
    });

    it("gives every registered spec a heading of its own accord", () => {
        // The kind is what the diff producer resolved through the registry, so a spec that exists is
        // a kind the comparison can carry. None of them may be unclassified.
        for (const spec of PROJECT_DOCUMENT_SPECS) {
            expect(CHANGE_CATEGORY_BY_DOCUMENT_KIND[spec.kind], `${spec.kind} has no heading`)
                .toBeDefined();
        }
    });

    it("prefers the document kind over the path", () => {
        // The cast store lives under `editor/services/`, which the path fallback reads as project
        // setup. The kind is the better answer and has to win.
        expect(changeCategoryOf(entry("editor/services/character.json", "characters"))).toBe("characters");
        expect(changeCategoryOf(entry("editor/services/character.json"))).toBe("settings");
    });

    const paths: readonly (readonly [string, ChangeCategory])[] = [
        ["editor/story/index.json", "story"],
        ["editor/story/stories/s-1/storydoc.json", "story"],
        ["editor/story/animations/a-1.json", "story"],
        ["editor/variables.json", "story"],
        ["editor/ui/uidoc.json", "interface"],
        ["editor/ui/uigraphs.json", "interface"],
        ["editor/localization/en.json", "localization"],
        ["editor/localization/keys.json", "localization"],
        ["editor/voice/en.json", "audio"],
        ["editor/audio-tracks.json", "audio"],
        ["editor/brand.json", "settings"],
        // Not claimed by any of the entries above, so it takes the `editor/` fallback.
        ["editor/cache/media/support.json", "settings"],
        ["assets/assets.metadata.image.json", "assets"],
        ["assets/content/ab/cd/ef01", "assets"],
        ["resources/icons/derived/icon.png", "assets"],
        ["project.json", "settings"],
        ["scripts/build.js", "other"],
        ["runtimes/puppet/live2d/index.js", "other"],
        [".nlstudio/editor.json", "other"],
        ["README.md", "other"],
    ];

    for (const [path, category] of paths) {
        it(`files ${path} under ${category}`, () => {
            expect(changeCategoryOf(entry(path))).toBe(category);
        });
    }

    it("reads a host path the same as a project path", () => {
        // A caller may hand over Windows separators; a backslash must not decide what a file is.
        expect(changeCategoryOf(entry("editor\\story\\index.json"))).toBe("story");
    });

    it("answers for a path it has never heard of rather than leaving it out", () => {
        expect(changeCategoryOf(entry("something/nobody/declared.bin"))).toBe("other");
        expect(changeCategoryOf(entry(""))).toBe("other");
    });

    it("does not let a longer name match a shorter directory", () => {
        // `editor-notes/` is not inside `editor/`, and a prefix test without the separator would say
        // it was - which would file a stray folder under project setup.
        expect(changeCategoryOf(entry("editor-notes/todo.md"))).toBe("other");
    });
});
