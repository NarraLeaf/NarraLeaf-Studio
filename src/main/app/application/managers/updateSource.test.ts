import { describe, expect, it } from "vitest";
import { chooseUpdateSource, readFeed, timeDownload, type UpdateFetch } from "./updateSource";

const GITHUB_FEED = "https://github.com/NarraLeaf/NarraLeaf-Studio/releases/latest/download/latest.yml";
const GITCODE_API = "https://api.gitcode.com/api/v5/repos/NarraLeaf/NarraLeaf-Studio/releases/latest";
const gitcodeFeed = (tag: string) => `https://gitcode.com/NarraLeaf/NarraLeaf-Studio/releases/download/${tag}/latest.yml`;

function feed(version: string): string {
    return [
        `version: ${version}`,
        "files:",
        `  - url: NarraLeaf-Studio-Setup-${version}-x64.exe`,
        "    sha512: abc==",
        "    size: 338145602",
        `path: NarraLeaf-Studio-Setup-${version}-x64.exe`,
        "sha512: abc==",
        "releaseDate: '2026-10-07T06:47:27.113Z'",
        "",
    ].join("\n");
}

/** A fetch that answers from a table and remembers every URL it was asked for. */
function fakeFetch(routes: Record<string, string | number>) {
    const asked: string[] = [];
    const fetcher: UpdateFetch = async url => {
        asked.push(url);
        const answer = routes[url];
        if (answer === undefined || typeof answer === "number") {
            return new Response("not here", { status: typeof answer === "number" ? answer : 404 });
        }
        return new Response(answer, { status: 200 });
    };
    return { fetcher, asked };
}

const bothAt = (github: string, gitcode: string) => fakeFetch({
    [GITHUB_FEED]: feed(github),
    [GITCODE_API]: JSON.stringify({ tag_name: `v${gitcode}` }),
    [gitcodeFeed(`v${gitcode}`)]: feed(gitcode),
});

const noLog = () => undefined;

describe("readFeed", () => {
    it("reads the version and the installer from a latest.yml", () => {
        expect(readFeed(feed("1.4.4"))).toEqual({ version: "1.4.4", path: "NarraLeaf-Studio-Setup-1.4.4-x64.exe" });
        expect(readFeed("version: '1.4.4'\npath: \"a b.exe\"\n")).toEqual({ version: "1.4.4", path: "a b.exe" });
    });

    it("reads a page a proxy put in its place as nothing", () => {
        expect(readFeed("<!DOCTYPE html><html><body>version: 1</body></html>")).toBeNull();
    });
});

