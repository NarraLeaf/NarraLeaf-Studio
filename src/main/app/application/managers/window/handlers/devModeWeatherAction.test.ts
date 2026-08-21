import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { weatherBakeKey } from "@shared/weather/bakeKey";
import type { WeatherBakeSpec } from "@shared/weather/model";
import { FileSystemHashHandler } from "../../protocol/fileSystemHandler";
import { StorageManager } from "../../storageManager";
import type { AppWindow } from "../appWindow";
import { WindowAppType } from "@shared/types/window";
import { DevModeResolveWeatherClipHandler } from "./devModeAction";

vi.mock("electron", () => ({
    app: {
        startAccessingSecurityScopedResource: vi.fn(() => vi.fn()),
    },
}));

vi.mock("@shared/utils/persistentState", () => ({
    PersistentState: class { },
}));

const SPEC: WeatherBakeSpec = { ref: { seed: "snow" }, width: 1920, height: 1080, fps: 30, frames: 360 };

describe("dev mode weather clip grants", () => {
    let tempDir = "";
    let clipPath = "";
    let storageManager: StorageManager;
    let protocolHandler: FileSystemHashHandler;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-weather-grant-"));
        clipPath = path.join(tempDir, "snow.webm");
        await fs.writeFile(clipPath, Buffer.from("fake-webm-bytes"));
        storageManager = new StorageManager({ logger: { error: vi.fn(), warn: vi.fn() } } as any);
        protocolHandler = new FileSystemHashHandler("app", {}, storageManager);
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    /** What the handler asked the bake manager for, so the claim it makes can be read back. */
    let asked: { claim?: { owner: string; attempt: string } } | null = null;

    function makeWindow(outcome: { paths: Map<string, string>; failures: Map<string, string> }): AppWindow<WindowAppType.DevMode> {
        const app = {
            storageManager,
            getWeatherBakeManager: () => ({
                ensure: async (request: { claim?: { owner: string; attempt: string } }) => {
                    asked = request;
                    return outcome;
                },
            }),
        };
        return {
            app,
            getApp: () => app,
            getProps: () => ({ projectPath: tempDir }),
            getWebContents: () => ({ id: 7 }),
        } as unknown as AppWindow<WindowAppType.DevMode>;
    }

    function request(url: string): Request {
        return { url, method: "GET" } as unknown as Request;
    }

    it("returns a URL the protocol actually serves, and serves it more than once", async () => {
        // The regression this guards: a freshly allocated grant is `allocated`, and the protocol
        // handler serves only `ready`. Skipping that one call produced a URL that looked right
        // everywhere - the <video> carried it, the main log showed the request arrive - and answered
        // 403 every time, so the stage stayed empty with no error an author could act on.
        const outcome = { paths: new Map([[weatherBakeKey(SPEC), clipPath]]), failures: new Map<string, string>() };
        const result = await new DevModeResolveWeatherClipHandler().handle(makeWindow(outcome), { spec: SPEC, attempt: "bundle:1" });

        expect(result.success).toBe(true);
        const url = (result as { data: { url: string } }).data.url;
        expect(url.startsWith("app://fs/")).toBe(true);

        const first = await protocolHandler.handle(request(url));
        expect(first.statusCode).toBe(200);
        // Session-lived, because the engine re-fetches the clip whenever its per-scene cache evicts.
        const second = await protocolHandler.handle(request(url));
        expect(second.statusCode).toBe(200);
    });

    it("gives the same URL for the same clip across resolves, so a save survives a restart", async () => {
        const outcome = { paths: new Map([[weatherBakeKey(SPEC), clipPath]]), failures: new Map<string, string>() };
        const first = await new DevModeResolveWeatherClipHandler().handle(makeWindow(outcome), { spec: SPEC, attempt: "bundle:1" });
        const second = await new DevModeResolveWeatherClipHandler().handle(makeWindow(outcome), { spec: SPEC, attempt: "bundle:2" });

        expect((first as { data: { url: string } }).data.url).toBe((second as { data: { url: string } }).data.url);
    });

    it("passes the bake's own sentence back when there is no clip", async () => {
        const outcome = { paths: new Map<string, string>(), failures: new Map([[weatherBakeKey(SPEC), "the bundled ffmpeg is missing"]]) };
        const result = await new DevModeResolveWeatherClipHandler().handle(makeWindow(outcome), { spec: SPEC, attempt: "bundle:1" });

        expect(result).toEqual({ success: false, error: "the bundled ffmpeg is missing" });
    });

    it("asks on behalf of the compile that wants the clip, so a reload can drop it", async () => {
        // Without the compile travelling with the request, an author typing three digits into a
        // density leaves three bakes to run in full: nothing on this side can tell "another row of
        // the same compile" from "a different compile that replaced it".
        const outcome = { paths: new Map([[weatherBakeKey(SPEC), clipPath]]), failures: new Map<string, string>() };
        await new DevModeResolveWeatherClipHandler().handle(makeWindow(outcome), { spec: SPEC, attempt: "bundle:7" });
        const first = asked?.claim;
        await new DevModeResolveWeatherClipHandler().handle(makeWindow(outcome), { spec: SPEC, attempt: "bundle:8" });
        const second = asked?.claim;

        expect(first?.attempt).toBe("bundle:7");
        expect(second?.attempt).toBe("bundle:8");
        // Same session, so the second ask is the same owner changing its mind rather than a stranger.
        expect(second?.owner).toBe(first?.owner);
    });
});
