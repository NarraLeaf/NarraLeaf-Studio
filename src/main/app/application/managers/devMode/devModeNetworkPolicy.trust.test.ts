import { beforeEach, describe, expect, it, vi } from "vitest";

type BeforeRequest = (
    details: { webContentsId?: number; url: string },
    callback: (response: { cancel?: boolean }) => void,
) => void;

const hooks: { beforeRequest?: BeforeRequest } = {};

const defaultSession = {
    webRequest: {
        onBeforeRequest: (_filter: unknown, handler: BeforeRequest) => {
            hooks.beforeRequest = handler;
        },
        onHeadersReceived: vi.fn(),
    },
};

vi.mock("electron", () => ({ session: { defaultSession } }));

const { devModeNetworkPolicy } = await import("./devModeNetworkPolicy");

/** Ask the registered hook what it does with one request from one window. */
function requestFrom(webContentsId: number, url = "https://example.test/beacon"): boolean {
    let cancelled = false;
    hooks.beforeRequest?.({ webContentsId, url }, response => {
        cancelled = response.cancel === true;
    });
    return cancelled;
}

/**
 * The network side of project trust: a window opened on a distrusted project reaches nothing remote.
 *
 * These drive the real `onBeforeRequest` hook rather than a predicate, because the hook is the whole
 * mechanism - Electron keeps exactly **one** listener per session, so the Dev Mode preview policy and
 * this share it. A second registration would silently replace the first, and the two cases below
 * would still pass if this were tested as a pure function.
 */
describe("cutting a distrusted project's window off from the network", () => {
    beforeEach(() => {
        devModeNetworkPolicy.releaseDistrusted(701);
        devModeNetworkPolicy.releaseDistrusted(702);
    });

    it("cancels a remote request from a blocked window and leaves other windows alone", () => {
        devModeNetworkPolicy.blockDistrusted(701);

        expect(requestFrom(701)).toBe(true);
        // The workspace, launcher and settings windows share this session. Blocking by window is the
        // only reason installing the hook at all is safe.
        expect(requestFrom(702)).toBe(false);
    });

    it("stops cancelling once the window is gone", () => {
        devModeNetworkPolicy.blockDistrusted(701);
        expect(requestFrom(701)).toBe(true);

        devModeNetworkPolicy.releaseDistrusted(701);
        expect(requestFrom(701)).toBe(false);
    });

    it("does not disturb the preview policy that shares the hook", () => {
        // A preview allowed the whole network passes, and stays passing while another window is
        // blocked - the two are separate entries answered by one listener.
        devModeNetworkPolicy.apply(702, { allowHttp: true, allowlist: undefined });
        devModeNetworkPolicy.blockDistrusted(701);

        expect(requestFrom(702)).toBe(false);
        expect(requestFrom(701)).toBe(true);
        devModeNetworkPolicy.release(702);
    });
});
