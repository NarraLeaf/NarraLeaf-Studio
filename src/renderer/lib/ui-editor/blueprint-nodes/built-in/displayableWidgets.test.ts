/**
 * The guard that keeps the Displayable family in step with the insert palette.
 *
 * The two lists drifted apart once already - the palette grew Video, Puppet, Text Input and the
 * four stage-slot widgets while the node family stayed at eight types - and the failure was silent
 * in the direction that matters: the editor offered the widget as a target and the graph threw when
 * it ran. This test is why adding a widget to the palette without teaching Displayable about it
 * cannot land quietly.
 */

import { describe, expect, it } from "vitest";
import { UI_DISPLAYABLE_WIDGET_TYPES } from "@shared/types/ui-editor/displayableWidgets";
import { DEFAULT_INSERT_PALETTE_CONFIG } from "@/lib/ui-editor/widget-modules/insertPalette";

describe("displayable widget coverage", () => {
    it("covers every widget the insert palette offers", () => {
        const covered = new Set<string>(UI_DISPLAYABLE_WIDGET_TYPES);
        const missing = DEFAULT_INSERT_PALETTE_CONFIG.map(entry => entry.type).filter(type => !covered.has(type));
        expect(missing).toEqual([]);
    });

    it("claims no widget the palette does not offer", () => {
        const insertable = new Set<string>(DEFAULT_INSERT_PALETTE_CONFIG.map(entry => entry.type));
        const extra = UI_DISPLAYABLE_WIDGET_TYPES.filter(type => !insertable.has(type));
        expect(extra).toEqual([]);
    });
});
