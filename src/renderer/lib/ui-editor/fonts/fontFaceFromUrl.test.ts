import { describe, expect, it, vi } from "vitest";
import { FontFaceLoadError, loadFontFaceFromUrl, type FontFaceEnvironment } from "./fontFaceFromUrl";

function environment(overrides: Partial<FontFaceEnvironment> = {}): FontFaceEnvironment & {
    built: Array<{ family: string; source: ArrayBuffer }>;
} {
    const built: Array<{ family: string; source: ArrayBuffer }> = [];
    return {
        built,
        fetch: vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) })),
        createFontFace: (family, source) => {
            built.push({ family, source });
            return { load: async () => ({ family }) as unknown as FontFace };
        },
        ...overrides,
    };
}

describe("loading a game font from its URL", () => {
    it("reads the bytes and builds the face from them, not from the URL", async () => {
        const env = environment();

        const loaded = await loadFontFaceFromUrl("nlRuntimeFont_body", "nlgame://asset/body?v=1", env);

        expect(env.fetch).toHaveBeenCalledWith("nlgame://asset/body?v=1");
        expect(env.built).toHaveLength(1);
        expect(env.built[0].family).toBe("nlRuntimeFont_body");
        expect(env.built[0].source.byteLength).toBe(8);
        // Handed back with the face, for the stylesheet rule a picture of the stage reads.
        expect(loaded.bytes).toBe(env.built[0].source);
        expect(loaded.face).toEqual({ family: "nlRuntimeFont_body" });
    });

    it("says the bytes could not be read when the URL answers with an error", async () => {
        const env = environment({
            fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
        });

        const failure = await loadFontFaceFromUrl("f", "app://fs/token", env).catch(error => error);

        expect(failure).toBeInstanceOf(FontFaceLoadError);
        expect(failure.stage).toBe("read");
        expect(failure.message).toBe("could not be read (HTTP 404)");
        expect(env.built).toHaveLength(0);
    });

    it("says the bytes could not be read when the request itself fails", async () => {
        const env = environment({
            fetch: async () => {
                throw new TypeError("Failed to fetch");
            },
        });

        await expect(loadFontFaceFromUrl("f", "app://fs/token", env)).rejects.toMatchObject({
            stage: "read",
            message: "could not be read (Failed to fetch)",
        });
    });

    it("refuses an empty file before the browser is asked to read it as a font", async () => {
        const env = environment({
            fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }),
        });

        await expect(loadFontFaceFromUrl("f", "app://fs/token", env)).rejects.toMatchObject({ stage: "read" });
        expect(env.built).toHaveLength(0);
    });

    it("tells a file the browser will not take as a font apart from one it could not read", async () => {
        const env = environment({
            createFontFace: () => ({
                load: async () => {
                    throw new DOMException("A network error occurred.", "NetworkError");
                },
            }),
        });

        await expect(loadFontFaceFromUrl("f", "nlgame://asset/body", env)).rejects.toMatchObject({
            stage: "decode",
            message: "is not a font this browser can draw (A network error occurred.)",
        });
    });
});
