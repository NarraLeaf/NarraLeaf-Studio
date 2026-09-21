// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { escapeLeavesSubPage } from "./ProjectPanel";

/**
 * Escape on a project sub-page goes back to the overview - but only when the key was the page's.
 * Pressed in a field it abandons that field's edit and nothing else; pressed somewhere else in the
 * window it is not this panel's at all.
 */
describe("escapeLeavesSubPage", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    function mount() {
        document.body.innerHTML = `
            <div id="panel">
                <button id="back">Back</button>
                <input id="name" type="text" />
                <input id="count" type="number" />
                <textarea id="description"></textarea>
                <select id="mode"><option>a</option></select>
                <input id="toggle" type="checkbox" />
                <div id="row" tabindex="0"></div>
            </div>
            <div id="elsewhere" tabindex="0"><input id="other-field" type="text" /></div>
            <div role="dialog" id="dialog"><button id="dialog-button">OK</button></div>
        `;
        const byId = (id: string) => document.getElementById(id)!;
        return { panel: byId("panel"), byId };
    }

    it("leaves the page when the key was pressed on the page itself, or with nothing focused", () => {
        const { panel, byId } = mount();
        expect(escapeLeavesSubPage(byId("back"), panel)).toBe(true);
        expect(escapeLeavesSubPage(byId("row"), panel)).toBe(true);
        expect(escapeLeavesSubPage(byId("toggle"), panel)).toBe(true);
        expect(escapeLeavesSubPage(document.body, panel)).toBe(true);
    });

    it("leaves the key to a field, whose edit it abandons", () => {
        const { panel, byId } = mount();
        for (const id of ["name", "count", "description", "mode"]) {
            expect(escapeLeavesSubPage(byId(id), panel), id).toBe(false);
        }
    });

    it("ignores a key pressed anywhere outside the panel", () => {
        const { panel, byId } = mount();
        expect(escapeLeavesSubPage(byId("elsewhere"), panel)).toBe(false);
        expect(escapeLeavesSubPage(byId("dialog-button"), panel)).toBe(false);
    });

    it("does nothing before the panel is mounted", () => {
        expect(escapeLeavesSubPage(document.body, null)).toBe(false);
    });
});
