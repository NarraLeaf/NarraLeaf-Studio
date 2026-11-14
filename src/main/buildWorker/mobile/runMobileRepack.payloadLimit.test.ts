import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PAYLOAD_BYTES, runMobileRepack } from "./runMobileRepack";
import type { GameBuildWorkerMobileJob } from "../protocol";

const tempDirs: string[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("mobile payload size preflight", () => {
    it.each(["android", "ios"] as const)("rejects an oversized %s payload before reading it", async platform => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-mobile-limit-"));
        tempDirs.push(root);
        const sourceDir = path.join(root, "site");
        await fs.mkdir(sourceDir);
        await fs.writeFile(path.join(sourceDir, "index.html"), "small fixture");
        vi.spyOn(fs, "stat").mockResolvedValue({ size: MAX_PAYLOAD_BYTES + 1 } as Awaited<ReturnType<typeof fs.stat>>);
        const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("payload bytes read before size check"));
        const job = { sourceDir, [platform]: {} } as unknown as GameBuildWorkerMobileJob;

        await expect(runMobileRepack(job, path.join(root, "output"), () => undefined))
            .rejects.toThrow(`too large to package for ${platform === "ios" ? "iOS" : "Android"}`);
        expect(readFile).not.toHaveBeenCalled();
    });
});
