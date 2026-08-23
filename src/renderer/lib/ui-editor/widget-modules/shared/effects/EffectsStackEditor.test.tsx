// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeElementEffectValues, type VisualEffectKind } from "@shared/types/ui-editor/effects";
import { EffectsStackEditor } from "./EffectsStackEditor";

/**
 * The effects stack's detail panel is anchored to a row and drawn through a portal into
 * `document.body`, which puts it outside the `<fieldset disabled>` the properties framework wraps
 * this field in. The button that opens it is inside that clamp, so a project frozen before the panel
 * opened is safe by construction - but a freeze arrives while the workspace is running, and a panel
 * that was already open kept every control in it live. This is that panel carrying its own clamp.
 */

vi.mock("@/lib/i18n", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}(${Object.values(params).join(",")})` : key,
        has: () => false,
        tn: (key: string) => key,
        locale: "en",
    }),
}));

/** Flipped per test; the writable case is the default every other surface gets. */
const freezeState = vi.hoisted(() => ({ frozen: false }));

// The real guard reads the workspace freeze service through a provider this test has no business
// standing up, and `makeFreezeGuard` is the same decision with the React taken out of it.
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return {
        ...actual,
        useFreezeGuard: () => actual.makeFreezeGuard(freezeState.frozen, "frozen.reason"),
    };
});

const SUPPORTED: readonly VisualEffectKind[] = ["blur", "shadow"];

function mount() {
    const onChange = vi.fn();
    render(
        <EffectsStackEditor
            values={normalizeElementEffectValues({ effectBlur: 4 })}
            onChange={onChange}
            supportedKinds={SUPPORTED}
            draftResetKey="test"
        />,
    );
    return { onChange };
}

/** Open the detail panel of the one enabled effect. */
function openDetail(): void {
    fireEvent.click(screen.getByLabelText("widgetChrome.effects.editEffect"));
}

/**
 * The one control inside the panel, whichever shape the numeric input took - it swaps itself for a
 * popover trigger in a narrow column, and a portalled panel is always narrow.
 *
 * Found through the clamp rather than by role for that reason: the fieldset is the only one on the
 * page, and everything under it is exactly what the clamp is there for.
 */
function detailControl(): HTMLElement {
    const clamp = document.querySelector("fieldset");
    const control = clamp?.querySelector("button, input, select, textarea");
    if (!(control instanceof HTMLElement)) {
        throw new Error("the effect detail panel rendered no control");
    }
    return control;
}

afterEach(() => {
    cleanup();
    freezeState.frozen = false;
});

describe("EffectsStackEditor", () => {
    it("leaves the detail panel live on a writable workspace", () => {
        mount();
        openDetail();

        expect(detailControl().matches(":disabled")).toBe(false);
    });

    it("clamps the portalled detail panel while the workspace is frozen", () => {
        freezeState.frozen = true;
        mount();
        openDetail();

        // `:disabled` rather than the `disabled` property: a control inside a disabled fieldset
        // matches the pseudo-class while its own attribute stays false.
        expect(detailControl().matches(":disabled")).toBe(true);
    });
});
