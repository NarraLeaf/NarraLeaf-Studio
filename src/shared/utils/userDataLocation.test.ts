import { describe, expect, it } from "vitest";
import {
  describeUserDataLocations,
  USER_DATA_CONTENT_GROUPS,
  userDataDirectoryName
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
  it("names the three desktop platforms in display order", () => {
    expect(describeUserDataLocations("com.studio.game").map((item) => item.platform)).toEqual([
      "windows",
      "macos",
      "linux"
    ]);
  });

  it("resolves each platform under its own per-user root", () => {
    const [windows, macos, linux] = describeUserDataLocations("com.studio.game");
    expect(windows.display).toBe("%APPDATA%\\com.studio.game");
    expect(macos.display).toBe("~/Library/Application Support/com.studio.game");
    expect(linux.display).toBe("~/.local/share/com.studio.game");
  });

  // The Linux root is the one the sync forms can actually name, which is the
  // whole reason the runtime does not use Electron's appData there.
  it("puts Linux on the XDG data home rather than the config home", () => {
    const linux = describeUserDataLocations("com.studio.game")[2];
    expect(linux.root).toBe("linux-xdg-data-home");
    expect(linux.display).not.toContain(".config");
  });

  it("falls back to the bare root when there is no directory name", () => {
    expect(describeUserDataLocations("")[0].display).toBe("%APPDATA%");
  });
});

describe("USER_DATA_CONTENT_GROUPS", () => {
  // RuntimeSaveStore writes `<name>.json.<pid>.<ts>.tmp` beside the real file
  // while replacing it; a mask ending in `.json` never picks one up mid-write.
  it("masks saves in a way the atomic write's temporary file cannot match", () => {
    const saves = USER_DATA_CONTENT_GROUPS.find((group) => group.id === "saves");
    expect(saves).toBeDefined();
    expect(saves?.pattern.endsWith(".json")).toBe(true);
    expect(saves?.recursive).toBe(false);
  });

  it("places the persistence file at the root of the directory", () => {
    const persistence = USER_DATA_CONTENT_GROUPS.find((group) => group.id === "persistence");
    expect(persistence?.subdirectory).toBe(".");
    expect(persistence?.pattern).toBe("persistence.json");
  });
});
