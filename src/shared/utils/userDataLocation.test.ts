import { describe, expect, it } from "vitest";
import {
    DEFAULT_SAVE_LOCATION_CONFIGURATION,
    describeUserDataLocations,
    formatUserDataLocation,
    normalizeSaveLocationConfiguration,
    saveLocationModeFor,
    USER_DATA_CONTENT_GROUPS,
    userDataDirectoryName,
    type SaveLocationConfiguration,
} from "./userDataLocation";

describe("userDataDirectoryName", () => {
    it("keeps a reverse-domain app id as it is", () => {
        expect(userDataDirectoryName("com.studio.game")).toBe("com.studio.game");
    });

    it("trims surrounding whitespace", () => {
        expect(userDataDirectoryName("  com.studio.game  ")).toBe("com.studio.game");
    });

    // App ids cannot contain these, so this is a guard rather than a feature:
    // a malformed one must not become a path that climbs out of the root.
    it("refuses to let separators or a leading dot escape the root", () => {
        expect(userDataDirectoryName("../../etc")).toBe("etc");
        expect(userDataDirectoryName("a/b\\c")).toBe("a-b-c");
    });
});

describe("describeUserDataLocations", () => {
    const perUser: SaveLocationConfiguration = { windowsLinux: "user-data", macos: "user-data" };
    const besideGame: SaveLocationConfiguration = { windowsLinux: "app-root", macos: "app-root" };

    it("names the three desktop platforms in display order", () => {
        expect(describeUserDataLocations("com.studio.game", perUser).map(item => item.platform))
            .toEqual(["windows", "macos", "linux"]);
    });

    it("resolves each platform under its own per-user root", () => {
        const [windows, macos, linux] = describeUserDataLocations("com.studio.game", perUser)
            .map(location => formatUserDataLocation(location, "<game folder>"));
        expect(windows).toBe("%APPDATA%\\com.studio.game");
        expect(macos).toBe("~/Library/Application Support/com.studio.game");
        expect(linux).toBe("~/.local/share/com.studio.game");
    });

    // The Linux root is the one the sync forms can actually name, which is the
    // whole reason the runtime does not use Electron's appData there.
    it("puts Linux on the XDG data home rather than the config home", () => {
        const linux = describeUserDataLocations("com.studio.game", perUser)[2];
        expect(linux.root).toBe("linux-xdg-data-home");
        expect(formatUserDataLocation(linux, "<game folder>")).not.toContain(".config");
    });

    it("falls back to the bare root when there is no directory name", () => {
        expect(formatUserDataLocation(describeUserDataLocations("", perUser)[0], "<game folder>"))
            .toBe("%APPDATA%");
    });

    // Two copies of a game in two folders never shared a directory, so the app id
    // has nothing left to keep apart and the reader has to supply the only name
    // the folder has.
    it("names the game's own folder with no directory below it", () => {
        for (const location of describeUserDataLocations("com.studio.game", besideGame)) {
            expect(location.root).toBe("game-install-dir");
            expect(location.rootDisplay).toBeNull();
            expect(formatUserDataLocation(location, "<game folder>")).toBe("<game folder>");
        }
    });

    // The two settings are the point: one project ships beside itself on Windows
    // and Linux while macOS keeps to the per-user directory.
    it("answers each platform group from its own setting", () => {
        const [windows, macos, linux] = describeUserDataLocations(
            "com.studio.game",
            DEFAULT_SAVE_LOCATION_CONFIGURATION,
        );
        expect(windows.root).toBe("game-install-dir");
        expect(linux.root).toBe("game-install-dir");
        expect(macos.root).toBe("macos-application-support");
    });
});

describe("normalizeSaveLocationConfiguration", () => {
    it("fills in the defaults for a project that has never been asked", () => {
        expect(normalizeSaveLocationConfiguration(undefined)).toEqual(DEFAULT_SAVE_LOCATION_CONFIGURATION);
    });

    it("keeps a complete answer", () => {
        const config: SaveLocationConfiguration = { windowsLinux: "user-data", macos: "app-root" };
        expect(normalizeSaveLocationConfiguration(config)).toEqual(config);
    });

    // A half-written value has to leave the other half alone rather than reset
    // the pair: the two fields are separate answers.
    it("replaces only the field it cannot read", () => {
        expect(normalizeSaveLocationConfiguration({ windowsLinux: "elsewhere", macos: "app-root" }))
            .toEqual({ windowsLinux: DEFAULT_SAVE_LOCATION_CONFIGURATION.windowsLinux, macos: "app-root" });
    });
});

describe("saveLocationModeFor", () => {
    it("reads macOS from its own field and the other two from theirs", () => {
        const config: SaveLocationConfiguration = { windowsLinux: "app-root", macos: "user-data" };
        expect(saveLocationModeFor(config, "windows")).toBe("app-root");
        expect(saveLocationModeFor(config, "linux")).toBe("app-root");
        expect(saveLocationModeFor(config, "macos")).toBe("user-data");
    });
});

describe("USER_DATA_CONTENT_GROUPS", () => {
    // RuntimeSaveStore writes `<name>.json.<pid>.<ts>.tmp` beside the real file
    // while replacing it; a mask ending in `.json` never picks one up mid-write.
    it("masks saves in a way the atomic write's temporary file cannot match", () => {
        const saves = USER_DATA_CONTENT_GROUPS.find(group => group.id === "saves");
        expect(saves).toBeDefined();
        expect(saves?.pattern.endsWith(".json")).toBe(true);
        expect(saves?.recursive).toBe(false);
    });

    it("places the persistence file at the root of the directory", () => {
        const persistence = USER_DATA_CONTENT_GROUPS.find(group => group.id === "persistence");
        expect(persistence?.subdirectory).toBe(".");
        expect(persistence?.pattern).toBe("persistence.json");
    });
});
