import { mkdtempSync, rmSync, statSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { configureLoreAuthStore, loreAuthDirectory } from "./loreAuthStore";

describe("where the version-control library keeps its tokens", () => {
    const made: string[] = [];
    const userData = (): string => {
        const directory = mkdtempSync(path.join(os.tmpdir(), "nls-lore-auth-"));
        made.push(directory);
        return directory;
    };
    afterEach(() => {
        for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
    });

    it("on macOS, keeps the key in a file in a directory of Studio's own, so the keychain is never asked", () => {
        const root = userData();
        const env: NodeJS.ProcessEnv = {};
        configureLoreAuthStore(root, "darwin", env);
        expect(env.LORE_AUTH_STORE).toBe("fallback");
        expect(env.LORE_AUTH_PATH).toBe(loreAuthDirectory(root));
        expect(statSync(loreAuthDirectory(root)).isDirectory()).toBe(true);
        if (process.platform !== "win32") {
            expect(statSync(loreAuthDirectory(root)).mode & 0o777).toBe(0o700);
        }
    });

    it("leaves Windows and Linux to the library's own store", () => {
        for (const platform of ["win32", "linux"] as const) {
            const env: NodeJS.ProcessEnv = {};
            configureLoreAuthStore(userData(), platform, env);
            expect(env).toEqual({});
        }
    });

    it("leaves a choice somebody already made", () => {
        const env: NodeJS.ProcessEnv = { LORE_AUTH_PATH: "/somewhere", LORE_AUTH_STORE: "secure" };
        configureLoreAuthStore(userData(), "darwin", env);
        expect(env).toEqual({ LORE_AUTH_PATH: "/somewhere", LORE_AUTH_STORE: "secure" });
    });
});
