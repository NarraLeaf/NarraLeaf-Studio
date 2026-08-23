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

describe("installScreenWakeLock", () => {
    it("asks for the lock on a visible page", async () => {
        const fake = fakeHost();
        installScreenWakeLock(fake.host);
        await Promise.resolve();
        expect(fake.grants()).toBe(1);
    });

    it("waits until a page that starts hidden is looked at", async () => {
        const fake = fakeHost();
        fake.setVisible(false);
        installScreenWakeLock(fake.host);
        await Promise.resolve();
        expect(fake.grants()).toBe(0);
        fake.setVisible(true);
        await Promise.resolve();
        expect(fake.grants()).toBe(1);
    });

    it("releases when the tab is hidden and asks again when it comes back", async () => {
        const fake = fakeHost();
        installScreenWakeLock(fake.host);
        await Promise.resolve();
        fake.setVisible(false);
        await Promise.resolve();
        expect(fake.released).toEqual([1]);
        fake.setVisible(true);
        await Promise.resolve();
        expect(fake.grants()).toBe(2);
    });

    it("drops a lock granted after the tab went away", async () => {
        const fake = fakeHost();
        installScreenWakeLock(fake.host);
        fake.setVisible(false);
        await Promise.resolve();
        await Promise.resolve();
        expect(fake.released).toEqual([1]);
    });

    it("stays silent in a browser without the API", () => {
        const fake = fakeHost({ request: null });
        installScreenWakeLock(fake.host);
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
        installScreenWakeLock(fake.host);
        await Promise.resolve();
        await Promise.resolve();
        fake.setVisible(false);
        fake.setVisible(true);
        await Promise.resolve();
        expect(attempts).toBe(1);
        expect(fake.warned).toHaveLength(1);
        expect(fake.warned[0]).toContain("not allowed");
    });
});
