// @vitest-environment jsdom
/**
 * The import strip is the one import control in the assets panel that outlives the gesture behind
 * it: its failure list stays on screen until the author dismisses it, so a workspace that froze
 * after a drop still drew a Retry that would copy files the library then refuses.
 *
 * Both directions are asserted, because the strip has to stay useful while frozen: Retry goes off,
 * and Dismiss - which only clears a list of file names - does not.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { ImportQueueState } from "../state/useImportQueue";
import { ImportQueueStrip } from "./ImportQueueStrip";

/** Flipped per case; read by the mocked hook below. */
let frozen = false;
const FREEZE_REASON = "frozen-reason";

// Keys, not prose: what is asserted is which control is off, and English wording is free to change
// without this file having an opinion.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        tn: (key: string, count: number) => `${key}:${count}`,
        locale: "en",
    }),
}));

// The real hook reads the workspace freeze service through a provider this test has no business
// standing up, so the decision is supplied directly - the same decision the service would produce.
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(frozen, FREEZE_REASON) };
});

/** A finished run that left two files behind - the state the strip keeps until it is dismissed. */
const FAILED: ImportQueueState = {
    running: false,
    run: { category: AssetCategory.Image, total: 2 },
    completed: 2,
    failures: [
        { path: "/art/hero.png", error: "unreadable" },
        { path: "/art/villain.png" },
    ],
};

afterEach(() => {
    cleanup();
    frozen = false;
});

function retryButton(): HTMLElement {
    return screen.getByRole("button", { name: /assets\.import\.retry/ });
}

describe("ImportQueueStrip while the workspace is frozen", () => {
    it("offers the retry when nothing is frozen", () => {
        const onRetry = vi.fn();
        render(<ImportQueueStrip state={FAILED} onRetry={onRetry} onDismiss={() => undefined} />);

        // `:disabled` rather than `.disabled`: a control switched off by an ancestor `fieldset`
        // reports `.disabled === false`, so the property is the wrong question everywhere.
        expect(retryButton().matches(":disabled")).toBe(false);
        fireEvent.click(retryButton());
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("switches the retry off and says why", () => {
        frozen = true;
        const onRetry = vi.fn();
        render(<ImportQueueStrip state={FAILED} onRetry={onRetry} onDismiss={() => undefined} />);

        const retry = retryButton();
        expect(retry.matches(":disabled")).toBe(true);
        expect(retry.getAttribute("data-tip")).toBe(FREEZE_REASON);
        fireEvent.click(retry);
        expect(onRetry).not.toHaveBeenCalled();
    });

    it("leaves dismiss alone, because clearing the list is not a write", () => {
        frozen = true;
        const onDismiss = vi.fn();
        render(<ImportQueueStrip state={FAILED} onRetry={() => undefined} onDismiss={onDismiss} />);

        const dismiss = screen.getByRole("button", { name: "common.close" });
        expect(dismiss.matches(":disabled")).toBe(false);
        fireEvent.click(dismiss);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("still names every file that failed, which is what the author came to read", () => {
        frozen = true;
        render(<ImportQueueStrip state={FAILED} onRetry={() => undefined} onDismiss={() => undefined} />);

        expect(screen.getByText("hero.png")).not.toBeNull();
        expect(screen.getByText("villain.png")).not.toBeNull();
    });
});
