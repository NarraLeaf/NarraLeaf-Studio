import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WINDOW_ICONS, WINDOW_ICON_DEFAULT, WINDOW_ICON_IDS, resolveWindowIcon } from "./windowIcon";

describe("resolveWindowIcon", () => {
    it("returns the entry an id names", () => {
        expect(resolveWindowIcon("leaf").id).toBe("leaf");
        expect(resolveWindowIcon("leafWhite").id).toBe("leafWhite");
        expect(resolveWindowIcon(WINDOW_ICON_DEFAULT).id).toBe(WINDOW_ICON_DEFAULT);
    });

    it("falls back to the default for an id nothing declares", () => {
        // A stored value can outlive the icon it names: a hand-edited global.json, or a profile
        // carried to a build where that icon was dropped.
        expect(resolveWindowIcon("gone").id).toBe(WINDOW_ICON_DEFAULT);
        expect(resolveWindowIcon(undefined).id).toBe(WINDOW_ICON_DEFAULT);
        expect(resolveWindowIcon(null).id).toBe(WINDOW_ICON_DEFAULT);
    });

    it("sends the id the leaf used to be stored under to the current default", () => {
        // `default` named the leaf while the leaf was the default. A profile that stored it made no
        // choice of its own, so it follows the default that replaced it.
        expect(resolveWindowIcon("default").id).toBe(WINDOW_ICON_DEFAULT);
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

    it("names the files the installer is built with as the default's", () => {
        // electron-builder.yml gives the installed app, its shortcuts and its file types the
        // default icon by path. A default that pointed somewhere else would leave a fresh install
        // wearing one icon in the Dock or taskbar and another on its own shortcut.
        const builderConfig = fs.readFileSync(path.resolve(__dirname, "../../../electron-builder.yml"), "utf-8");
        const defaultIcon = resolveWindowIcon(WINDOW_ICON_DEFAULT);

        expect(builderConfig).toContain(`icon: resources/${defaultIcon.ico}`);
        expect(builderConfig).toContain(`icon: resources/${defaultIcon.png}`);
        expect(builderConfig).toContain(`icon: resources/${defaultIcon.ico.replace(/\.ico$/, ".icns")}`);
    });
});
