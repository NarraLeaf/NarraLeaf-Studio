import { describe, expect, it } from "vitest";

import { TEAM_ATTACHMENT_MAX_BYTES } from "@shared/types/team";

import { buildUploadQuery, pictureOfDataUrl, teamPlatformOf } from "./uploadRequest";

describe("teamPlatformOf", () => {
    it("names Studio's platforms the way the console does", () => {
        expect(teamPlatformOf("macos")).toBe("mac");
        expect(teamPlatformOf("windows")).toBe("windows");
        expect(teamPlatformOf("linux")).toBe("linux");
        expect(teamPlatformOf("web")).toBe("web");
    });

    it("calls a platform neither side knows other, and none nothing", () => {
        expect(teamPlatformOf("amiga")).toBe("other");
        expect(teamPlatformOf(undefined)).toBeUndefined();
        expect(teamPlatformOf("")).toBeUndefined();
    });
});

describe("buildUploadQuery", () => {
    it("carries the file and what was said about it, and leaves blanks out", () => {
        const query = new URLSearchParams(buildUploadQuery("game.zip", { name: " Nightly ", note: "  ", platform: "macos", latest: true }));
        expect(query.get("file")).toBe("game.zip");
        expect(query.get("name")).toBe("Nightly");
        expect(query.get("platform")).toBe("mac");
        expect(query.get("latest")).toBe("1");
        expect(query.has("note")).toBe(false);
        expect(query.has("revision")).toBe(false);
    });

    it("names an unnamed build after its file", () => {
        expect(new URLSearchParams(buildUploadQuery("game.zip", { name: "" })).get("name")).toBe("game.zip");
    });
});

describe("pictureOfDataUrl", () => {
    it("reads the three picture types a server keeps", () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        expect(pictureOfDataUrl(`data:image/png;base64,${bytes.toString("base64")}`)).toEqual(bytes);
        expect(pictureOfDataUrl(`data:image/jpeg;base64,${bytes.toString("base64")}`)).toEqual(bytes);
        expect(pictureOfDataUrl(`data:image/webp;base64,${bytes.toString("base64")}`)).toEqual(bytes);
    });

    it("refuses anything else, an empty picture and one larger than a server keeps", () => {
        expect(pictureOfDataUrl("data:image/gif;base64,R0lG")).toBeNull();
        expect(pictureOfDataUrl("data:text/html;base64,PGh0bWw+")).toBeNull();
        expect(pictureOfDataUrl("data:image/png;base64,")).toBeNull();
        const huge = Buffer.alloc(TEAM_ATTACHMENT_MAX_BYTES + 1).toString("base64");
        expect(pictureOfDataUrl(`data:image/png;base64,${huge}`)).toBeNull();
    });
});
