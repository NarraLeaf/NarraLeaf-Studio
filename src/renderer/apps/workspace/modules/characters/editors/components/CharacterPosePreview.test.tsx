// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterPosePreview } from "./CharacterPosePreview";

vi.mock("./LayerStackPreview", () => ({
    LayerStackPreview: ({ layers }: { layers: { assetId: string | null }[] }) => <span>{layers[0]?.assetId}</span>,
}));

const callbacks = new Map<number, FrameRequestCallback>();
let nextId = 0;

beforeEach(() => {
    callbacks.clear();
    nextId = 0;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callbacks.set(++nextId, callback);
        return nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { callbacks.delete(id); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function step(now: number) {
    const [id, callback] = callbacks.entries().next().value!;
    callbacks.delete(id);
    act(() => callback(now));
}

const props = {
    layers: [{ id: "pose", assetId: "first" }], canvas: null, sizes: {}, onMeasured: () => undefined,
};

describe("animated pose previews", () => {
    it("stops requesting frames after a non-looping sequence reaches its last image", () => {
        render(<CharacterPosePreview {...props} sequence={{ frameAssetIds: ["first", "last"], fps: 1, loop: false }} />);
        expect(screen.getByText("first")).toBeTruthy();
        step(1000);
        expect(screen.getByText("last")).toBeTruthy();
        expect(callbacks.size).toBe(0);
    });

    it("pauses a sequence while its editor tab is hidden", () => {
        const sequence = { frameAssetIds: ["first", "last"], fps: 1, loop: true };
        const view = render(<CharacterPosePreview {...props} sequence={sequence} active />);
        expect(callbacks.size).toBe(1);
        view.rerender(<CharacterPosePreview {...props} sequence={sequence} active={false} />);
        expect(callbacks.size).toBe(0);
        view.rerender(<CharacterPosePreview {...props} sequence={sequence} active />);
        expect(callbacks.size).toBe(1);
    });

});
