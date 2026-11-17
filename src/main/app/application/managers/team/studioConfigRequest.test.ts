import { describe, expect, it } from "vitest";

import { studioConfigRefusal, uploadStudioConfig } from "./studioConfigRequest";

const json = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("studioConfigRefusal", () => {
    it("reads a 404 as nothing kept only when the server says so", () => {
        expect(studioConfigRefusal(404, "none", Buffer.alloc(0))).toEqual({ ok: true });
        expect(studioConfigRefusal(404, undefined, Buffer.alloc(0))).toEqual({ ok: false, reason: "unsupported" });
        expect(studioConfigRefusal(405, undefined, Buffer.alloc(0))).toEqual({ ok: false, reason: "unsupported" });
    });

    it("names the refusals the panel words, and passes the server's sentence on", () => {
        expect(studioConfigRefusal(401, undefined, Buffer.alloc(0))).toEqual({ ok: false, reason: "signed-out" });
        expect(studioConfigRefusal(403, undefined, json({ error: "read-only" }))).toEqual({ ok: false, reason: "forbidden", message: "read-only" });
        expect(studioConfigRefusal(413, undefined, Buffer.alloc(0))).toEqual({ ok: false, reason: "too-large" });
        expect(studioConfigRefusal(500, undefined, Buffer.from("<html>"))).toEqual({ ok: false, reason: "failed" });
    });
});

describe("uploadStudioConfig", () => {
    it("sends nothing larger than a server keeps", async () => {
        const target = { authUrl: "https://127.0.0.1:1", token: "t", userDataDir: "/nonexistent", studioVersion: "1" };
        await expect(uploadStudioConfig(target, "x".repeat(1024 * 1024 + 1))).resolves.toEqual({ ok: false, reason: "too-large" });
    });
});
