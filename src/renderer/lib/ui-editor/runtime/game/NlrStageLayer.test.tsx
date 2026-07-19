// @vitest-environment jsdom
/**
 * Visibility contract for the NLR stage layer. The layer mounts as soon as a
 * session exists — earlier than the host reveals the stage — so while hidden it
 * must keep layout (the Player subtree stays mounted and measurable; no
 * `display: none`) but paint nothing: `visibility: hidden` and no opaque black
 * backdrop. Regression coverage for the "black flash after first frame" bug
 * where the backdrop painted over the boot frame before the surface system
 * started.
 */
import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NlrStageLayer, type NlrStageSession } from "./NlrStageLayer";

vi.mock("narraleaf-react", () => ({
    DevTools: { setActionId: vi.fn() },
    GameProviders: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Player: ({ children }: { children?: ReactNode }) => <div data-testid="nlr-player">{children}</div>,
}));

afterEach(cleanup);

const NOOP = () => undefined;

function makeSession(): NlrStageSession {
    return {
        id: "session-1",
        game: {} as NlrStageSession["game"],
        compiled: { story: {}, actionIdBindings: [] } as unknown as NlrStageSession["compiled"],
        width: 1280,
        height: 720,
    };
}

function renderLayer(visible: boolean | undefined) {
    return render(
        <NlrStageLayer
            session={makeSession()}
            interactive={false}
            {...(visible === undefined ? {} : { visible })}
            renderOnStage={false}
            onLiveGameReady={NOOP}
            onEnvironmentReady={NOOP}
            onFirstSceneReady={NOOP}
            onError={NOOP}
        />,
    );
}

function stageRoot(container: HTMLElement): HTMLElement {
    const root = container.firstElementChild as HTMLElement | null;
    if (!root) {
        throw new Error("stage root did not render");
    }
    return root;
}

describe("NlrStageLayer visibility", () => {
    it("paints nothing while hidden but keeps the Player mounted for layout/measurement", () => {
        const { container, getByTestId } = renderLayer(false);
        const root = stageRoot(container);
        expect(root.style.visibility).toBe("hidden");
        expect(root.style.display).not.toBe("none");
        expect(root.className).not.toContain("bg-black");
        // The Player subtree must stay mounted while hidden: NLR measures the stage on mount
        // and the boot preload runs against it.
        expect(getByTestId("nlr-player")).toBeTruthy();
    });

    it("restores the black backdrop and painting when revealed", () => {
        const { container, rerender } = renderLayer(false);
        rerender(
            <NlrStageLayer
                session={makeSession()}
                interactive={false}
                visible={true}
                renderOnStage={false}
                onLiveGameReady={NOOP}
                onEnvironmentReady={NOOP}
                onFirstSceneReady={NOOP}
                onError={NOOP}
            />,
        );
        const root = stageRoot(container);
        expect(root.style.visibility).toBe("visible");
        expect(root.className).toContain("bg-black");
    });

    it("defaults to visible for hosts that manage buffer visibility themselves", () => {
        const { container } = renderLayer(undefined);
        const root = stageRoot(container);
        expect(root.style.visibility).toBe("visible");
        expect(root.className).toContain("bg-black");
    });
});
