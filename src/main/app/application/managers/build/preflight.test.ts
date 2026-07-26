import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import { checkIcon, readMobileOrientation } from "./preflight";

const config = (app: unknown): ProjectConfigData => ({ app, metadata: {} } as ProjectConfigData);

describe("readMobileOrientation", () => {
    it("reads each configured orientation", () => {
        for (const orientation of ["landscape", "portrait", "auto"] as const) {
            expect(readMobileOrientation(config({ mobile: { orientation } }))).toBe(orientation);
        }
    });

    it("defaults to landscape for projects saved before the setting existed", () => {
        // Every pre-existing project has no app.mobile at all; they must keep
        // building the way visual novels overwhelmingly play.
        expect(readMobileOrientation(config({}))).toBe("landscape");
        expect(readMobileOrientation(config(undefined))).toBe("landscape");
        expect(readMobileOrientation(null)).toBe("landscape");
    });

    it("falls back rather than pass an unknown value to the shell", () => {
        // The shell config is a contract; a hand-edited or newer-Studio value
        // must not reach it unchecked.
        expect(readMobileOrientation(config({ mobile: { orientation: "sideways" } }))).toBe("landscape");
        expect(readMobileOrientation(config({ mobile: { orientation: 42 } }))).toBe("landscape");
        expect(readMobileOrientation(config({ mobile: "portrait" }))).toBe("landscape");
    });
});

describe("checkIcon", () => {
    let projectPath: string;

    beforeEach(async () => {
        projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "nls-preflight-icon-"));
        await fs.mkdir(path.join(projectPath, "resources", "icons", "derived"), { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(projectPath, { recursive: true, force: true });
    });

    /** A PNG header is all checkIcon reads, so that is all these files hold. */
    async function writePng(relativePath: string, width: number, height: number): Promise<void> {
        const bytes = Buffer.alloc(24);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
        bytes.write("IHDR", 12, "ascii");
        bytes.writeUInt32BE(width, 16);
        bytes.writeUInt32BE(height, 20);
        await fs.writeFile(path.join(projectPath, relativePath), bytes);
    }

    const configWith = (icons: unknown) => ({ metadata: { icons } }) as never;

    it("reports no icon at all as missing", async () => {
        expect(await checkIcon(projectPath, configWith({}), "windows")).toEqual({ status: "missing" });
    });

    it("reports a configured icon that is not on disk as missing", async () => {
        const config = configWith({ version: 2, master: { path: "resources/icons/source/master.png" } });
        expect(await checkIcon(projectPath, config, "windows")).toEqual({ status: "missing" });
    });

    it("prefers the baked file over the raw source", async () => {
        await writePng("resources/icons/derived/windows.png", 1024, 1024);
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        }), "windows");
        expect(check).toMatchObject({ status: "ok", baked: true, lowResolution: false });
    });

    it("falls back to the raw source and flags it as un-baked", async () => {
        await fs.mkdir(path.join(projectPath, "resources", "icons", "source"), { recursive: true });
        await writePng("resources/icons/source/master.png", 1024, 1024);
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
        }), "windows");
        expect(check).toMatchObject({ status: "ok", baked: false });
    });

    it("ships a small icon and flags it, rather than swapping in a default", async () => {
        await writePng("resources/icons/derived/windows.png", 256, 256);
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        }), "windows");
        expect(check).toMatchObject({ status: "ok", lowResolution: true });
    });

    it("reports a corrupt PNG as unusable", async () => {
        await fs.writeFile(path.join(projectPath, "resources/icons/derived/windows.png"), Buffer.from("not a png"));
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        }), "windows");
        expect(check).toEqual({ status: "unusable" });
    });

    it("resolves a legacy five-slot project through its promoted master", async () => {
        await fs.mkdir(path.join(projectPath, "resources", "icons"), { recursive: true });
        await writePng("resources/icons/app-icon-windows.png", 1024, 1024);
        const config = configWith({ windows: { path: "resources/icons/app-icon-windows.png" } });
        expect(await checkIcon(projectPath, config, "windows")).toMatchObject({ status: "ok", baked: false });
        // Linux never had its own slot here; it now inherits the master.
        expect(await checkIcon(projectPath, config, "linux")).toMatchObject({ status: "ok" });
    });
});
