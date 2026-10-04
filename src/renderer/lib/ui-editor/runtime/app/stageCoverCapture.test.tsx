// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStageCoverCapture } from "./stageCoverCapture";

/**
 * A save written under a page keeps the screen the player left: the picture is taken as the page
 * opens, and the stage's Game UI stays where it is until it has been taken.
 */

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

afterEach(() => {
    vi.useRealTimers();
});

describe("the picture a page opened over the game keeps", () => {
    it("holds the Game UI on the stage while the picture is taken, once, and hands that picture to every save after", async () => {
        const taking = deferred<string>();
        const capture = vi.fn(() => taking.promise);
        const { result, rerender } = renderHook(({ covered }) => useStageCoverCapture({ covered, capture }), {
            initialProps: { covered: false },
            wrapper: strict,
        });
        expect(result.current.concealed).toBe(false);
        expect(result.current.readPicture()).toBeNull();

        rerender({ covered: true });
        // Covered, but the dialogue box and the quick menu are still on the stage being pictured.
        expect(result.current.concealed).toBe(false);
        // One picture per page opened, StrictMode's second effect run included.
        expect(capture).toHaveBeenCalledTimes(1);

        await act(async () => {
            taking.resolve("data:image/png;base64,AAAA");
            await taking.promise;
        });
        expect(result.current.concealed).toBe(true);
        await expect(result.current.readPicture()).resolves.toBe("data:image/png;base64,AAAA");
        await expect(result.current.readPicture()).resolves.toBe("data:image/png;base64,AAAA");
    });

    it("forgets the picture when the page closes, and takes a new one for the next page", async () => {
        let n = 0;
        const capture = vi.fn(async () => `picture-${++n}`);
        const { result, rerender } = renderHook(({ covered }) => useStageCoverCapture({ covered, capture }), {
            initialProps: { covered: false },
        });

        await act(async () => rerender({ covered: true }));
        await expect(result.current.readPicture()).resolves.toBe("picture-1");

        await act(async () => rerender({ covered: false }));
        expect(result.current.concealed).toBe(false);
        expect(result.current.readPicture()).toBeNull();

        await act(async () => rerender({ covered: true }));
        await expect(result.current.readPicture()).resolves.toBe("picture-2");
    });

    it("steps the Game UI off at once when there is no game to picture", () => {
        const { result, rerender } = renderHook(({ covered }) => useStageCoverCapture({ covered, capture: () => null }), {
            initialProps: { covered: false },
        });

        rerender({ covered: true });

        expect(result.current.concealed).toBe(true);
        expect(result.current.readPicture()).toBeNull();
    });

    it("answers null for a picture that could not be taken, so a save takes one of its own", async () => {
        const { result, rerender } = renderHook(
            ({ covered }) => useStageCoverCapture({ covered, capture: () => Promise.reject(new Error("no screenshots")) }),
            { initialProps: { covered: false } },
        );

        await act(async () => rerender({ covered: true }));

        expect(result.current.concealed).toBe(true);
        await expect(result.current.readPicture()).resolves.toBeNull();
    });

    it("stops waiting for a stalled picture, and still uses it when it arrives", async () => {
        vi.useFakeTimers();
        const taking = deferred<string>();
        const { result, rerender } = renderHook(
            ({ covered }) => useStageCoverCapture({ covered, capture: () => taking.promise, holdMs: 1000 }),
            { initialProps: { covered: false } },
        );

        rerender({ covered: true });
        expect(result.current.concealed).toBe(false);
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        expect(result.current.concealed).toBe(true);

        const picture = result.current.readPicture();
        taking.resolve("late");
        await expect(picture).resolves.toBe("late");
    });
});
