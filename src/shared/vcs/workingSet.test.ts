import { describe, expect, it } from "vitest";
import { ATOMIC_WRITE_TEMP_PATTERN, ATOMIC_WRITE_TEMP_SUFFIX } from "@shared/utils/atomicWriteTemp";
import {
    isVersioned,
    renderWorkingSetIgnoreFile,
    workingSetIgnorePatterns,
} from "./workingSet";

/**
 * The exclusion policy, checked in both of the languages it is written in.
 *
 * `isVersioned` is what Studio reasons with; the glob patterns are what the backend
 * enforces. Nothing in the type system connects them, so the interesting assertions
 * here are the ones that hold one against the other. A drift between the two is not
 * a cosmetic bug - it means Studio shows a file as protected while every commit
 * quietly leaves it out.
 *
 * The glob semantics these mirror were measured against Lore v0.8.5, not inferred
 * from gitignore: a single-segment pattern matches at any depth, a leading `/`
 * anchors it to the root, and a multi-segment pattern is anchored already.
 */

describe("working set policy", () => {
    it("versions project content, including files that were generated", () => {
        expect(isVersioned("project.json")).toBe(true);
        expect(isVersioned("editor/story/stories/abc/storydoc.json")).toBe(true);
        expect(isVersioned("assets/content/ab/cd/sprite.png")).toBe(true);
        expect(isVersioned("editor/localization/en.json")).toBe(true);
        // Baked from the author's master image, but they ship inside the package and
        // the bake never rewrites an unchanged file. Content, not cache.
        expect(isVersioned("resources/icons/derived/icon.png")).toBe(true);
        expect(isVersioned("resources/icons/source/master.png")).toBe(true);
    });

    it("excludes caches, build output and the repository itself", () => {
        expect(isVersioned(".lore/config.toml")).toBe(false);
        expect(isVersioned(".nlstudio/plugins/plugin.js")).toBe(false);
        expect(isVersioned("editor/cache/thumbnail/ab/cd/thumb.png")).toBe(false);
        expect(isVersioned("editor/assets/remote/ab/cd/blob.bin")).toBe(false);
        expect(isVersioned("dist/out.js")).toBe(false);
        expect(isVersioned("node_modules/pkg/index.js")).toBe(false);
        expect(isVersioned(".git/HEAD")).toBe(false);
        expect(isVersioned(".DS_Store")).toBe(false);
        expect(isVersioned("Thumbs.db")).toBe(false);
        // The directory itself, not only what is under it.
        expect(isVersioned("dist")).toBe(false);
        expect(isVersioned("editor/cache")).toBe(false);
    });

    it("excludes the atomic writer's scratch files, using the writer's own constant", () => {
        // A scratch file that reaches a commit is a half-written document in
        // permanent history. The suffix is imported rather than spelled out because
        // the two definitions drifting apart is the only way that happens.
        expect(isVersioned(`editor/story/index.json${ATOMIC_WRITE_TEMP_SUFFIX}`)).toBe(false);
        expect(isVersioned(`deep/nested/doc${ATOMIC_WRITE_TEMP_SUFFIX}`)).toBe(false);
        expect(workingSetIgnorePatterns()).toContain(`*${ATOMIC_WRITE_TEMP_SUFFIX}`);
        expect(ATOMIC_WRITE_TEMP_PATTERN.test(`x${ATOMIC_WRITE_TEMP_SUFFIX}`)).toBe(true);
    });

    it("anchors the words an author could reuse, and not the ones they cannot", () => {
        // `dist` and `cache` are ordinary words. An asset folder called `dist` is a
        // plausible thing for someone to make, and excluding it at every depth would
        // drop their work with no message anywhere.
        expect(isVersioned("assets/content/dist/panel.png")).toBe(true);
        expect(isVersioned("editor/story/cache/notes.json")).toBe(true);

        // These names are owned by a tool or the OS and are never content, so depth
        // is irrelevant - a `.git` checkout dropped inside `assets/` is still not
        // this project's history.
        expect(isVersioned("assets/vendor/.git/HEAD")).toBe(false);
        expect(isVersioned("assets/screenshots/.DS_Store")).toBe(false);
        expect(isVersioned("nested/project/.nlstudio/editor.json")).toBe(false);
        // A dependency tree is one of those names, and this is the path that made it one: the
        // author's own `npm install` for their scripts lands here, not at the project root.
        expect(isVersioned("scripts/node_modules/pkg/index.js")).toBe(false);
        expect(isVersioned("node_modules/pkg/index.js")).toBe(false);
    });

    it("versions the author's scripts, and not what is generated or installed beside them", () => {
        // The point of the directory: these are the author's files, and losing them to an
        // exclusion aimed at their dependencies would be the worst outcome here.
        expect(isVersioned("scripts/title.ts")).toBe(true);
        expect(isVersioned("scripts/menus/pause.js")).toBe(true);
        expect(isVersioned("scripts/package.json")).toBe(true);
        // Generated, and rewritten whenever a name it mentions changes.
        expect(isVersioned("scripts/.narraleaf/project.d.ts")).toBe(false);
        // Generated too, but versioned on purpose: it is written once, it barely changes, and a
        // clone that has not been opened in Studio yet still resolves its types with it.
        expect(isVersioned("scripts/tsconfig.json")).toBe(true);
    });

    it("reads either path separator the same way", () => {
        expect(isVersioned("editor\\story\\index.json")).toBe(true);
        expect(isVersioned("editor\\cache\\thumb.png")).toBe(false);
        expect(isVersioned("./project.json")).toBe(true);
    });

    it("answers no for paths that are not in the working set at all", () => {
        expect(isVersioned("")).toBe(false);
        expect(isVersioned("../outside.txt")).toBe(false);
        expect(isVersioned("editor/../../outside.txt")).toBe(false);
    });

    it("emits a pattern for every rule the predicate applies", () => {
        const patterns = workingSetIgnorePatterns();
        // Anchored rules keep their leading slash; unanchored ones must not have one,
        // because that is precisely what decides whether they match at depth.
        expect(patterns).toEqual([
            "/dist/",
            "/editor/cache/",
            "/editor/assets/remote/",
            "/scripts/.narraleaf/",
            ".lore",
            ".nlstudio",
            ".git",
            ".DS_Store",
            "Thumbs.db",
            "node_modules",
            `*${ATOMIC_WRITE_TEMP_SUFFIX}`,
        ]);

        for (const pattern of patterns) {
            const anchored = pattern.startsWith("/");
            const name = pattern.replace(/^\//, "").replace(/\/$/, "");
            if (pattern.startsWith("*")) continue;
            expect(isVersioned(name), `${pattern} must exclude its own path`).toBe(false);
            // The predicate has to agree with the anchoring, in both directions: an
            // anchored rule leaves the same name alone at depth, an unanchored one
            // does not.
            expect(isVersioned(`sub/${name}`), `${pattern} at depth`).toBe(anchored);
        }
    });

    it("renders an ignore file whose comment lines cannot become rules", () => {
        const rendered = renderWorkingSetIgnoreFile();
        for (const line of rendered.split("\n")) {
            if (line === "" || line.startsWith("#")) continue;
            expect(workingSetIgnorePatterns()).toContain(line);
        }
        expect(rendered.endsWith("\n")).toBe(true);
    });
});