describe("chooseUpdateSource", () => {
    it("times both when both have the newest version, and takes the faster", async () => {
        const { fetcher } = bothAt("1.4.4", "1.4.4");
        const timed: string[] = [];
        const offer = await chooseUpdateSource({
            fetch: fetcher,
            currentVersion: "1.4.3",
            log: noLog,
            timeDownload: async url => {
                timed.push(url);
                return url.startsWith("https://gitcode.com/") ? 2_000_000 : 40_000;
            },
        });

        expect(timed).toHaveLength(2);
        expect(offer?.source).toBe("gitcode");
        // The tag is in the directory, which is what lets the old version's blockmap be found.
        expect(offer?.feedUrl).toBe("https://gitcode.com/NarraLeaf/NarraLeaf-Studio/releases/download/v1.4.4");
        expect(offer?.installerUrl).toBe("https://gitcode.com/NarraLeaf/NarraLeaf-Studio/releases/download/v1.4.4/NarraLeaf-Studio-Setup-1.4.4-x64.exe");
        expect(offer?.releaseUrl).toBe("https://gitcode.com/NarraLeaf/NarraLeaf-Studio/releases/v1.4.4");
    });

    it("never asks GitCode for a release file with a query string", async () => {
        const { fetcher, asked } = bothAt("1.4.4", "1.4.4");
        await chooseUpdateSource({ fetch: fetcher, currentVersion: "1.4.3", log: noLog, timeDownload: async () => 1 });

        const gitcodeFiles = asked.filter(url => url.startsWith("https://gitcode.com/"));
        expect(gitcodeFiles.length).toBeGreaterThan(0);
        expect(gitcodeFiles.every(url => !url.includes("?"))).toBe(true);
    });

    it("takes GitHub without timing while GitCode is still being copied to", async () => {
        const { fetcher } = bothAt("1.4.5", "1.4.4");
        let timed = 0;
        const offer = await chooseUpdateSource({ fetch: fetcher, currentVersion: "1.4.3", log: noLog, timeDownload: async () => ++timed });

        expect(offer?.source).toBe("github");
        expect(offer?.version).toBe("1.4.5");
        expect(offer?.releaseUrl).toBe("https://github.com/NarraLeaf/NarraLeaf-Studio/releases/tag/v1.4.5");
        expect(timed).toBe(0);
    });

    it("counts a GitCode release whose feed is not uploaded yet as not having the version", async () => {
        const { fetcher } = fakeFetch({
            [GITHUB_FEED]: feed("1.4.4"),
            [GITCODE_API]: JSON.stringify({ tag_name: "v1.4.5" }),
        });
        const offer = await chooseUpdateSource({ fetch: fetcher, currentVersion: "1.4.3", log: noLog, timeDownload: async () => 1 });
        expect(offer?.source).toBe("github");
        expect(offer?.version).toBe("1.4.4");
    });

    it("uses whichever one answers when the other cannot be reached", async () => {
        const { fetcher } = fakeFetch({
            [GITCODE_API]: JSON.stringify({ tag_name: "v1.4.4" }),
            [gitcodeFeed("v1.4.4")]: feed("1.4.4"),
        });
        const offer = await chooseUpdateSource({ fetch: fetcher, currentVersion: "1.4.3", log: noLog });
        expect(offer?.source).toBe("gitcode");
    });

    it("answers null when neither can be reached", async () => {
        const fetcher: UpdateFetch = () => Promise.reject(new Error("offline"));
        expect(await chooseUpdateSource({ fetch: fetcher, currentVersion: "1.4.3", log: noLog })).toBeNull();
    });

    it("does not time anything when there is nothing newer to download", async () => {
        const { fetcher } = bothAt("1.4.3", "1.4.3");
        let timed = 0;
        const offer = await chooseUpdateSource({ fetch: fetcher, currentVersion: "1.4.3", log: noLog, timeDownload: async () => ++timed });
        expect(offer?.version).toBe("1.4.3");
        expect(timed).toBe(0);
    });

    it("reuses the source this session settled on for the same version", async () => {
        const { fetcher } = bothAt("1.4.4", "1.4.4");
        let timed = 0;
        const offer = await chooseUpdateSource({
            fetch: fetcher,
            currentVersion: "1.4.3",
            log: noLog,
            remembered: { version: "1.4.4", source: "gitcode" },
            timeDownload: async () => ++timed,
        });
        expect(offer?.source).toBe("gitcode");
        expect(timed).toBe(0);
    });

    it("passes over the source a download of this version just failed from, without timing", async () => {
        const { fetcher } = bothAt("1.4.4", "1.4.4");
        let timed = 0;
        const offer = await chooseUpdateSource({
            fetch: fetcher,
            currentVersion: "1.4.3",
            log: noLog,
            remembered: { version: "1.4.4", source: "gitcode" },
            avoid: { version: "1.4.4", source: "gitcode" },
            timeDownload: async () => ++timed,
        });
        expect(offer?.source).toBe("github");
        expect(timed).toBe(0);
    });

    it("still uses the source that failed when it is the only one with the version", async () => {
        const { fetcher } = bothAt("1.4.3", "1.4.4");
        const offer = await chooseUpdateSource({
            fetch: fetcher,
            currentVersion: "1.4.3",
            log: noLog,
            avoid: { version: "1.4.4", source: "gitcode" },
        });
        expect(offer?.source).toBe("gitcode");
    });

    it("asks only the source chosen in Settings", async () => {
        for (const preference of ["github", "gitcode"] as const) {
            const { fetcher, asked } = bothAt("1.4.4", "1.4.4");
            const offer = await chooseUpdateSource({ fetch: fetcher, currentVersion: "1.4.3", log: noLog, preference, timeDownload: async () => 1 });
            expect(offer?.source).toBe(preference);
            const other = preference === "github" ? "gitcode.com" : "github.com";
            expect(asked.some(url => url.includes(other))).toBe(false);
        }
    });

    it("refuses a feed that disagrees with its own tag", async () => {
        const { fetcher } = fakeFetch({
            [GITCODE_API]: JSON.stringify({ tag_name: "v1.4.4" }),
            [gitcodeFeed("v1.4.4")]: feed("1.4.3"),
        });
        expect(await chooseUpdateSource({ fetch: fetcher, currentVersion: "1.4.3", log: noLog })).toBeNull();
    });
});

describe("timeDownload", () => {
    it("measures what arrives, asking for the start of the file only", async () => {
        let range = "";
        const fetcher: UpdateFetch = async (_url, init) => {
            range = init?.headers?.Range ?? "";
            return new Response(new Uint8Array(64 * 1024), { status: 206 });
        };
        const rate = await timeDownload(fetcher, "https://example.test/a.exe", 1_000, 1024 * 1024);
        expect(range).toBe("bytes=0-1048575");
        expect(rate).toBeGreaterThan(0);
    });

    it("is zero for a source that refuses", async () => {
        const fetcher: UpdateFetch = async () => new Response("no", { status: 403 });
        expect(await timeDownload(fetcher, "https://example.test/a.exe", 1_000)).toBe(0);
    });

    it("stops at the end of its window on a source that trickles", async () => {
        const fetcher: UpdateFetch = async (_url, init) => new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(1024));
                init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
            },
        }), { status: 206 });
        const started = Date.now();
        const rate = await timeDownload(fetcher, "https://example.test/a.exe", 200);
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(rate).toBeGreaterThan(0);
    });
});
