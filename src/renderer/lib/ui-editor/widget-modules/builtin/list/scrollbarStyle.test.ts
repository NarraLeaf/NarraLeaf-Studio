/**
 * A scrollbar part's unset fill opacity: the faint per-part tints belong to the default white
 * colour fill, so an image or gradient the author chose draws at full strength.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { getListProps } from "./helpers";

function list(scrollbar: Record<string, unknown>): UIElement {
    return { id: "list", type: "nl.list", props: { scrollbar } } as unknown as UIElement;
}

const image = { mode: "cover", assetId: "track-art" };

describe("list scrollbar part opacity", () => {
    it("keeps the default tints for colour fills", () => {
        const { scrollbar } = getListProps(list({}));
        expect(scrollbar.trackStyle.fillOpacity).toBe(0.08);
        expect(scrollbar.thumbStyle.fillOpacity).toBe(0.34);
    });

    it("draws an image or gradient part at full strength when no opacity was written", () => {
        const { scrollbar } = getListProps(list({
            trackStyle: { fillType: "image", imageFill: image },
            thumbStyle: { fillType: "gradient" },
        }));
        expect(scrollbar.trackStyle.fillOpacity).toBe(1);
        expect(scrollbar.thumbStyle.fillOpacity).toBe(1);
    });

    it("honours an opacity the author wrote", () => {
        const { scrollbar } = getListProps(list({ trackStyle: { fillType: "image", imageFill: image, fillOpacity: 0.5 } }));
        expect(scrollbar.trackStyle.fillOpacity).toBe(0.5);
    });
});
