// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StageViewportFrame } from "./StageViewportFrame";
import { StageLetterbox, letterboxImageStyle } from "./StageLetterbox";

const PICTURE = "6f0e8f7c-1d2b-4c3a-9e8f-7a6b5c4d3e2f";

// The asset hook stands in for both runtimes: the packaged one answers from the pack, Dev Mode from
// its window's map. What matters here is only what the letterbox does with the answer.
const resolved = new Map<string, string>();
vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: (assetId?: string | null) => ({
        url: assetId ? resolved.get(assetId) ?? null : null,
        metadata: null,
        loading: false,
        error: null,
    }),
}));

afterEach(() => {
    cleanup();
    resolved.clear();
});

function renderFrame(props: { stageColor?: string; letterbox?: Parameters<typeof StageLetterbox>[0]["config"] }) {
    return render(
        <StageViewportFrame
            designSize={{ width: 1920, height: 1080 }}
            backdrop={<StageLetterbox config={props.letterbox} />}
            {...(props.stageColor ? { stageColor: props.stageColor } : {})}
        >
            <div data-testid="stage-content" />
        </StageViewportFrame>,
    );
}

describe("StageViewportFrame with a letterbox", () => {
    it("lays the letterbox under the stage, across the whole frame", () => {
        const { container, getByTestId } = renderFrame({ letterbox: { color: "#203040", image: null } });
        const outer = container.firstElementChild as HTMLElement;
        const [backdrop, box] = Array.from(outer.children) as HTMLElement[];
        // First in document order and absolutely positioned, with the positioned box after it: the box
        // paints over it, and the backdrop shows only where the box does not reach.
        expect(backdrop.dataset.stageLetterbox).toBe("");
        expect(backdrop.style.position).toBe("absolute");
        expect(backdrop.style.inset).toBe("0px");
        expect(backdrop.style.backgroundColor).toBe("rgb(32, 48, 64)");
        expect(box.contains(getByTestId("stage-content"))).toBe(true);
        expect(box.style.position).toBe("relative");
    });

    it("gives the stage a black ground of its own, so the letterbox never shows through it", () => {
        const { container } = renderFrame({ letterbox: { color: "#FFFFFF", image: null } });
        const box = container.firstElementChild!.children[1] as HTMLElement;
        expect(box.style.backgroundColor).toBe("rgb(0, 0, 0)");
        expect(box.style.backgroundImage).toBe("");
    });

    it("lays a translucent stage colour over that ground rather than replacing it", () => {
        const { container } = renderFrame({ stageColor: "rgba(255, 255, 255, 0.5)" });
        const box = container.firstElementChild!.children[1] as HTMLElement;
        expect(box.style.backgroundColor).toBe("rgb(0, 0, 0)");
        expect(box.style.backgroundImage).toContain("linear-gradient");
    });

    it("paints black bars for a bundle that predates the setting", () => {
        const { container } = renderFrame({});
        const backdrop = container.firstElementChild!.children[0] as HTMLElement;
        expect(backdrop.style.backgroundColor).toBe("rgb(0, 0, 0)");
        expect(backdrop.style.backgroundImage).toBe("");
    });
});

describe("StageLetterbox picture", () => {
    it("draws the picture over the colour once it resolves", () => {
        resolved.set(PICTURE, "nlgame://asset/picture");
        const { container } = render(
            <StageLetterbox config={{ color: "#102030", image: { assetId: PICTURE, fillMode: "cover" } }} />,
        );
        const layer = container.firstElementChild as HTMLElement;
        expect(layer.dataset.stageLetterbox).toBe("cover");
        expect(layer.style.backgroundColor).toBe("rgb(16, 32, 48)");
        expect(layer.style.backgroundImage).toContain("nlgame://asset/picture");
        expect(layer.style.backgroundSize).toBe("cover");
    });

    it("keeps the colour when the picture cannot be found", () => {
        const { container } = render(
            <StageLetterbox config={{ color: "#102030", image: { assetId: PICTURE, fillMode: "cover" } }} />,
        );
        const layer = container.firstElementChild as HTMLElement;
        expect(layer.style.backgroundColor).toBe("rgb(16, 32, 48)");
        expect(layer.style.backgroundImage).toBe("");
    });
});

describe("letterboxImageStyle", () => {
    it("centres every mode, so the two bars mirror each other", () => {
        for (const mode of ["cover", "stretch", "tile"] as const) {
            expect(letterboxImageStyle("x.png", mode).backgroundPosition).toBe("center");
        }
    });

    it("fills by mode", () => {
        expect(letterboxImageStyle("x.png", "cover")).toMatchObject({ backgroundSize: "cover", backgroundRepeat: "no-repeat" });
        expect(letterboxImageStyle("x.png", "stretch")).toMatchObject({ backgroundSize: "100% 100%", backgroundRepeat: "no-repeat" });
        expect(letterboxImageStyle("x.png", "tile")).toMatchObject({ backgroundSize: "auto", backgroundRepeat: "repeat" });
    });
});
