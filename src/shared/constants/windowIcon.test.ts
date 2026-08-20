import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WINDOW_ICONS, WINDOW_ICON_DEFAULT, WINDOW_ICON_IDS, resolveWindowIcon } from "./windowIcon";

describe("resolveWindowIcon", () => {
    it("returns the entry an id names", () => {
        expect(resolveWindowIcon("narra").id).toBe("narra");
        expect(resolveWindowIcon(WINDOW_ICON_DEFAULT).id).toBe(WINDOW_ICON_DEFAULT);
    });

    it("falls back to the default for an id nothing declares", () => {
        // A stored value can outlive the icon it names: a hand-edited global.json, or a profile
        // carried to a build where that icon was dropped.
        expect(resolveWindowIcon("gone").id).toBe(WINDOW_ICON_DEFAULT);
        expect(resolveWindowIcon(undefined).id).toBe(WINDOW_ICON_DEFAULT);
        expect(resolveWindowIcon(null).id).toBe(WINDOW_ICON_DEFAULT);
    });

    it("keeps the default first, so the fallback is also the shipped mark", () => {
        expect(WINDOW_ICONS[0].id).toBe(WINDOW_ICON_DEFAULT);
    });
});

describe("WINDOW_ICONS", () => {
    it("declares each id once", () => {
        expect(new Set(WINDOW_ICON_IDS).size).toBe(WINDOW_ICON_IDS.length);
    });

    it("ships every file it declares", () => {
        // Declaring a file that never made it into resources/ does not fail loudly - the icon just
        // silently falls back to the default one, on every machine, forever. This is the only
        // place that notices.
        const resourcesDir = path.resolve(__dirname, "../../../resources");
        const missing = WINDOW_ICONS.flatMap(icon =>
            [icon.ico, icon.png].filter(file => !fs.existsSync(path.join(resourcesDir, file))));

        expect(missing).toEqual([]);
    });
});
