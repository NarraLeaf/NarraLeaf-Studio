import path from "path";
import { describe, expect, it } from "vitest";

import {
    DLC_DIRECTORY_NAME_POSIX,
    DLC_DIRECTORY_NAME_WINDOWS,
    dlcArtifactFileName,
    dlcDirectoryCandidates,
    dlcDirectoryName,
    isDlcFileName,
    resolveDlcDeliveryPath,
} from "./dlcDelivery";

const posix = path.posix;

function deliver(chosen: string, platform: string): string {
    return resolveDlcDeliveryPath(chosen, platform, posix.join, posix.dirname, posix.basename);
}

describe("dlcArtifactFileName", () => {
    it("names the file after the id", () => {
        expect(dlcArtifactFileName("summer")).toBe("summer_DLC.pak");
    });
});

describe("isDlcFileName", () => {
    it("matches the suffix whatever case it arrived in", () => {
        expect(isDlcFileName("summer_DLC.pak")).toBe(true);
        expect(isDlcFileName("summer_dlc.pak")).toBe(true);
    });

    it("does not match a file that is only the suffix, nor another layer", () => {
        expect(isDlcFileName("_DLC.pak")).toBe(false);
        expect(isDlcFileName("summer.patch.dat")).toBe(false);
        expect(isDlcFileName("summer.pak")).toBe(false);
    });
});

describe("dlcDirectoryName", () => {
    it("follows each platform's own convention", () => {
        expect(dlcDirectoryName("win32")).toBe(DLC_DIRECTORY_NAME_WINDOWS);
        expect(dlcDirectoryName("darwin")).toBe(DLC_DIRECTORY_NAME_POSIX);
        expect(dlcDirectoryName("linux")).toBe(DLC_DIRECTORY_NAME_POSIX);
    });

    it("reads both spellings everywhere, so a case-sensitive player is not cut off from a Windows author", () => {
        expect(dlcDirectoryCandidates("win32")).toEqual([DLC_DIRECTORY_NAME_WINDOWS, DLC_DIRECTORY_NAME_POSIX]);
        expect(dlcDirectoryCandidates("darwin")).toEqual([DLC_DIRECTORY_NAME_POSIX, DLC_DIRECTORY_NAME_WINDOWS]);
    });
});

describe("resolveDlcDeliveryPath", () => {
    it("puts the file in the platform's DLC folder", () => {
        expect(deliver("/out/summer_DLC.pak", "win32")).toBe("/out/DLC/summer_DLC.pak");
        expect(deliver("/out/summer_DLC.pak", "darwin")).toBe("/out/dlc/summer_DLC.pak");
    });

    it("takes a location already inside one at face value, under either spelling", () => {
        expect(deliver("/out/DLC/summer_DLC.pak", "win32")).toBe("/out/DLC/summer_DLC.pak");
        // An author who navigated into a folder made on the other platform meant that folder, not a
        // second one nested inside it.
        expect(deliver("/out/dlc/summer_DLC.pak", "win32")).toBe("/out/dlc/summer_DLC.pak");
        expect(deliver("/out/DLC/summer_DLC.pak", "darwin")).toBe("/out/DLC/summer_DLC.pak");
    });
});
