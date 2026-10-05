import { describe, expect, it } from "vitest";
import { installWindowTag, readWindowTag, tagTitle, type TaggableWindow } from "./windowTag";

class FakeWindow implements TaggableWindow {
    public title = "Electron";
    public destroyed = false;
    private titleListeners: Array<() => void> = [];

    setTitle(title: string): void {
        this.title = title;
    }

    getTitle(): string {
        return this.title;
    }

    isDestroyed(): boolean {
        return this.destroyed;
    }

    on(_event: "page-title-updated", listener: () => void): this {
        this.titleListeners.push(listener);
        return this;
    }

    /** What Chromium does with a document title: tell the listeners, then apply it unless one prevented it. */
    raiseDocumentTitle(title: string, prevented: boolean): void {
        this.titleListeners.forEach(listener => listener());
        if (!prevented) {
            this.title = title;
        }
    }
}

function setUp(tag: string | null) {
    let created: ((event: unknown, window: TaggableWindow) => void) | null = null;
    const deferred: Array<() => void> = [];
    installWindowTag(
        { on: (_event, listener) => { created = listener; } },
        tag,
        fn => deferred.push(fn),
    );
    const open = () => {
        const window = new FakeWindow();
        created?.(null, window);
        return window;
    };
    const flush = () => deferred.splice(0).forEach(fn => fn());
    return { open, flush, installed: () => created !== null };
}

describe("readWindowTag", () => {
    it("is null when the variable is unset or blank", () => {
        expect(readWindowTag({})).toBeNull();
        expect(readWindowTag({ NLS_WINDOW_TAG: "   " })).toBeNull();
    });

    it("folds line breaks and runs of whitespace into one line", () => {
        expect(readWindowTag({ NLS_WINDOW_TAG: "  游戏窗口\n抖动\t修复 " })).toBe("游戏窗口 抖动 修复");
    });

    it("shortens a tag that would push the real title out of sight", () => {
        const tag = readWindowTag({ NLS_WINDOW_TAG: "x".repeat(200) })!;
        expect(tag.length).toBe(48);
        expect(tag.endsWith("…")).toBe(true);
    });
});

describe("tagTitle", () => {
    it("puts the tag in front once", () => {
        const once = tagTitle("Workspace - NarraLeaf Studio", "jitter");
        expect(once).toBe("[jitter] Workspace - NarraLeaf Studio");
        expect(tagTitle(once, "jitter")).toBe(once);
    });
});

describe("installWindowTag", () => {
    it("installs nothing without a tag", () => {
        expect(setUp(null).installed()).toBe(false);
    });

    it("tags a window as it is created and every title main sets afterwards", () => {
        const { open } = setUp("jitter");
        const window = open();
        expect(window.getTitle()).toBe("[jitter] Electron");
        window.setTitle("Workspace - NarraLeaf Studio");
        expect(window.getTitle()).toBe("[jitter] Workspace - NarraLeaf Studio");
    });

    it("tags the document title Chromium raises to the window", () => {
        const { open, flush } = setUp("jitter");
        const window = open();
        window.raiseDocumentTitle("NarraLeaf - workspace", false);
        flush();
        expect(window.getTitle()).toBe("[jitter] NarraLeaf - workspace");
    });

    it("leaves a window that refuses the document title with the title it chose", () => {
        const { open, flush } = setUp("jitter");
        const window = open();
        window.setTitle("My Game");
        window.raiseDocumentTitle("NarraLeaf Game", true);
        flush();
        expect(window.getTitle()).toBe("[jitter] My Game");
    });

    it("does not touch a window destroyed before the title came back", () => {
        const { open, flush } = setUp("jitter");
        const window = open();
        window.raiseDocumentTitle("Gone", false);
        window.destroyed = true;
        window.title = "Gone";
        flush();
        expect(window.title).toBe("Gone");
    });
});
