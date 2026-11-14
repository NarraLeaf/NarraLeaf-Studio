// @vitest-environment jsdom
import { memo, StrictMode, Suspense, useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY } from "@shared/types/blueprint/hostApi";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { createChoiceMenus } from "./choiceMenus";
import type { GameUiSlotHostOptions } from "./StageSlotSurfaceShell";

const engine = vi.hoisted(() => ({
    menu: { evaluated: [] as Array<{ words: unknown[] }>, gameState: {}, choose: () => undefined },
}));

vi.mock("narraleaf-react", async importOriginal => ({
    ...await importOriginal<typeof import("narraleaf-react")>(),
    useUIMenuContext: () => engine.menu,
    GameMenu: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./StageSlotSurfaceShell", () => ({
    collectSurfaceElementIdsByType: () => [],
    useStageSlotSurfaceRuntime: ({ slot }: { slot: number }) => ({
        runtimeScopeId: `choice:${slot}`,
        flushSlotElements: () => undefined,
    }),
    StageSlotSurfaceBody: ({ runtime }: { runtime: { runtimeScopeId: string } }) => (
        <div data-testid="choice" data-scope={runtime.runtimeScopeId} />
    ),
}));

import { ChoiceSlotSurface } from "./ChoiceSlotSurface";

afterEach(cleanup);

const StableChoice = memo(ChoiceSlotSurface);

describe("choice scope ownership under StrictMode", () => {
    it("keeps a mounted menu's slot reserved for a later concurrent menu", () => {
        const choiceMenus = createChoiceMenus();
        const options = { core: null, bundle: { ui: { uidoc: {} } }, host: {} } as unknown as GameUiSlotHostOptions;
        const surface = { id: "choice" } as UIStageSurface;
        const mount = () => render(
            <StrictMode><ChoiceSlotSurface options={options} surface={surface} choiceMenus={choiceMenus} /></StrictMode>,
        );

        const first = mount();
        const second = mount();

        expect(first.container.firstElementChild?.getAttribute("data-scope")).toBe("choice:0");
        expect(second.container.firstElementChild?.getAttribute("data-scope")).toBe("choice:1");
    });

    it("keeps the first scope when another menu mounts in the same tree", () => {
        const choiceMenus = createChoiceMenus();
        const options = { core: null, bundle: { ui: { uidoc: {} } }, host: {} } as unknown as GameUiSlotHostOptions;
        const surface = { id: "choice" } as UIStageSurface;
        function Menus() {
            const [showSecond, setShowSecond] = useState(false);
            return (
                <>
                    <StableChoice options={options} surface={surface} choiceMenus={choiceMenus} />
                    {showSecond ? <ChoiceSlotSurface options={options} surface={surface} choiceMenus={choiceMenus} /> : null}
                    <button onClick={() => setShowSecond(true)}>Open second</button>
                </>
            );
        }

        const view = render(<StrictMode><Menus /></StrictMode>);
        fireEvent.click(view.getByText("Open second"));

        expect(view.getAllByTestId("choice").map(node => node.dataset.scope)).toEqual(["choice:0", "choice:1"]);
    });

    it("assigns different scopes to simultaneous StrictMode drawings and reuses a released scope", () => {
        const choiceMenus = createChoiceMenus();
        const options = { core: null, bundle: { ui: { uidoc: {} } }, host: {} } as unknown as GameUiSlotHostOptions;
        const surface = { id: "choice" } as UIStageSurface;
        const drawing = (key: string) => <ChoiceSlotSurface key={key} options={options} surface={surface} choiceMenus={choiceMenus} />;
        const view = render(<StrictMode>{drawing("a")}{drawing("b")}</StrictMode>);
        expect(view.getAllByTestId("choice").map(node => node.dataset.scope)).toEqual(["choice:0", "choice:1"]);

        view.rerender(<StrictMode>{drawing("b")}{drawing("c")}</StrictMode>);
        expect(view.getAllByTestId("choice").map(node => node.dataset.scope)).toEqual(["choice:1", "choice:0"]);
    });

    it.each(["first", "second"] as const)("retains the other menu's count when the %s drawing leaves", leaving => {
        const choiceMenus = createChoiceMenus();
        const scopeBridge = new ScopeStoreBridge();
        const options = {
            core: { scopeBridge },
            bundle: { ui: { uidoc: {} } },
            host: { widgetRuntimeStore: { setListItems: () => undefined } },
        } as unknown as GameUiSlotHostOptions;
        const surface = { id: "choice" } as UIStageSurface;
        const menu = (size: number) => ({ evaluated: Array.from({ length: size }, () => ({ words: [] })), gameState: {}, choose: () => undefined });
        engine.menu = menu(2);
        const first = render(<ChoiceSlotSurface options={options} surface={surface} choiceMenus={choiceMenus} />);
        engine.menu = menu(3);
        const second = render(<ChoiceSlotSurface options={options} surface={surface} choiceMenus={choiceMenus} />);

        if (leaving === "first") {
            first.unmount();
            expect(scopeBridge.globalGet(BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY)).toBe(3);
            second.unmount();
        } else {
            second.unmount();
            expect(scopeBridge.globalGet(BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY)).toBe(2);
            first.unmount();
        }
        expect(scopeBridge.globalGet(BLUEPRINT_GAME_CHOICE_COUNT_STATE_KEY)).toBe(0);
        engine.menu = menu(0);
    });

    it("does not reserve a scope for a suspended drawing that never commits", () => {
        const choiceMenus = createChoiceMenus();
        const options = { core: null, bundle: { ui: { uidoc: {} } }, host: {} } as unknown as GameUiSlotHostOptions;
        const surface = { id: "choice" } as UIStageSurface;
        const pending = new Promise<void>(() => undefined);
        function Suspend(): never {
            throw pending;
        }
        const abandoned = render(
            <Suspense fallback={<span>Waiting</span>}>
                <ChoiceSlotSurface options={options} surface={surface} choiceMenus={choiceMenus} />
                <Suspend />
            </Suspense>,
        );
        expect(abandoned.getByText("Waiting")).toBeTruthy();
        abandoned.unmount();

        const next = render(<ChoiceSlotSurface options={options} surface={surface} choiceMenus={choiceMenus} />);
        expect(next.getByTestId("choice").dataset.scope).toBe("choice:0");
    });
});
