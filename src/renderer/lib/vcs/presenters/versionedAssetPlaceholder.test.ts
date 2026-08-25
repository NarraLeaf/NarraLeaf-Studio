import { describe, expect, it } from "vitest";
import type { AssetBytesResult, AssetBytesSource } from "@/lib/ui-editor/assets/assetBytesSource";
import {
    assetRefusalPlaceholder,
    drawRefusalsAsPlaceholders,
    isAssetRefusalPlaceholder,
} from "./versionedAssetPlaceholder";

/**
 * Three statements that must stay three, because an author acts on each of them differently: "there
 * is no image here" (an empty fill, which is an ordinary thing to have authored), "the image cannot
 * honestly be shown here" and "the image is there and would not read".
 *
 * jsdom does no layout and paints nothing, so what a mark LOOKS like is not knowable here and is not
 * claimed here. What is knowable is that a refusal is drawn at all rather than left blank, and that
 * the two refusals are not the same picture.
 */

function asText(result: AssetBytesResult): string {
    if (result.kind !== "bytes") {
        throw new Error(`expected bytes, got ${result.kind}`);
    }
    return new TextDecoder().decode(result.bytes);
}

describe("assetRefusalPlaceholder", () => {
    it("draws something rather than nothing, so a refusal is never an empty fill", () => {
        for (const kind of ["absent", "failed"] as const) {
            const drawn = assetRefusalPlaceholder(kind);
            expect(drawn.kind).toBe("bytes");
            expect(asText(drawn)).toContain("<svg");
            // Typed, or the element it lands in has nothing to decode it with.
            expect(drawn.kind === "bytes" && drawn.mediaType).toBe("image/svg+xml");
            // It fills whatever box it is given; an aspect ratio would letterbox it and leave part
            // of the widget looking ordinarily empty.
            expect(asText(drawn)).toContain('preserveAspectRatio="none"');
        }
    });

    it("draws a fault differently from an absence", () => {
        const absent = asText(assetRefusalPlaceholder("absent"));
        const failed = asText(assetRefusalPlaceholder("failed"));

        expect(absent).not.toBe(failed);
        // One dashed stroke against two solid ones, in two different colours: the distinction has
        // to survive being drawn twenty pixels across, which is what half a comparison pane gives a
        // widget on a scaled page.
        expect(absent).toContain("stroke-dasharray");
        expect(failed).not.toContain("stroke-dasharray");
        expect((absent.match(/<path/g) ?? []).length).toBe(1);
        expect((failed.match(/<path/g) ?? []).length).toBe(2);
    });
});

describe("drawRefusalsAsPlaceholders", () => {
    it("substitutes a mark for a refusal and leaves real bytes alone", async () => {
        const real: AssetBytesResult = { kind: "bytes", bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" };
        const answers: Record<string, AssetBytesResult> = {
            real,
            missing: { kind: "absent" },
            broken: { kind: "failed", reason: "pack unreadable" },
        };
        const inner: AssetBytesSource = { id: "rev", read: async assetId => answers[assetId] };
        const wrapped = drawRefusalsAsPlaceholders(inner);

        expect(await wrapped.read("real", "image")).toBe(real);
        expect(isAssetRefusalPlaceholder(await wrapped.read("missing", "image"))).toBe(true);
        expect(await wrapped.read("missing", "image")).not.toEqual(await wrapped.read("broken", "image"));
        // The wrapper is the same version, or the hook that keys on this id would restart every
        // fetch on the surface the moment a refusal appeared.
        expect(wrapped.id).toBe(inner.id);
    });
});
