import { describe, expect, it } from "vitest";

import { fetchAvatar, isAvatarPath, sniffAvatarType } from "./avatarRequest";

const HASH = "a".repeat(64);

describe("isAvatarPath", () => {
    it("accepts the one shape avatars are served under", () => {
        expect(isAvatarPath(`/api/team/v1/avatars/lightdust/${HASH}.webp`)).toBe(true);
        expect(isAvatarPath(`/api/team/v1/avatars/a%20b/${HASH}.png`)).toBe(true);
        expect(isAvatarPath(`/api/team/v1/avatars/x/${HASH}.jpg`)).toBe(true);
    });

    it("refuses any other path on the server", () => {
        expect(isAvatarPath("/api/team/v1/projects")).toBe(false);
        expect(isAvatarPath(`/api/team/v1/avatars/x/../../admin/${HASH}.png`)).toBe(false);
        expect(isAvatarPath(`/api/team/v1/avatars/x/${HASH}.svg`)).toBe(false);
        expect(isAvatarPath(`/api/team/v1/avatars/x/${HASH}.png?x=1`)).toBe(false);
        expect(isAvatarPath(`https://elsewhere.test/api/team/v1/avatars/x/${HASH}.png`)).toBe(false);
        expect(isAvatarPath(`/api/team/v1/avatars/x/short.png`)).toBe(false);
    });
});

describe("sniffAvatarType", () => {
    it("reads the three image types from their first bytes", () => {
        expect(sniffAvatarType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
        expect(sniffAvatarType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
        expect(sniffAvatarType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe("image/webp");
    });

    it("refuses anything else", () => {
        expect(sniffAvatarType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
        expect(sniffAvatarType(Buffer.alloc(0))).toBeNull();
    });
});

describe("fetchAvatar", () => {
    it("sends nothing for a path of the wrong shape", async () => {
        await expect(fetchAvatar({
            authUrl: "https://127.0.0.1:1",
            token: "t",
            userDataDir: "/nonexistent",
            path: "/api/team/v1/projects",
        })).resolves.toBeNull();
    });
});
