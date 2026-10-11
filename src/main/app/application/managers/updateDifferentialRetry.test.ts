import { describe, expect, it } from "vitest";
import {
    DIFFERENTIAL_FALLBACK_LOG_PREFIX,
    DifferentialRetry,
    classifyDifferentialFailure,
    summarizeDifferentialFailure,
} from "./updateDifferentialRetry";

// The two failures in the log that reported this: a 502 on one of the ranges (1.3.0 -> 1.4.0), and
// a 502 on the new blockmap (1.4.0 -> 1.4.2). Both fell back to the 330 MB installer.
const RANGE_502 = "HttpError: 502 \nHeaders: {\n  \"content-length\": \"0\",\n  \"server\": \"Caddy\"\n}\n    at createHttpError (httpExecutor.js:53:12)";
const BLOCKMAP_502 = "Error: Cannot download \"https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r&sv=2018-11-09&rscd=attachment%3B+filename%3DNarraLeaf-Studio-Setup-1.4.2-x64.exe.blockmap\", status 502: \n    at ClientRequest.<anonymous> (httpExecutor.js:245:34)";
const CHECKSUM = "Error: sha512 checksum mismatch, expected abc, got def";

/**
 * A stand-in for electron-updater's method: logs the way it does when an attempt gives up, then
 * answers "download the full installer". `outcomes` is one entry per attempt; null succeeds.
 */
function fakeUpdater(outcomes: (string | null)[]) {
    const slept: number[] = [];
    const retry = new DifferentialRetry({
        log: () => undefined,
        networkError: summary => new Error(`network: ${summary}`),
        sleep: async ms => {
            slept.push(ms);
        },
    });
    let calls = 0;
    const updater = {
        cancellationToken: { cancelled: false },
        async differentialDownloadInstaller(_fileInfo: unknown, _options: unknown): Promise<boolean> {
            const outcome = outcomes[calls] ?? null;
            calls += 1;
            if (outcome === null) {
                return false;
            }
            retry.observe(`${DIFFERENTIAL_FALLBACK_LOG_PREFIX} ${outcome}`);
            return true;
        },
    };
    expect(retry.install(updater)).toBe(true);
    const options = { cancellationToken: updater.cancellationToken };
    return {
        download: () => updater.differentialDownloadInstaller({}, options),
        calls: () => calls,
        slept,
        token: updater.cancellationToken,
    };
}

describe("classifyDifferentialFailure", () => {
    it("reads both 502s from the report as the network, not as an unusable update", () => {
        expect(classifyDifferentialFailure(RANGE_502)).toBe("network");
        expect(classifyDifferentialFailure(BLOCKMAP_502)).toBe("network");
    });

    it("reads Chromium and socket failures as the network", () => {
        expect(classifyDifferentialFailure("Error: net::ERR_NETWORK_CHANGED")).toBe("network");
        expect(classifyDifferentialFailure("Error: read ECONNRESET")).toBe("network");
        expect(classifyDifferentialFailure("Error: response has been aborted by the server")).toBe("network");
    });

    it("reads a page in place of a blockmap as unreadable", () => {
        expect(classifyDifferentialFailure("Error: Cannot parse blockmap \"https://x/y.blockmap\", error: Error: incorrect header check")).toBe("unreadable");
    });

    it("reads everything else as unusable, so the full installer follows as before", () => {
        expect(classifyDifferentialFailure(CHECKSUM)).toBe("unusable");
        expect(classifyDifferentialFailure("Error: Cannot download \"https://x/y.blockmap\", status 404: Not Found")).toBe("unusable");
        expect(classifyDifferentialFailure("Error: ENOENT: no such file or directory, open 'C:\\installer.exe'")).toBe("unusable");
    });
});

describe("summarizeDifferentialFailure", () => {
    it("keeps the status and drops the signed URL", () => {
        expect(summarizeDifferentialFailure(BLOCKMAP_502)).toBe("HTTP 502");
        expect(summarizeDifferentialFailure(RANGE_502)).toBe("HTTP 502");
    });

    it("keeps Chromium's and Node's error codes", () => {
        expect(summarizeDifferentialFailure("Error: net::ERR_NETWORK_CHANGED\n    at x")).toBe("net::ERR_NETWORK_CHANGED");
        expect(summarizeDifferentialFailure("Error: read ECONNRESET")).toBe("ECONNRESET");
    });
});

describe("DifferentialRetry", () => {
    it("retries a dropped request as an incremental download", async () => {
        const updater = fakeUpdater([BLOCKMAP_502, RANGE_502, null]);

        await expect(updater.download()).resolves.toBe(false);

        expect(updater.calls()).toBe(3);
        expect(updater.slept).toEqual([3_000, 10_000]);
    });

    it("fails the download rather than starting the full installer when the network never answers", async () => {
        const updater = fakeUpdater(Array(10).fill(RANGE_502));

        await expect(updater.download()).rejects.toThrow("network: HTTP 502");

        expect(updater.calls()).toBe(5);
        expect(updater.slept).toEqual([3_000, 10_000, 30_000, 60_000]);
    });

    it("falls back to the full installer at once when the incremental data does not fit", async () => {
        const updater = fakeUpdater([CHECKSUM, null]);

        await expect(updater.download()).resolves.toBe(true);

        expect(updater.calls()).toBe(1);
        expect(updater.slept).toEqual([]);
    });

    it("falls back to the full installer once a blockmap stays unreadable", async () => {
        const updater = fakeUpdater(Array(10).fill("Error: Cannot parse blockmap \"https://x\", error: bad"));

        await expect(updater.download()).resolves.toBe(true);

        expect(updater.calls()).toBe(5);
    });

    it("gives the full installer the network failure's turn when the next attempt finds the data unusable", async () => {
        const updater = fakeUpdater([RANGE_502, CHECKSUM]);

        await expect(updater.download()).resolves.toBe(true);

        expect(updater.calls()).toBe(2);
    });

    it("does not retry a cancelled download", async () => {
        const updater = fakeUpdater([RANGE_502, null]);
        updater.token.cancelled = true;

        await expect(updater.download()).resolves.toBe(true);

        expect(updater.calls()).toBe(1);
        expect(updater.slept).toEqual([]);
    });

    it("leaves a declined attempt alone", async () => {
        // The updater returns true without logging when it never tried (its test-only switch).
        const retry = new DifferentialRetry({ log: () => undefined, networkError: () => new Error("no") });
        let calls = 0;

        await expect(retry.run(async () => {
            calls += 1;
            return true;
        })).resolves.toBe(true);

        expect(calls).toBe(1);
    });

    it("installs nothing on an updater without the method", () => {
        const retry = new DifferentialRetry({ log: () => undefined, networkError: () => new Error("no") });

        expect(retry.install({})).toBe(false);
    });
});
