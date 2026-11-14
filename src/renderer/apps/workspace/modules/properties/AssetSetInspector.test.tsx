// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAssetSetAxis, type AssetSet } from "@shared/types/assetSet";
import { Services } from "@/lib/workspace/services/services";
import type { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import { AssetSetInspector } from "./AssetSetInspector";

const fixture = vi.hoisted(() => ({
    locales: [{ code: "en", displayName: "English" }],
    tags: [{ id: "main", name: "Main" }],
    localeChanged: null as (() => void) | null,
    tagsChanged: null as ((tags: { id: string; name: string }[]) => void) | null,
}));
vi.mock("@/apps/workspace/context", () => {
    const localization = {
        getConfiguration: () => ({ locales: fixture.locales }),
        onConfigChanged: (listener: () => void) => { fixture.localeChanged = listener; return () => { fixture.localeChanged = null; }; },
    };
    const appTags = {
        listTags: () => fixture.tags,
        onTagsChanged: (listener: (tags: { id: string; name: string }[]) => void) => { fixture.tagsChanged = listener; return () => { fixture.tagsChanged = null; }; },
    };
    const context = { services: { get: (id: string) => id === Services.Localization ? localization : appTags } };
    return { useWorkspace: () => ({ context, isInitialized: true }) };
});
vi.mock("@/lib/i18n", async importOriginal => {
    const translator = { t: (key: string) => key, tn: (key: string) => key, has: () => false, locale: "en" };
    return { ...(await importOriginal<Record<string, unknown>>()), useTranslation: () => translator };
});
vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ frozen: false, writes: () => ({}) }),
}));
vi.mock("@/apps/workspace/modules/assets/components/AssetSelector", () => ({ AssetSelector: () => null }));

beforeEach(() => {
    fixture.locales = [{ code: "en", displayName: "English" }];
    fixture.tags = [{ id: "main", name: "Main" }];
});
afterEach(cleanup);

function renderSet(kind: "locale" | "release") {
    const set: AssetSet = { id: "set", name: "Set", type: "image", filter: [], axis: makeAssetSetAxis(kind, kind === "locale" ? ["en"] : ["main"]) };
    const setAxis = vi.fn();
    const service = { setAxis, listSets: () => [set], onSetsChanged: () => () => undefined } as unknown as AssetSetService;
    render(<AssetSetInspector set={set} candidates={[]} assetsById={new Map()} service={service} assetsService={null} />);
    return setAxis;
}

function chooseAxis(kind: "locale" | "release") {
    fireEvent.click(screen.getByRole("button", { name: "assets.sets.inspector.axes" }));
    fireEvent.click(screen.getByRole("option", { name: `assets.sets.axisKind.${kind}` }));
}

describe("asset set axis choices", () => {
    it("uses languages added while the inspector is open", () => {
        const setAxis = renderSet("release");
        act(() => {
            fixture.locales = [...fixture.locales, { code: "ja", displayName: "Japanese" }];
            fixture.localeChanged?.();
        });
        chooseAxis("locale");
        expect(setAxis).toHaveBeenCalledWith("set", expect.objectContaining({ kind: "locale", values: ["en", "ja"] }));
    });

    it("uses editions added while the inspector is open", () => {
        const setAxis = renderSet("locale");
        act(() => {
            fixture.tags = [...fixture.tags, { id: "deluxe", name: "Deluxe" }];
            fixture.tagsChanged?.(fixture.tags);
        });
        chooseAxis("release");
        expect(setAxis).toHaveBeenCalledWith("set", expect.objectContaining({ kind: "release", values: ["main", "deluxe"] }));
    });
});
