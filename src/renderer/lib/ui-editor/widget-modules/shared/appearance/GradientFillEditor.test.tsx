// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { BUILTIN_BRAND_COLORS, type BrandColor } from "@shared/types/brand";
import type { GradientFill } from "@shared/types/ui-editor/gradientFill";
import { GradientFillEditor } from "./GradientFillEditor";

/**
 * What the gradient editor must not get wrong.
 *
 * The palette case is the one worth the setup: a brand edit is not a document edit, so a preview
 * memoised on the gradient alone keeps painting the old colours and the defect only shows as
 * "switching tabs fixed it". Everything else here is the model's floor - two stops, sorted - being
 * held by the controls rather than repaired silently afterwards.
 *
 * Whether the swatch reads as the gradient the author meant is a question only a person can answer.
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

/** Flipped by the frozen cases; the rest of the file runs on a writable workspace. */
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

const LINEAR: GradientFill = {
    kind: "linear",
    angle: 180,
    stops: [
        { offset: 0, color: "nlbrand:primary" },
        { offset: 1, color: "#ff0000" },
    ],
};

/** The seeded palette with one entry repointed - an entry is replaced, never shadowed by a second. */
function paletteWith(id: string, value: string): BrandColor[] {
    return BUILTIN_BRAND_COLORS.map((color) => (color.id === id ? { ...color, value } : { ...color }));
}

function mount(fill: GradientFill = LINEAR) {
    const onChange = vi.fn<(next: GradientFill) => void>();
    const view = render(<GradientFillEditor value={fill} onChange={onChange} draftResetKey="test" />);
    return { onChange, view };
}

function trigger(): HTMLElement {
    return screen.getByLabelText("widgetAppearance.gradient.openEditorAria");
}

afterEach(() => {
    cleanup();
    setActiveBrandPalette(BUILTIN_BRAND_COLORS);
    freezeState.frozen = false;
});

