import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppWindow } from "../appWindow";

const mockElectron = vi.hoisted(() => {
    type RequestListener = (details: { url: string; webContentsId: number }, callback: (result: { cancel: boolean }) => void) => void;
    let listener: RequestListener | undefined;
    let nextId = 0;
    let arrivals = 0;
    const blockedRequests: boolean[] = [];
    let release: (() => void) | undefined;
    let bothReady = new Promise<void>(resolve => { release = resolve; });
    const printSession = { webRequest: { onBeforeRequest: (next: RequestListener) => { listener = next; } } };
    class BrowserWindow {
        readonly webContents = {
            id: ++nextId,
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
            printToPDF: vi.fn(async () => Buffer.from("pdf")),
        };
        async loadURL(url: string) {
            arrivals += 1;
            if (arrivals === 2) release?.();
            await bothReady;
            let canceled = true;
            listener?.({ url, webContentsId: this.webContents.id }, result => { canceled = result.cancel; });
            if (canceled) throw new Error("print page was blocked");
            listener?.({ url: "https://example.com/image.png", webContentsId: this.webContents.id }, result => { blockedRequests.push(result.cancel); });
        }
        isDestroyed() { return false; }
        destroy() {}
    }
    return {
        BrowserWindow,
        session: { fromPartition: () => printSession },
        blockedRequests,
        reset() {
            listener = undefined;
            nextId = 0;
            arrivals = 0;
            blockedRequests.length = 0;
            bothReady = new Promise<void>(resolve => { release = resolve; });
        },
    };
});

vi.mock("electron", () => ({ BrowserWindow: mockElectron.BrowserWindow, session: mockElectron.session }));
const { ManuscriptPrintPdfHandler } = await import("./manuscriptAction");

let tempDir: string;
beforeEach(async () => {
    mockElectron.reset();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-print-handler-"));
});
afterEach(async () => { await fs.rm(tempDir, { recursive: true, force: true }); });

it("prints two manuscripts concurrently without replacing each other's page filter", async () => {
    const window = { app: { storageManager: { isPathAllowed: async () => true } } } as unknown as AppWindow;
    const handler = new ManuscriptPrintPdfHandler();
    const outputs = [path.join(tempDir, "a.pdf"), path.join(tempDir, "b.pdf")];
    const results = await Promise.all(outputs.map(output => handler.handle(window, {
        path: output,
        html: "<p>Story</p>",
        footerHtml: "<span></span>",
    })));

    expect(results.map(result => result.success)).toEqual([true, true]);
    expect(mockElectron.blockedRequests).toEqual([true, true]);
    await Promise.all(outputs.map(output => expect(fs.readFile(output, "utf8")).resolves.toBe("pdf")));
});
