import { describe, expect, it } from "vitest";
import { assetsNamed, fileExtensionOf, withoutFileExtension } from "./agentLookups";

describe("asset names an agent writes", () => {
    it("counts a suffix as an extension only when it looks like one", () => {
        expect(fileExtensionOf("bgm.ogg")).toBe("ogg");
        expect(fileExtensionOf("clip.m4a")).toBe("m4a");
        expect(fileExtensionOf("voice_316.5-2")).toBeUndefined();
        expect(fileExtensionOf("voice_132.5")).toBeUndefined();
        expect(fileExtensionOf(".hidden")).toBeUndefined();
        expect(withoutFileExtension("voice_316.5-2.ogg")).toBe("voice_316.5-2");
        expect(withoutFileExtension("voice_316.5-2")).toBe("voice_316.5-2");
    });

    it("prefers the literal name, then the name plus an extension, then the ref without one", () => {
        const pool = [
            { id: "1", name: "voice_316.5-2" },
            { id: "2", name: "voice_316" },
            { id: "3", name: "voice_132.5" },
            { id: "4", name: "voice_132.5.ogg" },
            { id: "5", name: "theme.ogg" },
        ];
        expect(assetsNamed(pool, "voice_316.5-2").map(asset => asset.id)).toEqual(["1"]);
        expect(assetsNamed(pool, "voice_316").map(asset => asset.id)).toEqual(["2"]);
        expect(assetsNamed(pool, "voice_132.5").map(asset => asset.id)).toEqual(["3"]);
        expect(assetsNamed(pool, "theme").map(asset => asset.id)).toEqual(["5"]);
        expect(assetsNamed(pool, "voice_316.5-2.ogg").map(asset => asset.id)).toEqual(["1"]);
        expect(assetsNamed(pool, "voice_316.5")).toEqual([]);
    });
});
