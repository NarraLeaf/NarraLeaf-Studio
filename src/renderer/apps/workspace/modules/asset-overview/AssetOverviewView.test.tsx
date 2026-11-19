// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type Asset } from "@/lib/workspace/services/assets/types";
import { buildAssetOverview } from "./assetOverviewModel";
import { AssetOverviewView } from "./AssetOverviewView";

vi.mock("@/lib/i18n", () => ({
    useTranslation: () => ({
        t: (key: string) => ({
            "assets.overview.section.unreferenced": "Unreferenced",
            "properties.references.unknown": "Usage could not be determined",
        } as Record<string, string>)[key] ?? key,
        tn: (key: string, count: number) => key === "assets.overview.uses" ? `${count} uses` : `${count} items`,
        formatNumber: (value: number) => String(value),
    }),
}));
vi.mock("../dashboard/DashboardPrimitives", () => ({
    DashboardSection: ({ title, children }: { title: string; children: ReactNode }) => (
        <section aria-label={title}>{children}</section>
    ),
    StatTile: ({ label, value }: { label: string; value: string }) => <div>{label}: {value}</div>,
}));
vi.mock("../properties/components/AssetReferencesSection", () => ({ AssetReferencesSection: () => null }));
vi.mock("../assets/components/AssetThumbnail", () => ({ AssetThumbnail: () => null }));
vi.mock("../story/scene-editor/storyBadgeImageCache", () => ({ useBadgeImageUrl: () => null }));

function asset(id: string, name: string, type: AssetType): Asset {
    return { id, name, type, hash: id, source: AssetSource.Local, meta: {}, tags: [], description: "" } as Asset;
}

function snapshot() {
    return buildAssetOverview({
        assets: [asset("picture", "Unknown picture", AssetType.Image), asset("sound", "Unused sound", AssetType.Audio)],
        bytesByAssetId: new Map([["picture", 100], ["sound", 50]]),
        referenceCountByAssetId: new Map(),
        indexResult: { complete: false, gaps: [{ reason: "computedAssetPin", affects: ["image"] }] },
        directoryBytes: 150,
        directoryFileCount: 2,
        topCount: 12,
    });
}

describe("AssetOverviewView with incomplete reference coverage", () => {
    it("lists only assets whose unused status is known", () => {
        render(<AssetOverviewView snapshot={snapshot()} failed={false} refresh={() => {}} />);

        const unreferenced = screen.getByRole("region", { name: "Unreferenced" });
        expect(within(unreferenced).getByText("Unused sound")).toBeTruthy();
        expect(within(unreferenced).queryByText("Unknown picture")).toBeNull();
    });

    it("does not report zero uses for an asset whose usage is unknown", () => {
        render(<AssetOverviewView snapshot={snapshot()} failed={false} refresh={() => {}} />);

        fireEvent.click(screen.getAllByRole("button", { name: /Unknown picture/ })[0]);
        expect(screen.getByText("Usage could not be determined")).toBeTruthy();
        expect(screen.queryByText("0 uses")).toBeNull();
    });
});
