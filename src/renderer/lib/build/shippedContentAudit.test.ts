import { describe, expect, it } from "vitest";
import { auditShippedContent, collectSurfaceAssetDemands } from "./shippedContentAudit";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { UIDocument } from "@shared/types/ui-editor/document";

const IMAGE = "11111111-1111-4111-8111-111111111111";
const FONT = "22222222-2222-4222-8222-222222222222";
const DETACHED = "33333333-3333-4333-8333-333333333333";

function element(id: string, props: Record<string, unknown>, childrenIds: string[] = []) {
    return {
        id,
        type: "nl.image",
        parentId: null,
        childrenIds,
        layout: {},
        props,
    } as unknown as UIDocument["elements"][string];
}

function uidoc(): UIDocument {
    return {
        schemaVersion: 1,
        id: "doc",
        name: "doc",
        surfaces: [{
            id: "s1",
            name: "Title",
            host: "app",
            kind: "appSurface",
            designSize: { width: 1920, height: 1080 },
            rootElementId: "root",
            settings: { backgroundImage: { assetId: IMAGE } },
        }],
        elements: {
            root: element("root", {}, ["child"]),
            child: element("child", { fontAssetId: FONT }),
            stray: element("stray", { assetId: DETACHED }),
        },
    } as unknown as UIDocument;
}

describe("collectSurfaceAssetDemands", () => {
    it("finds ids on a page's own settings and on its elements", () => {
        const demands = collectSurfaceAssetDemands(uidoc());
        expect(demands.map(demand => demand.assetId).sort()).toEqual([DETACHED, FONT, IMAGE].sort());
    });

    it("names the page an author can open", () => {
        const demands = collectSurfaceAssetDemands(uidoc());
        expect(demands.find(demand => demand.assetId === FONT)?.origin).toBe("Title");
    });

    it("still reports an element no page's tree reaches", () => {
        // The package carries the element pool whole, so a detached element is a demand the running
        // game can still make. Pruning it here would report its asset as unwanted.
        const demands = collectSurfaceAssetDemands(uidoc());
        expect(demands.some(demand => demand.assetId === DETACHED)).toBe(true);
    });
});

function pack(items: Record<string, { relativePath: string }>): GameRuntimePackV1 {
    return {
        bundle: {
            ui: { uidoc: uidoc() },
            storyLibrary: undefined,
        },
        assets: { items },
    } as unknown as GameRuntimePackV1;
}

describe("auditShippedContent", () => {
    const present = {
        [IMAGE]: { relativePath: "assets/a.png" },
        [FONT]: { relativePath: "assets/b.woff2" },
        [DETACHED]: { relativePath: "assets/c.png" },
    };
    /** How a loose package answers: the manifest is the only thing that knows where bytes are. */
    const looseResolver = (items: Record<string, { relativePath: string }>) =>
        (assetId: string) => items[assetId]?.relativePath ?? null;
    const readsEverything = { entryExists: async () => true, resolveEntryName: looseResolver(present) };

    it("passes when the package answers every demand", async () => {
        const result = await auditShippedContent({ pack: pack(present), reader: readsEverything });
        expect(result.failures).toEqual([]);
        expect(result.checkedAssetCount).toBe(3);
    });

    it("fails an asset the manifest does not list", async () => {
        const { [FONT]: _dropped, ...withoutFont } = present;
        const result = await auditShippedContent({
            pack: pack(withoutFont),
            reader: { entryExists: async () => true, resolveEntryName: looseResolver(withoutFont) },
        });
        expect(result.failures).toEqual([{ assetId: FONT, origin: "Title", reason: "missing" }]);
    });

    /*
     * A protected package ships an empty manifest and derives every entry name from the asset id, so
     * the audit has to be able to prove such a package without a manifest to read. Without this the
     * suite would only ever exercise the loose route and a shipped game could fail its own gate.
     */
    it("audits a package that names its entries by derivation and lists nothing", async () => {
        const seen: string[] = [];
        const result = await auditShippedContent({
            pack: pack({}),
            reader: {
                entryExists: async name => {
                    seen.push(name);
                    return true;
                },
                resolveEntryName: assetId => `assets/${assetId}`,
            },
        });
        expect(result.failures).toEqual([]);
        expect(result.checkedAssetCount).toBe(3);
        expect(seen).toContain(`assets/${IMAGE}`);
    });

    it("fails an asset the manifest lists and the store does not hold", async () => {
        const result = await auditShippedContent({
            pack: pack(present),
            reader: {
                entryExists: async relativePath => relativePath !== "assets/b.woff2",
                resolveEntryName: looseResolver(present),
            },
        });
        expect(result.failures).toEqual([{
            assetId: FONT,
            origin: "Title",
            reason: "unreadable",
            detail: "assets/b.woff2",
        }]);
    });

    it("treats a store that throws as a failure rather than letting the build through", async () => {
        const result = await auditShippedContent({
            pack: pack(present),
            reader: {
                entryExists: async () => { throw new Error("sealed store refused"); },
                resolveEntryName: looseResolver(present),
            },
        });
        expect(result.failures).toHaveLength(3);
        expect(result.failures.every(failure => failure.reason === "unreadable")).toBe(true);
    });
});
