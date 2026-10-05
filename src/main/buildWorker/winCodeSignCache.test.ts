import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BINARIES_MIRROR_ENV_VARS, binariesMirror, withBinariesMirrorEnv } from "./winCodeSignCache";

const MIRROR = "https://mirror.example/electron-builder-binaries/";

describe("withBinariesMirrorEnv", () => {
    let saved: Array<readonly [string, string | undefined]>;

    beforeEach(() => {
        saved = BINARIES_MIRROR_ENV_VARS.map(name => [name, process.env[name]] as const);
        for (const name of BINARIES_MIRROR_ENV_VARS) {
            delete process.env[name];
        }
    });

    afterEach(() => {
        for (const [name, value] of saved) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    });

    it("points every variable electron-builder reads at the setting while the body runs", async () => {
        const seen = await withBinariesMirrorEnv(MIRROR, async () =>
            BINARIES_MIRROR_ENV_VARS.map(name => process.env[name]));
        expect(seen).toEqual(BINARIES_MIRROR_ENV_VARS.map(() => MIRROR));
    });

    it("outranks a stale host variable that electron-builder would read first", async () => {
        process.env.NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR = "https://stale.example/";
        const seen = await withBinariesMirrorEnv(MIRROR, async () =>
            process.env.NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR);
        expect(seen).toBe(MIRROR);
        expect(process.env.NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR).toBe("https://stale.example/");
    });

    it("adds the trailing slash electron-builder composes paths after", async () => {
        const seen = await withBinariesMirrorEnv("https://mirror.example/bin", async () =>
            process.env.ELECTRON_BUILDER_BINARIES_MIRROR);
        expect(seen).toBe("https://mirror.example/bin/");
    });

    it("leaves the host's own variables in charge when the setting is empty", async () => {
        process.env.ELECTRON_BUILDER_BINARIES_MIRROR = "https://host.example/";
        const seen = await withBinariesMirrorEnv("  ", async () => process.env.ELECTRON_BUILDER_BINARIES_MIRROR);
        expect(seen).toBe("https://host.example/");
    });

    it("restores the environment when the body throws", async () => {
        await expect(withBinariesMirrorEnv(MIRROR, async () => {
            throw new Error("packaging failed");
        })).rejects.toThrow("packaging failed");
        for (const name of BINARIES_MIRROR_ENV_VARS) {
            expect(process.env[name]).toBeUndefined();
        }
    });

    it("agrees with the mirror Studio's own fetches use", async () => {
        const seen = await withBinariesMirrorEnv(MIRROR, async () => binariesMirror());
        expect(seen).toBe(binariesMirror(MIRROR));
    });
});
