// @vitest-environment jsdom
/**
 * The press a page's exit guard takes goes no further up.
 *
 * While a page or layer plays its exit, `SurfaceStackBox` lays a sheet under every layer so a press
 * no page takes never reaches the game stage and turns into the next line. Receiving the press is
 * only half of that. The game's drawing root, further up, offers every press that reaches it to the
 * global blueprint, so a press the sheet only received would still bubble there and could still be
 * answered as "click advances" or "right click opens the menu" in a project that says so. These pin
 * that the guard ends every kind of press it takes, and that nothing is ended once nothing is leaving.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_TOUCH_GESTURE_EVENT } from "@/lib/ui-editor/runtime/input/touchGesture";
import { SurfaceStackBox, useReportLeavingSurface } from "./SurfaceStackBox";

afterEach(cleanup);

/** A layer that says whether it is playing its exit, as `AppSurfaceLayer` does. */
function Layer(props: { leaving: boolean }) {
    useReportLeavingSurface("page", props.leaving);
    return <div data-testid="page-content" />;
}

/** The game's drawing root, listening for what bubbles up to it the way it does for the global blueprint. */
function renderUnderRoot(leaving: boolean) {
    const heard: string[] = [];
    const hear = (event: { type: string }) => heard.push(event.type);
    const view = render(
        <div
            data-testid="root"
            onClick={hear}
            onDoubleClick={hear}
            onAuxClick={hear}
            onContextMenu={hear}
            onWheel={hear}
            onPointerDown={hear}
            onPointerUp={hear}
        >
            <SurfaceStackBox>
                <Layer leaving={leaving} />
            </SurfaceStackBox>
        </div>,
    );
    const root = view.getByTestId("root");
    root.addEventListener(UI_TOUCH_GESTURE_EVENT, hear);
    return { view, heard };
}

function guard(): HTMLElement | null {
    return document.querySelector("[data-ui-surface-stack-exit-guard]");
}

describe("the exit guard of a game app's page stack", () => {
    it("ends every press it takes, so the global blueprint never hears one during an exit", () => {
        const { heard } = renderUnderRoot(true);
        const sheet = guard();
        expect(sheet).not.toBeNull();

        fireEvent.pointerDown(sheet!);
        fireEvent.pointerUp(sheet!);
        fireEvent.click(sheet!);
        fireEvent.doubleClick(sheet!);
        fireEvent(sheet!, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
        fireEvent.wheel(sheet!, { deltaY: 100 });
        const menuStillOpens = fireEvent.contextMenu(sheet!);
        sheet!.dispatchEvent(new Event(UI_TOUCH_GESTURE_EVENT, { bubbles: true }));

        expect(heard).toEqual([]);
        // Nothing further up answers the right click, so the browser's own menu is kept away too.
        expect(menuStillOpens).toBe(false);
    });

    it("comes down with the exit, and a press reaches the root as it did before", () => {
        const { view, heard } = renderUnderRoot(true);
        expect(guard()).not.toBeNull();

        view.rerender(
            <div data-testid="root">
                <SurfaceStackBox>
                    <Layer leaving={false} />
                </SurfaceStackBox>
            </div>,
        );
        expect(guard()).toBeNull();

        const listener = vi.fn();
        view.getByTestId("root").addEventListener("click", listener);
        fireEvent.click(view.getByTestId("page-content"));
        expect(listener).toHaveBeenCalledTimes(1);
        expect(heard).toEqual([]);
    });
});
