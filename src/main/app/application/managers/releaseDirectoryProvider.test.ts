import { describe, expect, it } from "vitest";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";
import { ReleaseDirectoryProvider, releaseDirectoryFeed } from "./releaseDirectoryProvider";

const DIRECTORY = "https://gitcode.com/NarraLeaf/NarraLeaf-Studio/releases/download/v1.4.4";

const FEED = [
    "version: 1.4.4",
    "files:",
    "  - url: NarraLeaf-Studio-Setup-1.4.4-x64.exe",
    "    sha512: abc==",
    "    size: 338145602",
    "path: NarraLeaf-Studio-Setup-1.4.4-x64.exe",
    "sha512: abc==",
    "",
].join("\n");

/** A provider whose requests are answered here; every URL it asked for is kept. */
function providerOn(platform: ProviderRuntimeOptions["platform"] = "win32") {
    const asked: string[] = [];
    const executor = {
        request: async (options: { protocol?: string; hostname?: string; path?: string }) => {
            asked.push(`${options.protocol}//${options.hostname}${options.path}`);
            return FEED;
        },
    };
    const provider = new ReleaseDirectoryProvider({ url: DIRECTORY }, null, {
        isUseMultipleRangeRequest: true,
        platform,
        executor: executor as unknown as ProviderRuntimeOptions["executor"],
    });
    return { provider, asked };
}

describe("ReleaseDirectoryProvider", () => {
    it("reads latest.yml from the release directory, with no query string", async () => {
        const { provider, asked } = providerOn();
        const info = await provider.getLatestVersion();

        expect(info.version).toBe("1.4.4");
        // GitCode answers 404 to a release file asked for with any query string.
        expect(asked).toEqual([`${DIRECTORY}/latest.yml`]);
    });

    it("resolves the files it lists beside it", async () => {
        const { provider } = providerOn();
        const files = provider.resolveFiles(await provider.getLatestVersion());
        expect(files.map(file => file.url.href)).toEqual([`${DIRECTORY}/NarraLeaf-Studio-Setup-1.4.4-x64.exe`]);
    });

    it("finds the old version's blockmap in the old version's release", async () => {
        const { provider } = providerOn();
        const [installer] = provider.resolveFiles(await provider.getLatestVersion());
        const [oldMap, newMap] = await provider.getBlockMapFiles(installer.url, "1.4.3", "1.4.4");

        expect(oldMap.href).toBe("https://gitcode.com/NarraLeaf/NarraLeaf-Studio/releases/download/v1.4.3/NarraLeaf-Studio-Setup-1.4.3-x64.exe.blockmap");
        expect(newMap.href).toBe(`${DIRECTORY}/NarraLeaf-Studio-Setup-1.4.4-x64.exe.blockmap`);
    });

    it("asks for one byte range per request, as GitHub has always needed", () => {
        expect(providerOn().provider.isUseMultipleRangeRequest).toBe(false);
    });

    it("is what the feed handed to setFeedURL builds", () => {
        const feed = releaseDirectoryFeed(DIRECTORY);
        expect(feed.provider).toBe("custom");
        expect(feed.updateProvider).toBe(ReleaseDirectoryProvider);
        expect(feed.url).toBe(DIRECTORY);
    });
});
