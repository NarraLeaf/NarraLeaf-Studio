// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY } from "@shared/types/blueprint/hostApi";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";

const hooks = vi.hoisted(() => ({ text: "" }));
vi.mock("narraleaf-react", async importOriginal => ({
    ...await importOriginal<typeof import("narraleaf-react")>(),
    useDialog: () => ({ text: hooks.text, done: true, isNarrator: true }),
    useAvatar: () => ({ visible: false, src: null }),
}));

import { DialogStateBridge } from "./DialogStateBridge";

afterEach(cleanup);

describe("dialog state shared by overlapping drawings", () => {
    it("keeps the visible dialog state when another drawing leaves", () => {
        const scopeBridge = new ScopeStoreBridge();
        const core = { scopeBridge } as BlueprintRuntimeCore;
        const flushDialogElements = () => undefined;
        hooks.text = "Earlier line";
        const first = render(<DialogStateBridge core={core} flushDialogElements={flushDialogElements} />);
        hooks.text = "Current line";
        const second = render(<DialogStateBridge core={core} flushDialogElements={flushDialogElements} />);

        first.unmount();
        expect(scopeBridge.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("Current line");

        second.unmount();
        expect(scopeBridge.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("");
    });

    it("restores the remaining drawing when the newest drawing leaves first", () => {
        const scopeBridge = new ScopeStoreBridge();
        const core = { scopeBridge } as BlueprintRuntimeCore;
        const flushDialogElements = () => undefined;
        hooks.text = "Earlier line";
        const first = render(<DialogStateBridge core={core} flushDialogElements={flushDialogElements} />);
        hooks.text = "Current line";
        const second = render(<DialogStateBridge core={core} flushDialogElements={flushDialogElements} />);

        second.unmount();
        expect(scopeBridge.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("Earlier line");

        first.unmount();
        expect(scopeBridge.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("");
    });

    it("keeps the surviving drawing after StrictMode replays its effects", () => {
        const scopeBridge = new ScopeStoreBridge();
        const core = { scopeBridge } as BlueprintRuntimeCore;
        const flushDialogElements = () => undefined;
        hooks.text = "Earlier line";
        const first = render(<StrictMode><DialogStateBridge core={core} flushDialogElements={flushDialogElements} /></StrictMode>);
        hooks.text = "Current line";
        const second = render(<StrictMode><DialogStateBridge core={core} flushDialogElements={flushDialogElements} /></StrictMode>);

        first.unmount();
        expect(scopeBridge.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("Current line");
        second.unmount();
        expect(scopeBridge.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("");
    });

    it("uses the most recently updated drawing when an older update leaves", () => {
        const scopeBridge = new ScopeStoreBridge();
        const core = { scopeBridge } as BlueprintRuntimeCore;
        const flushDialogElements = () => undefined;
        const bridge = <DialogStateBridge core={core} flushDialogElements={flushDialogElements} />;
        hooks.text = "First";
        const first = render(bridge);
        hooks.text = "Second";
        const second = render(bridge);
        hooks.text = "First updated";
        first.rerender(<DialogStateBridge core={core} flushDialogElements={flushDialogElements} />);

        second.unmount();
        expect(scopeBridge.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("First updated");
    });

    it("keeps each core's surviving drawing when a bridge switches cores", () => {
        const firstStore = new ScopeStoreBridge();
        const secondStore = new ScopeStoreBridge();
        const firstCore = { scopeBridge: firstStore } as BlueprintRuntimeCore;
        const secondCore = { scopeBridge: secondStore } as BlueprintRuntimeCore;
        const flushDialogElements = () => undefined;
        hooks.text = "First";
        const first = render(<DialogStateBridge core={firstCore} flushDialogElements={flushDialogElements} />);
        hooks.text = "Second";
        const second = render(<DialogStateBridge core={firstCore} flushDialogElements={flushDialogElements} />);

        hooks.text = "New core";
        second.rerender(<DialogStateBridge core={secondCore} flushDialogElements={flushDialogElements} />);
        expect(firstStore.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("First");
        expect(secondStore.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("New core");
        first.unmount();
        expect(secondStore.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("New core");
        second.unmount();
        expect(secondStore.globalGet(BLUEPRINT_GAME_DIALOG_TEXT_STATE_KEY)).toBe("");
    });
});
