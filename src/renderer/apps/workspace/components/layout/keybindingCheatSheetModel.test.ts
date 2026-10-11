import { describe, expect, it } from "vitest";
import type { TranslationKey } from "@shared/i18n";
import { flattenCatalog } from "@shared/i18n/flatten";
import { en } from "@shared/i18n/catalog/en";
import {
    buildFocusedGroup,
    buildSheetGroups,
    chordInWords,
    compileSheetQuery,
    filterSheetGroups,
    FOCUSED_GROUP_KEY,
    OTHER_GROUP_KEY,
    withoutPinned,
    type RegisteredBinding,
    type SheetGroup,
} from "./keybindingCheatSheetModel";

const strings = flattenCatalog(en);

function t(key: TranslationKey, params?: Record<string, string>): string {
    const text = strings.get(key) ?? key;
    return text.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? `{${name}}`);
}

function sheet(options: {
    isMac?: boolean;
    overrides?: Record<string, string>;
    registered?: RegisteredBinding[];
} = {}): SheetGroup[] {
    const overrides = options.overrides ?? {};
    return buildSheetGroups({
        t,
        isMac: options.isMac ?? false,
        effectiveKey: binding => overrides[binding.catalogId ?? binding.id] ?? binding.key,
        registered: options.registered ?? [],
    });
}

function group(groups: readonly SheetGroup[], title: string): SheetGroup {
    const found = groups.find(candidate => candidate.title === title);
    expect(found, `no group titled ${title}`).toBeDefined();
    return found!;
}

function rowIds(found: SheetGroup | null | undefined): string[] {
    return found ? found.rows.map(row => row.id) : [];
}

describe("buildSheetGroups", () => {
    it("files a command's gestures beside its chord, and the gestures of its own under the same group", () => {
        const story = group(sheet(), "Story Editor");
        const edit = story.rows.find(row => row.id === "story.edit-active");
        expect(edit?.inputs).toEqual(["Enter", "Double-click a row"]);
        expect(rowIds(story)).toContain("fixed:story.row.drag-move");
        // The binding rows come first, then the gestures.
        expect(rowIds(story).indexOf("story.edit-active")).toBeLessThan(rowIds(story).indexOf("fixed:story.row.drag-move"));
    });

    it("draws the chord the author bound, not the default", () => {
        const general = group(sheet({ overrides: { "workspace-quick-open": "mod+alt+o" } }), "General");
        expect(general.rows.find(row => row.id === "workspace-quick-open")?.inputs).toEqual(["Ctrl+Alt+O"]);
    });

    it("lists a described registration the catalog does not know under Other, once", () => {
        const groups = sheet({
            registered: [
                { id: "plugin.a#1", catalogId: "plugin.a", key: "mod+k", description: "Plugin thing" },
                { id: "plugin.a#2", catalogId: "plugin.a", key: "mod+k", description: "Plugin thing" },
                { id: "plugin.silent", key: "mod+u" },
                { id: "story-scene-editor-1-find", catalogId: "story.find", key: "mod+f", description: "Find" },
            ],
        });
        const other = groups.find(candidate => candidate.key === OTHER_GROUP_KEY);
        expect(other?.rows.map(row => [row.id, row.name, row.inputs[0]])).toEqual([["plugin.a", "Plugin thing", "Ctrl+K"]]);
    });
});

describe("buildFocusedGroup", () => {
    it("pins what is live in the story editor, with the editor's gestures, under the editor's name", () => {
        const groups = sheet();
        const focused = buildFocusedGroup(groups, ["story.find", "story.duplicate", "editor.close-tab", "run:dev-mode"], t);
        expect(focused?.key).toBe(FOCUSED_GROUP_KEY);
        expect(focused?.title).toBe("Focused: Story Editor");
        const ids = rowIds(focused);
        expect(ids).toContain("story.find");
        expect(ids).toContain("story.duplicate");
        // Not live there, so not pinned, though it is the same group.
        expect(ids).not.toContain("story.undo");
        // A gesture follows its group.
        expect(ids).toContain("fixed:story.row.drag-move");
        // Workspace-wide groups say nothing about where focus is.
        expect(ids).not.toContain("editor.close-tab");
        expect(ids).not.toContain("run:dev-mode");
        expect(ids).not.toContain("fixed:workspace.tab.keep-open");
        // Another editor's gestures stay in their own group.
        expect(ids).not.toContain("fixed:blueprint.pan");
    });

    it("offers the assets panel's gestures in the panel and the waveform's in the audio preview", () => {
        const groups = sheet();
        const panel = rowIds(buildFocusedGroup(groups, ["assets.rename", "assets.copy"], t));
        expect(panel).toContain("assets.copy");
        expect(panel).toContain("fixed:assets.toggle-select");
        expect(panel).not.toContain("fixed:assets.audio.scroll");
        expect(panel).not.toContain("fixed:assets.video.zoom");

        const audio = rowIds(buildFocusedGroup(groups, ["assets.audio.play-pause", "assets.audio.loop"], t));
        expect(audio).toContain("assets.audio.loop");
        expect(audio).toContain("fixed:assets.audio.scroll");
        expect(audio).not.toContain("fixed:assets.toggle-select");
        expect(audio).not.toContain("fixed:assets.video.zoom");
    });

    it("names the group with the most live bindings", () => {
        const focused = buildFocusedGroup(sheet(), ["blueprint.copy", "blueprint.paste", "story.find"], t);
        expect(focused?.title).toBe("Focused: Blueprint Editor");
        expect(rowIds(focused)).toEqual(expect.arrayContaining(["story.find", "blueprint.copy", "blueprint.paste"]));
    });

    it("pins nothing where focus has no keys of its own", () => {
        expect(buildFocusedGroup(sheet(), [], t)).toBeNull();
        expect(buildFocusedGroup(sheet(), ["run:dev-mode", "workspace.undo", "editor.close-tab"], t)).toBeNull();
    });
});

