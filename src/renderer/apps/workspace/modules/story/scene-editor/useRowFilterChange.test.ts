// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRowFilterChange } from "./useRowFilterChange";

/**
 * A story tab re-places its page when the row filter changes. It used to do it whenever the tab was
 * shown as well, so going back to a tab scrolled it to its selected row, wherever the author had left it.
 */
describe("useRowFilterChange", () => {
    const render = (active: boolean, filter: object, apply: () => void) =>
        renderHook(props => useRowFilterChange(props.active, props.filter, props.apply), {
            initialProps: { active, filter, apply },
        });

    it("does nothing when the tab mounts", () => {
        const apply = vi.fn();
        render(true, {}, apply);
        expect(apply).not.toHaveBeenCalled();
    });

    it("does nothing when the tab is shown again with the same filter", () => {
        const apply = vi.fn();
        const filter = {};
        const hook = render(true, filter, apply);
        hook.rerender({ active: false, filter, apply });
        hook.rerender({ active: true, filter, apply });
        expect(apply).not.toHaveBeenCalled();
    });

    it("applies a filter change on a showing tab", () => {
        const apply = vi.fn();
        const hook = render(true, {}, apply);
        hook.rerender({ active: true, filter: {}, apply });
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it("applies a filter changed while the tab was hidden once it is shown, and only once", () => {
        const apply = vi.fn();
        const hook = render(true, {}, apply);
        const changed = {};
        hook.rerender({ active: false, filter: changed, apply });
        expect(apply).not.toHaveBeenCalled();
        hook.rerender({ active: true, filter: changed, apply });
        expect(apply).toHaveBeenCalledTimes(1);
        hook.rerender({ active: false, filter: changed, apply });
        hook.rerender({ active: true, filter: changed, apply });
        expect(apply).toHaveBeenCalledTimes(1);
    });
});
