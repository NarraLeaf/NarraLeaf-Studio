// @vitest-environment jsdom
/**
 * A character drawn by a runtime has no differentials, so Studio bakes no avatar for her and her
 * dialogue shows the profile's default avatar or nothing. The field she sets it in is where an author
 * looks for her avatar, so it is the field that says so; a sprite character's field says nothing.
 */
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CharacterAppearanceKind } from "@shared/utils/characterAppearanceKinds";
import type { CharacterEditorContext } from "../schemas/characterSchema";
import { CharacterAvatarField } from "./CharacterAvatarField";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: null, isInitialized: false }),
}));

vi.mock("@/apps/workspace/modules/assets/state/useAssetSetPickerSource", () => ({
    useAssetSetPickerSource: () => ({ virtualGroups: undefined, resolveAssetPreviewUrl: undefined }),
}));

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null }),
}));

vi.mock("@/apps/workspace/modules/assets/components/AssetSelector", () => ({
    AssetSelector: () => null,
}));

afterEach(cleanup);

function fieldFor(kind: CharacterAppearanceKind) {
    const data = {
        character: {
            profile: {
                getDefaultAvatarAssetId: () => null,
                setDefaultAvatarAssetId: () => undefined,
                appearance: { getKind: () => kind },
            },
        },
        thumbnailUrl: null,
        poses: [],
    } as unknown as CharacterEditorContext;
    return render(<CharacterAvatarField data={data} onChange={() => undefined} />);
}

const hint = () => screen.queryByText("characters.properties.defaultAvatarRuntimeHint");

describe("the default dialog avatar field", () => {
    it.each(["live2d", "spine", "puppet"] as const)("says a %s character's dialogue shows only this avatar", kind => {
        fieldFor(kind);
        expect(hint()).not.toBeNull();
    });

    it.each(["preset", "layered"] as const)("says nothing extra for a %s character", kind => {
        fieldFor(kind);
        expect(hint()).toBeNull();
    });
});