describe("withoutPinned", () => {
    it("lists a pinned row once, at the top, and drops a group it empties", () => {
        const groups = sheet();
        const storyIds = rowIds(group(groups, "Story Editor")).filter(id => !id.startsWith("fixed:"));
        const pinned = buildFocusedGroup(groups, storyIds, t);
        const rest = withoutPinned(groups, pinned);
        expect(rest.find(candidate => candidate.title === "Story Editor")).toBeUndefined();
        expect(rest.map(candidate => candidate.title)).toEqual(
            groups.filter(candidate => candidate.title !== "Story Editor").map(candidate => candidate.title),
        );
    });

    it("leaves the rest of a group that is only partly in focus", () => {
        const groups = sheet();
        const rest = withoutPinned(groups, buildFocusedGroup(groups, ["assets.rename", "assets.copy"], t));
        const assets = rowIds(group(rest, "Assets"));
        expect(assets).not.toContain("assets.copy");
        expect(assets).not.toContain("fixed:assets.toggle-select");
        expect(assets).toContain("assets.cut");
        expect(assets).toContain("fixed:assets.audio.scroll");
        expect(withoutPinned(groups, null)).toEqual(groups);
    });
});

describe("compileSheetQuery and filterSheetGroups", () => {
    it("keeps every group when there is no query", () => {
        const groups = sheet();
        expect(compileSheetQuery("   ")).toBeNull();
        expect(filterSheetGroups(groups, null)).toEqual(groups);
    });

    it("finds a command by its chord as drawn", () => {
        const found = filterSheetGroups(sheet(), compileSheetQuery("ctrl+shift+z"));
        expect(found.flatMap(rowIds)).toEqual(expect.arrayContaining(["story.redo", "blueprint.redo", "workspace.redo"]));
        expect(found.flatMap(rowIds)).not.toContain("story.undo");
    });

    it("finds a chord on macOS by the words for its glyphs", () => {
        const groups = sheet({ isMac: true });
        const undo = group(groups, "Blueprint Editor").rows.find(row => row.id === "blueprint.undo");
        expect(undo?.inputs).toEqual(["⌘Z"]);
        const ids = filterSheetGroups(groups, compileSheetQuery("cmd+z")).flatMap(rowIds);
        expect(ids).toEqual(expect.arrayContaining(["workspace.undo", "blueprint.undo"]));
        expect(ids).not.toContain("blueprint.redo");
    });

    it("finds a key by the name it is declared under when it is drawn as a glyph", () => {
        const ids = filterSheetGroups(sheet(), compileSheetQuery("arrowup")).flatMap(rowIds);
        expect(ids).toContain("story.move-selection-up");
        expect(ids).toContain("ui-editor.nudge-up");
    });

    it("lists a whole group by its title, and narrows it with a second term", () => {
        const all = group(sheet(), "Blueprint Editor").rows.length;
        const byTitle = filterSheetGroups(sheet(), compileSheetQuery("blueprint editor"));
        expect(byTitle.find(candidate => candidate.title === "Blueprint Editor")?.rows.length).toBe(all);

        const narrowed = filterSheetGroups(sheet(), compileSheetQuery("blueprint paste"));
        expect(narrowed.flatMap(rowIds)).toEqual(["blueprint.paste"]);
    });

    it("reads every term as literal text, without regard to case", () => {
        expect(filterSheetGroups(sheet(), compileSheetQuery("DUPLICATE")).flatMap(rowIds)).toContain("story.duplicate");
        expect(filterSheetGroups(sheet(), compileSheetQuery("(*"))).toEqual([]);
    });

    it("marks every term's hits, as one run where they touch or overlap", () => {
        expect(compileSheetQuery("ctrl z")!.marks.findRanges("Ctrl+Shift+Z")).toEqual([
            { start: 0, end: 4 },
            { start: 11, end: 12 },
        ]);
        expect(compileSheetQuery("shift +z")!.marks.findRanges("Ctrl+Shift+Z")).toEqual([{ start: 5, end: 12 }]);
        expect(compileSheetQuery("ctrl+s shift")!.marks.findRanges("Ctrl+Shift+Z")).toEqual([{ start: 0, end: 10 }]);
    });
});

describe("chordInWords", () => {
    it("is the chip itself off macOS, and words for the glyphs on it", () => {
        expect(chordInWords("mod+shift+z", false)).toBe("Ctrl+Shift+Z");
        expect(chordInWords("mod+shift+z", true)).toBe("Cmd+Shift+Z");
        expect(chordInWords("alt+arrowup", true)).toBe("Option+↑");
    });
});
