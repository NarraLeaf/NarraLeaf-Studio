// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installVirtualLayoutStub } from "@/lib/utils/virtualLayoutTestStub";
import type { LocalizationDocument } from "@shared/types/localization";
import type { StoryTranslationRow } from "@/lib/workspace/services/localization/localizationModel";
import { Services } from "@/lib/workspace/services/services";
// Imported statically, not from inside a test: this module's dependency graph is most of the
// workspace, and loading it lazily charged three seconds of import to the first `it` - which is a
// test that fails under load and passes on its own.
import { LocalizationEditorTab } from "./LocalizationEditorTab";

/** How many lines the fake story carries. A commercial VN is this order of magnitude, or more. */
const LINE_COUNT = 5000;
/** How many scenes those lines are spread across, which is how many group headers the table has. */
const SCENE_COUNT = 10;

const updateUnit = vi.fn();

vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});

// The character and scene groups are extracted from a real story document, which this test has no
// business building: what is under test is the windowing, and a story's own lines are the rows that
// make the table long.
vi.mock("@/lib/workspace/services/localization/localizationModel", async () => {
    const actual = await vi.importActual<typeof import("@/lib/workspace/services/localization/localizationModel")>(
        "@/lib/workspace/services/localization/localizationModel",
    );
    return {
        ...actual,
        extractCharacterTranslationRows: () => [],
        extractSceneTranslationRows: () => [],
        extractUiTranslationRows: () => [],
        extractKeyTranslationRows: () => [],
    };
});

vi.mock("@/lib/ui-editor/hooks/useUIDocumentRevision", () => ({
    useUIDocumentRevision: () => 0,
}));

const document_: LocalizationDocument = { locale: "ja", units: {} } as LocalizationDocument;

function storyRow(index: number): StoryTranslationRow {
    const scene = Math.floor(index / (LINE_COUNT / SCENE_COUNT));
    return {
        unitId: `u-${index}`,
        storyId: "s-1",
        sceneId: `scene-${scene}`,
        sceneName: `Scene ${scene}`,
        blockId: `b-${index}` as StoryTranslationRow["blockId"],
        role: "narration",
        sourceText: `Line ${index}.`,
        interpolationCount: 0,
    };
}

const ROWS = Array.from({ length: LINE_COUNT }, (_, index) => storyRow(index));

const services = {
    [Services.Localization]: {
        extractRows: () => ROWS,
        getConfiguration: () => ({ locales: [{ code: "ja", displayName: "Japanese" }] }),
        loadDocument: () => Promise.resolve(document_),
        onDocumentChanged: () => () => undefined,
        getKeysIfLoaded: () => null,
        loadKeys: () => Promise.resolve(null),
        onKeysChanged: () => () => undefined,
        updateUnit,
        flushPendingChanges: () => Promise.resolve(),
    },
    [Services.Story]: {
        listStories: () => [{ id: "s-1", name: "Chapter One" }],
        getDefaultStoryId: () => "s-1",
        onLibraryChanged: () => () => undefined,
        loadStory: () => Promise.resolve(),
        getStoryDocument: () => ({}),
        onDocumentChanged: () => () => undefined,
    },
    [Services.Character]: {
        listCharacter: () => [],
        subscribe: () => () => undefined,
    },
    [Services.UI]: {},
    [Services.UIDocument]: { getDocument: () => null },
} as Record<string, unknown>;

vi.mock("../../context", () => ({
    useWorkspace: () => ({
        isInitialized: true,
        context: { services: { get: (key: string) => services[key] } },
    }),
}));

// The table is windowed, and a virtualiser reads a layout jsdom does not run. See the stub's note.
let restoreLayout: () => void = () => undefined;
beforeEach(() => {
    restoreLayout = installVirtualLayoutStub({ viewport: 720, row: 96, width: 900 });
});
afterEach(() => {
    cleanup();
    restoreLayout();
    updateUnit.mockReset();
});

async function renderTab() {
    let result!: ReturnType<typeof render>;
    await act(async () => {
        result = render(
            <LocalizationEditorTab payload={{ locale: "ja" }} active tabId="t-1" />,
        );
    });
    return result;
}

describe("LocalizationEditorTab on a long story", () => {
    it("draws a screenful of rows, not the story", async () => {
        await renderTab();

        const drawn = window.document.querySelectorAll("[data-index]").length;
        // A screenful at the estimated row height plus the overscan either side. What this rules out
        // is the shape the table had before: one row - and one textarea - per line in the project.
        expect(drawn).toBeGreaterThan(0);
        expect(drawn).toBeLessThan(60);
    });

    it("keeps every group header in the same index space as its rows", async () => {
        await renderTab();

        // Headers are items of the windowed list, not wrappers around it, so the first one is drawn
        // at index 0 and its rows follow it.
        const first = window.document.querySelector("[data-index='0']");
        expect(first?.textContent).toBe("Scene 0");
        expect(window.document.querySelector("[data-index='1']")?.textContent).toContain("Line 0.");
    });

    it("keeps the row being typed into mounted after it scrolls away", async () => {
        const { container } = await renderTab();
        const scroller = container.querySelector(".overflow-y-auto")!;
        const row = window.document.querySelector("[data-index='1']")!;
        const box = row.querySelector("textarea")!;

        await act(async () => {
            box.focus();
        });
        await act(async () => {
            // Far past the window the caret sits in; the row is thousands of lines above it now.
            scroller.scrollTop = 120000;
            scroller.dispatchEvent(new Event("scroll"));
        });

        expect(window.document.activeElement).toBe(box);
        expect(window.document.querySelector("[data-index='1']")).not.toBeNull();
        // Everything around it is gone, which is what makes the pin a pin rather than an accident.
        expect(window.document.querySelector("[data-index='2']")).toBeNull();
    });

    it("writes an edit through on the keystroke, so an unmounting row cannot lose it", async () => {
        await renderTab();

        const box = window.document.querySelector("textarea");
        expect(box).not.toBeNull();
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
            setter.call(box, "訳文");
            box!.dispatchEvent(new Event("input", { bubbles: true }));
        });

        expect(updateUnit).toHaveBeenCalledWith("ja", "u-0", "Line 0.", { target: "訳文" });
    });
});
