// @vitest-environment jsdom
/**
 * The mark on an asset that will not play doubles as the button that fixes it, and two different
 * states of the workspace can take that fix away: a freeze, which refuses the write that swaps the
 * bytes, and a distrusted project, for which main refuses the converter itself.
 *
 * Both are asserted here because the two must not be confused for each other: they are switched off
 * the same way, but they say different sentences and end at different times, and a control that
 * blamed the freeze for a refusal that outlives it would send the author to the wrong control.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetSupportRecord } from "@/lib/workspace/services/media/mediaAssetSupport";
import { AssetSupportBadge } from "./AssetSupportBadge";

/** Flipped per case; read by the mocked hooks below. */
let frozen = false;
let distrusted = false;
const FREEZE_REASON = "frozen-reason";
const DISTRUST_REASON = "distrust-reason";

// Keys, not prose: what is asserted is which control is off and which sentence it carries, and
// English wording is free to change without this file having an opinion.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        tn: (key: string, count: number) => `${key}:${count}`,
        locale: "en",
    }),
}));

// Both real hooks read workspace services through a provider this test has no business standing
// up, so the decisions are supplied directly - the same ones those services would produce.
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(frozen, FREEZE_REASON) };
});

vi.mock("@/apps/workspace/hooks/useProjectDistrusted", () => ({
    useProjectDistrusted: () => distrusted,
    useProjectDistrustedReason: () => DISTRUST_REASON,
}));

/** A file the scan can name a conversion for - the state that draws the button. */
const CONVERTIBLE = { state: "convertible", target: "png" } as unknown as MediaAssetSupportRecord;
/** A file nothing can be done about, which is a plain mark rather than a control. */
const UNPLAYABLE = { state: "unplayable" } as unknown as MediaAssetSupportRecord;

afterEach(() => {
    cleanup();
    frozen = false;
    distrusted = false;
});

function convertButton(): HTMLElement {
    return screen.getByRole("button", { name: /assets\.support\.needsConverting/ });
}

describe("AssetSupportBadge", () => {
    it("offers the conversion in an ordinary workspace", () => {
        const onConvert = vi.fn();
        render(<AssetSupportBadge record={CONVERTIBLE} onConvert={onConvert} />);

        // `:disabled` rather than `.disabled`: a control switched off by an ancestor `fieldset`
        // reports `.disabled === false`, so the property is the wrong question everywhere.
        expect(convertButton().matches(":disabled")).toBe(false);
        expect(convertButton().getAttribute("data-tip")).toBe("assets.support.needsConvertingHint");
        fireEvent.click(convertButton());
        expect(onConvert).toHaveBeenCalledTimes(1);
    });

    it("switches the conversion off for a distrusted project, and says which way out", () => {
        distrusted = true;
        const onConvert = vi.fn();
        render(<AssetSupportBadge record={CONVERTIBLE} onConvert={onConvert} />);

        expect(convertButton().matches(":disabled")).toBe(true);
        expect(convertButton().getAttribute("data-tip")).toBe(DISTRUST_REASON);
        fireEvent.click(convertButton());
        expect(onConvert).not.toHaveBeenCalled();
    });

    it("still marks the file, because distrust governs running things rather than reading them", () => {
        distrusted = true;
        render(<AssetSupportBadge record={CONVERTIBLE} onConvert={() => undefined} />);

        expect(screen.getByText("assets.support.needsConverting")).not.toBeNull();
    });

    it("keeps the freeze's own sentence when that is what applies", () => {
        frozen = true;
        render(<AssetSupportBadge record={CONVERTIBLE} onConvert={() => undefined} />);

        expect(convertButton().matches(":disabled")).toBe(true);
        expect(convertButton().getAttribute("data-tip")).toBe(FREEZE_REASON);
    });

    it("leaves a file nothing can be done about as a plain mark", () => {
        distrusted = true;
        render(<AssetSupportBadge record={UNPLAYABLE} />);

        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.getByText("assets.support.notPlayable")).not.toBeNull();
    });
});
