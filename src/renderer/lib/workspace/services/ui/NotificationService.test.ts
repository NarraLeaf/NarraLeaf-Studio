import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationService } from "./NotificationService";
import { UIStore } from "./UIStore";
import { NotificationType } from "./types";

describe("NotificationService history", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const raise = (service: NotificationService, message: string, coalesceKey?: string) =>
        service.showSticky({ type: NotificationType.Error, message, detail: "detail", coalesceKey });

    it("keeps every notice that names no key, however alike", () => {
        const service = new NotificationService(new UIStore());
        raise(service, "Could not save the panel layout");
        raise(service, "Could not save the panel layout");

        expect(service.getHistory()).toHaveLength(2);
    });

    it("turns a keyed notice said again into one entry with the latest time and a count", () => {
        const service = new NotificationService(new UIStore());
        const first = raise(service, "Could not save the panel layout", "panel");
        service.close(first);
        raise(service, "Something else");
        service.markHistorySeen();

        vi.advanceTimersByTime(60_000);
        const second = raise(service, "Could not save the panel layout", "panel");

        const history = service.getHistory();
        expect(history).toHaveLength(2);
        // Back on top, said twice, at the second time, and unread again.
        expect(history[0]).toMatchObject({
            message: "Could not save the panel layout",
            count: 2,
            read: false,
            timestamp: Date.parse("2026-10-02T12:01:00Z"),
        });
        expect(history[1]!.message).toBe("Something else");
        expect(service.getUnreadCount()).toBe(1);
        // The first card was closed, so the second time puts up a card of its own.
        expect(service.getAll().filter(card => card.coalesceKey === "panel").map(card => card.id)).toEqual([second]);
    });

    it("says it again in place while the first card is still up", () => {
        const service = new NotificationService(new UIStore());
        const first = raise(service, "Could not save the panel layout", "panel");
        const second = raise(service, "Could not save the panel layout", "panel");

        expect(second).toBe(first);
        expect(service.getAll()).toHaveLength(1);
        expect(service.getHistory()).toHaveLength(1);
        expect(service.getHistory()[0]!.count).toBe(2);
    });

    it("finds a restored entry again by its key", () => {
        const service = new NotificationService(new UIStore());
        service.seedHistory([{
            id: "notification-old",
            type: NotificationType.Error,
            message: "Could not save the panel layout",
            detail: "detail",
            timestamp: 1,
            read: true,
            key: "panel",
            count: 3,
        }]);

        raise(service, "Could not save the panel layout", "panel");

        expect(service.getHistory()).toHaveLength(1);
        expect(service.getHistory()[0]).toMatchObject({ id: "notification-old", count: 4, read: false });
    });

    const restored = (id: string, message: string, timestamp: number) => ({
        id,
        type: NotificationType.Info,
        message,
        timestamp,
        read: true,
    });

    it("gives a new notice an id no restored entry has", () => {
        // What the last session wrote: its counter started from 1, as this session's would.
        const service = new NotificationService(new UIStore());
        service.seedHistory([
            restored("notification-3", "Third", 3),
            restored("notification-2", "Second", 2),
            restored("notification-1", "First", 1),
        ]);

        for (let index = 0; index < 4; index += 1) {
            raise(service, `New ${index}`);
        }

        const ids = service.getHistory().map(entry => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(service.getHistory().map(entry => entry.message)).toEqual([
            "New 3", "New 2", "New 1", "New 0", "Third", "Second", "First",
        ]);
    });

    it("tells apart restored entries that were written under one id", () => {
        const service = new NotificationService(new UIStore());
        service.seedHistory([
            restored("notification-2", "Later session, second", 4),
            restored("notification-1", "Later session, first", 3),
            restored("notification-2", "Earlier session, second", 2),
            restored("notification-1", "Earlier session, first", 1),
        ]);

        const history = service.getHistory();
        expect(new Set(history.map(entry => entry.id)).size).toBe(4);
        // The first of each id keeps it; order and content are untouched.
        expect(history.map(entry => entry.id).slice(0, 2)).toEqual(["notification-2", "notification-1"]);
        expect(history.map(entry => entry.message)).toEqual([
            "Later session, second", "Later session, first", "Earlier session, second", "Earlier session, first",
        ]);
    });

    it("does not reuse ids across two sessions of the same project", () => {
        const first = new NotificationService(new UIStore());
        raise(first, "One");
        raise(first, "Two");
        vi.advanceTimersByTime(1);
        const second = new NotificationService(new UIStore());
        second.seedHistory([...first.getHistory()]);
        raise(second, "Three");

        const ids = second.getHistory().map(entry => entry.id);
        expect(new Set(ids).size).toBe(3);
    });
});