describe("GradientFillEditor", () => {
    it("paints the swatch with the shared builder's CSS, not a hand-rolled string", () => {
        setActiveBrandPalette(paletteWith("primary", "#123456"));
        mount();

        // jsdom re-serializes a hex as `rgb(...)`, which is why the colours are asserted that way.
        const css = trigger().style.backgroundImage;
        expect(css).toContain("linear-gradient(180deg");
        expect(css).toContain("rgb(18, 52, 86) 0%");
        expect(css).toContain("100%");
    });

    it("repaints when the palette changes, with no change to its props", () => {
        setActiveBrandPalette(paletteWith("primary", "#123456"));
        mount();
        expect(trigger().style.backgroundImage).toContain("rgb(18, 52, 86)");

        // No re-render is asked for: the document did not move, only `editor/brand.json` did.
        // `act` only flushes the store notification React already scheduled - it is the test
        // harness, not a nudge the component would need in the app.
        act(() => setActiveBrandPalette(paletteWith("primary", "#abcdef")));

        expect(trigger().style.backgroundImage).toContain("rgb(171, 205, 239)");
        expect(trigger().style.backgroundImage).not.toContain("rgb(18, 52, 86)");
    });

    it("opens the panel from the swatch and closes it again", () => {
        mount();
        fireEvent.click(trigger());
        expect(screen.getByLabelText("widgetAppearance.gradient.previewAria")).toBeTruthy();

        fireEvent.click(screen.getByLabelText("widgetAppearance.gradient.closeAria"));
        expect(screen.queryByLabelText("widgetAppearance.gradient.previewAria")).toBeNull();
    });

    it("adds a stop in the widest gap, keeping the list sorted", () => {
        const { onChange } = mount();
        fireEvent.click(trigger());
        fireEvent.click(screen.getByLabelText("widgetAppearance.gradient.addStopAria"));

        const next = onChange.mock.calls[0][0];
        expect(next.stops.map((stop) => stop.offset)).toEqual([0, 0.5, 1]);
        // The new stop takes its neighbour's colour rather than appearing invisible.
        expect(next.stops[1].color).toBe("nlbrand:primary");
    });

    it("refuses the removal that would leave one stop", () => {
        mount();
        fireEvent.click(trigger());
        const remove = screen.getByLabelText("widgetAppearance.gradient.stopRemoveAria(1)") as HTMLButtonElement;
        expect(remove.disabled).toBe(true);
    });

    it("removes a stop once there are more than two", () => {
        const { onChange } = mount({
            ...LINEAR,
            stops: [
                { offset: 0, color: "#000000" },
                { offset: 0.5, color: "#888888" },
                { offset: 1, color: "#ffffff" },
            ],
        });
        fireEvent.click(trigger());
        fireEvent.click(screen.getByLabelText("widgetAppearance.gradient.stopRemoveAria(2)"));

        expect(onChange.mock.calls[0][0].stops).toEqual([
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
        ]);
    });

    it("reorders by trading offsets, so the change survives a read from disk", () => {
        const { onChange } = mount({
            ...LINEAR,
            stops: [
                { offset: 0.2, color: "#000000" },
                { offset: 0.7, color: "#ffffff" },
            ],
        });
        fireEvent.click(trigger());
        fireEvent.keyDown(screen.getByLabelText("widgetAppearance.gradient.stopReorderAria(2)"), {
            key: "ArrowUp",
        });

        // Sorted by offset either way - which is the point: nothing here relies on array order
        // surviving `normalizeGradientFill`.
        expect(onChange.mock.calls[0][0].stops).toEqual([
            { offset: 0.2, color: "#ffffff" },
            { offset: 0.7, color: "#000000" },
        ]);
    });

    /**
     * The handle carries the reorder the two carets used to, and they were keyboard-reachable.
     * A drag-only handle would have been a quiet regression for anyone not holding a mouse, so the
     * arrow keys are asserted here rather than trusted: the drag itself is a pointer gesture that a
     * synthetic event cannot honestly stand in for.
     */
    it("reorders from the keyboard, and refuses to move off either end", () => {
        const { onChange } = mount({
            ...LINEAR,
            stops: [
                { offset: 0.2, color: "#000000" },
                { offset: 0.5, color: "#888888" },
                { offset: 0.7, color: "#ffffff" },
            ],
        });
        fireEvent.click(trigger());
        const handle = (index: number) =>
            screen.getByLabelText(`widgetAppearance.gradient.stopReorderAria(${index})`);

        fireEvent.keyDown(handle(1), { key: "ArrowDown" });
        expect(onChange.mock.calls[0][0].stops).toEqual([
            { offset: 0.2, color: "#888888" },
            { offset: 0.5, color: "#000000" },
            { offset: 0.7, color: "#ffffff" },
        ]);

        // The ends are refused in the handler rather than written and sorted back, so a held key
        // at the top of the list does not spend an undo step per press.
        fireEvent.keyDown(handle(1), { key: "ArrowUp" });
        fireEvent.keyDown(handle(3), { key: "ArrowDown" });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("names the handle as a reorder, never as a step on the percentage beside it", () => {
        mount();
        fireEvent.click(trigger());
        // The carets that used to sit here read as a spinner for the position field next to them.
        expect(screen.queryByLabelText("widgetAppearance.gradient.stopMoveEarlierAria(1)")).toBeNull();
        expect(screen.getByLabelText("widgetAppearance.gradient.stopReorderAria(1)")).toBeTruthy();
    });

    it("offers only the geometry each kind can paint", () => {
        const { view } = mount();
        fireEvent.click(trigger());
        expect(screen.queryByLabelText("widgetAppearance.gradient.angle")).toBeTruthy();
        expect(screen.queryByLabelText("widgetAppearance.gradient.centerXAria")).toBeNull();
        expect(screen.queryByLabelText("widgetAppearance.gradient.radiusXAria")).toBeNull();

        view.rerender(
            <GradientFillEditor
                value={{ ...LINEAR, kind: "radial" }}
                onChange={() => {}}
                draftResetKey="test"
            />,
        );
        expect(screen.queryByLabelText("widgetAppearance.gradient.angle")).toBeNull();
        expect(screen.queryByLabelText("widgetAppearance.gradient.centerXAria")).toBeTruthy();
        expect(screen.queryByLabelText("widgetAppearance.gradient.radiusXAria")).toBeTruthy();

        view.rerender(
            <GradientFillEditor
                value={{ ...LINEAR, kind: "conic" }}
                onChange={() => {}}
                draftResetKey="test"
            />,
        );
        expect(screen.queryByLabelText("widgetAppearance.gradient.angle")).toBeTruthy();
        expect(screen.queryByLabelText("widgetAppearance.gradient.centerXAria")).toBeTruthy();
        expect(screen.queryByLabelText("widgetAppearance.gradient.radiusXAria")).toBeNull();
    });

    it("writes a stop's colour through the shared colour serializer, brand link and all", () => {
        const { onChange } = mount();
        fireEvent.click(trigger());
        fireEvent.change(screen.getByLabelText("widgetAppearance.gradient.stopOffsetAria(1)"), {
            target: { value: "40" },
        });

        expect(onChange.mock.calls[0][0].stops[0]).toEqual({ offset: 0.4, color: "nlbrand:primary" });
    });

    /**
     * The panel is portalled into the window's overlay host, so no clamp an ancestor puts around
     * this field reaches it. Both halves are asserted here: it still opens, because reading a
     * gradient's stops is why a frozen project is being looked at, and nothing inside it writes.
     */
    describe("frozen", () => {
        it("still opens from inside the clamp the inspector puts around the field", () => {
            const onChange = vi.fn<(next: GradientFill) => void>();
            render(
                // The properties framework's own structural clamp, which is a plain disabled
                // fieldset - a `<button>` trigger inside one cannot be pressed at all.
                <fieldset disabled>
                    <GradientFillEditor value={LINEAR} onChange={onChange} draftResetKey="test" />
                </fieldset>,
            );

            fireEvent.click(trigger());

            expect(screen.getByLabelText("widgetAppearance.gradient.previewAria")).toBeTruthy();
        });

        it("carries its own clamp, so every control in the portalled panel is off", () => {
            freezeState.frozen = true;
            mount();
            fireEvent.click(trigger());

            // `:disabled` rather than the `disabled` property: a control inside a disabled fieldset
            // matches the pseudo-class while its own attribute stays false. Asserted rather than
            // firing an event at the control, because a synthetic `change` reaches a disabled input
            // in jsdom - it is the browser, not the DOM, that stops the author reaching one.
            expect(screen.getByLabelText("widgetAppearance.gradient.stopOffsetAria(1)").matches(":disabled")).toBe(true);
            expect(screen.getByLabelText("widgetAppearance.gradient.addStopAria").matches(":disabled")).toBe(true);
            expect(screen.getByLabelText("widgetAppearance.gradient.stopReorderAria(1)").matches(":disabled")).toBe(true);
            expect(screen.getByLabelText("widgetAppearance.gradient.stopRemoveAria(1)").matches(":disabled")).toBe(true);
            expect(screen.getByLabelText("widgetAppearance.gradient.angle").matches(":disabled")).toBe(true);
        });

        it("leaves the kind readable, because a disabled select hides the kinds it could have been", () => {
            freezeState.frozen = true;
            const { onChange } = mount();
            fireEvent.click(trigger());

            // `Select`'s `readOnly` arm draws a span trigger, which is also what carries it out of
            // the clamp above: the rows open and none of them commits.
            const kind = screen.getByLabelText("widgetAppearance.gradient.kind");
            expect(kind.matches(":disabled")).toBe(false);

            fireEvent.click(kind);
            fireEvent.click(screen.getByText("widgetAppearance.gradient.kindRadial"));

            expect(onChange).not.toHaveBeenCalled();
        });

        it("keeps the close button live, so the panel can still be dismissed", () => {
            freezeState.frozen = true;
            mount();
            fireEvent.click(trigger());

            fireEvent.click(screen.getByLabelText("widgetAppearance.gradient.closeAria"));

            expect(screen.queryByLabelText("widgetAppearance.gradient.previewAria")).toBeNull();
        });
    });
});
