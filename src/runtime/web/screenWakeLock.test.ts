import { describe, expect, it } from "vitest";
import {
    installScreenWakeLock,
    type ScreenWakeLockHost,
    type ScreenWakeLockSentinel,
} from "./screenWakeLock";

function fakeHost(overrides: Partial<ScreenWakeLockHost> = {}) {
    const warned: string[] = [];
    const released: number[] = [];
    let listener: (() => void) | null = null;
    let visible = true;
    let granted = 0;
    const host: ScreenWakeLockHost = {
        request: async (): Promise<ScreenWakeLockSentinel> => {
            granted += 1;
            const id = granted;
            return { release: async () => { released.push(id); } };
        },
        isVisible: () => visible,
        onVisibilityChange: next => { listener = next; },
        warn: message => { warned.push(message); },
        ...overrides,
    };
    return {
        host,
        warned,
        released,
        grants: () => granted,
        setVisible: (next: boolean) => {
            visible = next;
            listener?.();
        },
    };
}

/** Two turns: the request itself, and the check that follows it. */
async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("installScreenWakeLock", () => {
    it("asks for nothing until the game does", async () => {
        const fake = fakeHost();
        const keeper = installScreenWakeLock(fake.host);
        await settle();
        expect(fake.grants()).toBe(0);
        keeper.setRequested(true);
        await settle();
        expect(fake.grants()).toBe(1);
    });

    it("releases when the game stops asking", async () => {
        const fake = fakeHost();
        const keeper = installScreenWakeLock(fake.host);
        keeper.setRequested(true);
        await settle();
        keeper.setRequested(false);
        await settle();
        expect(fake.released).toEqual([1]);
    });

    it("waits until a page that starts hidden is looked at", async () => {
        const fake = fakeHost();
        fake.setVisible(false);
        const keeper = installScreenWakeLock(fake.host);
        keeper.setRequested(true);
        await settle();
        expect(fake.grants()).toBe(0);
        fake.setVisible(true);
        await settle();
        expect(fake.grants()).toBe(1);
    });

    it("releases when the tab is hidden and asks again when it comes back", async () => {
        const fake = fakeHost();
        const keeper = installScreenWakeLock(fake.host);
        keeper.setRequested(true);
        await settle();
        fake.setVisible(false);
        await settle();
        expect(fake.released).toEqual([1]);
        fake.setVisible(true);
        await settle();
        expect(fake.grants()).toBe(2);
    });

    it("drops a lock granted after the story stopped moving", async () => {
        const fake = fakeHost();
        const keeper = installScreenWakeLock(fake.host);
        keeper.setRequested(true);
        keeper.setRequested(false);
        await settle();
        expect(fake.released).toEqual([1]);
    });

    it("stays silent in a browser without the API", async () => {
        const fake = fakeHost({ request: null });
        installScreenWakeLock(fake.host).setRequested(true);
        await settle();
        expect(fake.warned).toEqual([]);
        expect(fake.grants()).toBe(0);
    });

    it("reports a refusal once, then stops asking", async () => {
        let attempts = 0;
        const fake = fakeHost({
            request: async () => {
                attempts += 1;
                throw new Error("not allowed");
            },
        });
        const keeper = installScreenWakeLock(fake.host);
        keeper.setRequested(true);
        await settle();
        fake.setVisible(false);
        fake.setVisible(true);
        await settle();
        expect(attempts).toBe(1);
        expect(fake.warned).toHaveLength(1);
        expect(fake.warned[0]).toContain("not allowed");
    });
});
