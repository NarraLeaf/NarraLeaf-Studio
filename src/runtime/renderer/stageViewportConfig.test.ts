import { describe, expect, it } from "vitest";
import { resolveStageViewport } from "./stageViewportConfig";

const CROP_TOP = {
  fit: "cover",
  cropAnchorX: "left",
  cropAnchorY: "top"
} as const;

describe("resolveStageViewport", () => {
  it("crops in a mobile shell", () => {
    expect(
      resolveStageViewport({ viewport: CROP_TOP, mode: "production", isMobileShell: true })
    ).toEqual({ fit: "cover", cropAnchor: { x: "left", y: "top" } });
  });

  it("crops in a preview run, so the author sees what the phone will do", () => {
    expect(
      resolveStageViewport({ viewport: CROP_TOP, mode: "preview", isMobileShell: false }).fit
    ).toBe("cover");
  });

  it("letterboxes a packaged desktop or web build whatever the project says", () => {
    // The player owns the window size there, so no anchor can make cropping predictable.
    const resolved = resolveStageViewport({
      viewport: CROP_TOP,
      mode: "production",
      isMobileShell: false
    });
    expect(resolved).toEqual({ fit: "contain", cropAnchor: { x: "center", y: "center" } });
  });

  it("reads a pack with no viewport field as contain — every one of those shipped letterboxed", () => {
    expect(resolveStageViewport({ mode: "preview", isMobileShell: true })).toEqual({
      fit: "contain",
      cropAnchor: { x: "center", y: "center" }
    });
  });
});
