import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";



import { resolvePhysicalPath } from "./physicalPath";

/*
 * The authorization decision has to be about the file the operating system will actually open.
 * A grant covers <base>/grant; <base>/grant/link points at <base>/outside/inner.
 */
let base: string;
let grant: string;

beforeAll(async () => {

    base = fsSync.realpathSync(fsSync.mkdtempSync(path.join(os.tmpdir(), "nls-physical-")));
    grant = path.join(base, "grant");
    fsSync.mkdirSync(grant);
    fsSync.mkdirSync(path.join(base, "outside", "inner"), { recursive: true });
    fsSync.writeFileSync(path.join(base, "outside", "secret.txt"), "s");
    fsSync.writeFileSync(path.join(grant, "secret.txt"), "decoy");
    fsSync.symlinkSync(path.join(base, "outside", "inner"), path.join(grant, "link"), "dir");
});

afterAll(() => {
    fsSync.rmSync(base, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("resolvePhysicalPath", () => {
    it("follows a link before the .. after it, as the operating system does", async () => {
        const asked = `${grant}/link/../secret.txt`;
        // What the I/O reaches: the file outside the grant.
        expect(fsSync.readFileSync(asked, "utf-8")).toBe("s");
        expect(await resolvePhysicalPath(asked)).toBe(path.join(base, "outside", "secret.txt"));
    });

    it("puts a tail that does not exist yet back on the real path", async () => {
        expect(await resolvePhysicalPath(`${grant}/link/../new.txt`)).toBe(path.join(base, "outside", "new.txt"));
        expect(await resolvePhysicalPath(`${grant}/link/new.txt`)).toBe(path.join(base, "outside", "inner", "new.txt"));
        expect(await resolvePhysicalPath(`${grant}/new/deeper.txt`)).toBe(path.join(grant, "new", "deeper.txt"));
    });

    it("answers a plain path with its real path", async () => {
        expect(await resolvePhysicalPath(path.join(grant, "secret.txt"))).toBe(path.join(grant, "secret.txt"));
    });
});
