// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { i18nStore } from "@/lib/i18n";
import { LayerStackPreview } from "./LayerStackPreview";

/**
 * A new layered character's editor opens on an empty stack, and the preview asked the author to
 * 「选择带有图片的差分」 - select a variant that cannot exist yet. It now says what fills it.
 */

afterEach(() => {
    cleanup();
    i18nStore.setLocale("en");
});

function empty(emptyLabel?: string) {
    return render(
        <LayerStackPreview layers={[]} canvas={null} sizes={{}} onMeasured={() => {}} emptyLabel={emptyLabel} />,
    ).container.textContent ?? "";
}

describe("an empty character preview", () => {
    it("says how a layered character's stack gets something to draw", () => {
        i18nStore.setLocale("zh");
        const text = empty();
        expect(text).toContain("添加带图片的图层或导入 PSD 后显示预览");
        expect(text).not.toContain("差分");
    });

    it("shows the caller's wording for a pose with no image", () => {
        expect(empty("Set an image for this pose to preview")).toContain("Set an image for this pose to preview");
    });
});
