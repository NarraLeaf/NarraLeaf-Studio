// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import { useLiveTextStyles } from "./useLiveTextStyles";

// The project's typefaces are a workspace service; nothing here is about fonts.
vi.mock("@/lib/workspace/hooks/useEditorFontFamily", () => ({
    useEditorFontFamily: () => ({ cssFamily: null, loading: false, error: null }),
}));

/**
 * The colour a live dialogue or NVL line hands the engine's typewriter.
 *
 * The engine writes it straight into each word's CSS, so it has to be a colour already: a brand link
 * passed through as stored is dropped by the browser, and the words then wear whatever colour the
 * page around the stage has - near-black under Studio's light theme, which made the line vanish from
 * the story preview's dark dialogue box.
 */
function sentence(color: string, type = "nl.dialog.sentence"): UIElement {
    return {
        id: "sentence",
        type,
        name: "Sentence",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 800, height: 200, opacity: 1, visible: true },
        props: { text: "Sample words", color },
    } as UIElement;
}

function renderColour(element: UIElement): { read: () => string | undefined } {
    let latest: string | undefined;
    function Probe({ el }: { el: UIElement }) {
        latest = useLiveTextStyles({ element: el }).textAppearanceProps.defaultColor as string;
        return null;
    }
    render(<Probe el={element} />);
    return { read: () => latest };
}

describe("useLiveTextStyles", () => {
    afterEach(() => {
        cleanup();
        setActiveBrandPalette(BUILTIN_BRAND_COLORS);
    });

    it("hands the engine the colour a brand link resolves to, not the link", () => {
        expect(renderColour(sentence("nlbrand:text.primary")).read()).toBe("#F2F4F7");
    });

    it("does the same for an NVL line", () => {
        expect(renderColour(sentence("nlbrand:primary", "nl.nvl.texts")).read()).toBe("#40A8C4");
    });

    it("passes an ordinary colour through, and an unreadable one as the canvas's white", () => {
        expect(renderColour(sentence("#123456")).read()).toBe("#123456");
        cleanup();
        expect(renderColour(sentence("nlbrand:no.such.entry")).read()).toBe("#FFFFFF");
    });

    it("follows a palette edit without anything else re-rendering the line", () => {
        const probe = renderColour(sentence("nlbrand:primary"));
        expect(probe.read()).toBe("#40A8C4");
        act(() => {
            setActiveBrandPalette(
                BUILTIN_BRAND_COLORS.map(entry => (entry.id === "primary" ? { ...entry, value: "#C0FFEE" } : entry)),
            );
        });
        expect(probe.read()).toBe("#C0FFEE");
    });
});
