import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PluginApiHandler } from "./pluginHandler";
import { APP_SCHEME_PRIVILEGES } from "./types";

/**
 * What `app://` is allowed to do, guarded because getting it wrong is invisible until a real game
 * runs and then reads as a broken file rather than a missing capability.
 *
 * `stream` is the specific one. Without it a `<video>` over `app://fs` plays only what fits in the
 * first response: a 17 KB clip played and a 121 KB clip failed with `MEDIA_ELEMENT_ERROR: Format
 * error` — on bytes that `fetch` returned whole and that a Blob of the same bytes decoded to
 * 1920x1080. Every symptom points at the file; none points at the scheme.
 *
 * The second test is a text assertion for the same reason as the placement guard in the engine:
 * `registerSchemesAsPrivileged` takes ONE decision per scheme, and the handlers all bind the same
 * one, so a second inline privilege object would silently win or lose on registration order. There
 * is no runtime seam that can catch that — the losing object simply never appears anywhere.
 */
describe("app:// scheme privileges", () => {
    it("allows streaming, which is what media playback needs", () => {
        expect(APP_SCHEME_PRIVILEGES.stream).toBe(true);
        expect(APP_SCHEME_PRIVILEGES).toMatchObject({ standard: true, secure: true, supportFetchAPI: true, corsEnabled: true });
    });

    it("is the only privilege object any app:// handler declares", () => {
        expect(new PluginApiHandler().privileges).toBe(APP_SCHEME_PRIVILEGES);

        const manager = fs.readFileSync(path.resolve(__dirname, "..", "protocolManager.ts"), "utf8");
        expect(manager).not.toMatch(/privileges\s*[:=]\s*\{/);
        expect(manager).toMatch(/APP_SCHEME_PRIVILEGES/);
    });
});
