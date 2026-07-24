import { afterEach, describe, expect, it, vi } from "vitest";
import type { UITemplateRegistryEntry } from "@shared/types/uiTemplateRegistry";
import {
    fetchTemplateBundle,
    fetchTemplateIndex,
    resolveTemplateRegistryUrl,
} from "./uiTemplateRegistryClient";

const INDEX_URL = "https://raw.githubusercontent.com/NarraLeaf/UI-Templates/master/index.json";

/** Install a fetch stub that serves canned bodies keyed by exact URL and records
 * every requested URL. Unknown URLs 404. */
function stubFetch(routes: Record<string, unknown>): { urls: string[] } {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
        urls.push(url);
        if (!(url in routes)) {
            return new Response("not found", { status: 404, statusText: "Not Found" });
        }
        const value = routes[url];
        const body = typeof value === "string" ? value : JSON.stringify(value);
        return new Response(body, { status: 200 });
    });
    return { urls };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

const goodEntry = {
    id: "narraleaf.save-load",
    name: "Save / Load",
    version: "1.0.0",
    description: "A save/load page.",
    publisher: "NarraLeaf",
    categories: ["menu"],
    path: "templates/narraleaf.save-load",
    document: "ui/uidoc.json",
    graphs: "ui/uigraphs.json",
    surface: { kind: "appSurface" },
    assets: [],
};

describe("resolveTemplateRegistryUrl", () => {
    it("falls back to the official default when unset", () => {
        expect(resolveTemplateRegistryUrl("")).toBe(INDEX_URL);
        expect(resolveTemplateRegistryUrl(null)).toBe(INDEX_URL);
        expect(resolveTemplateRegistryUrl("  ")).toBe(INDEX_URL);
    });
    it("uses a configured value verbatim", () => {
        expect(resolveTemplateRegistryUrl("https://example.com/i.json")).toBe("https://example.com/i.json");
    });
});

describe("fetchTemplateIndex", () => {
    it("parses a valid index and keeps well-formed entries", async () => {
        stubFetch({ [INDEX_URL]: { formatVersion: 1, repository: "r", templates: [goodEntry] } });
        const index = await fetchTemplateIndex(INDEX_URL);
        expect(index.templates).toHaveLength(1);
        expect(index.templates[0].id).toBe("narraleaf.save-load");
        expect(index.templates[0].surface).toEqual({ kind: "appSurface" });
    });

    it("drops a malformed entry without blanking the whole index", async () => {
        stubFetch({
            [INDEX_URL]: {
                formatVersion: 1,
                repository: "r",
                templates: [
                    goodEntry,
                    { id: "broken", path: "templates/broken" }, // missing document/graphs
                    { ...goodEntry, id: "escape", document: "../../secret.json" }, // traversal
                ],
            },
        });
        const index = await fetchTemplateIndex(INDEX_URL);
        expect(index.templates.map(t => t.id)).toEqual(["narraleaf.save-load"]);
    });

    it("normalizes a stage placement and defaults an unknown slot", async () => {
        stubFetch({
            [INDEX_URL]: {
                formatVersion: 1,
                repository: "r",
                templates: [{ ...goodEntry, surface: { kind: "stageSurface", slotId: "nope" } }],
            },
        });
        const index = await fetchTemplateIndex(INDEX_URL);
        expect(index.templates[0].surface).toEqual({ kind: "stageSurface", slotId: "onStage" });
    });

    it("refuses an unsupported format version", async () => {
        stubFetch({ [INDEX_URL]: { formatVersion: 2, repository: "r", templates: [] } });
        await expect(fetchTemplateIndex(INDEX_URL)).rejects.toThrow(/format version/i);
    });

    it("rejects non-JSON", async () => {
        stubFetch({ [INDEX_URL]: "<html>nope" });
        await expect(fetchTemplateIndex(INDEX_URL)).rejects.toThrow(/not valid JSON/i);
    });
});

describe("fetchTemplateBundle", () => {
    const entry = goodEntry as UITemplateRegistryEntry;

    it("resolves document + graphs against the index directory", async () => {
        const base = "https://raw.githubusercontent.com/NarraLeaf/UI-Templates/master/templates/narraleaf.save-load";
        const routes = stubFetch({
            [`${base}/ui/uidoc.json`]: { schemaVersion: 11, surfaces: [], elements: {} },
            [`${base}/ui/uigraphs.json`]: { schemaVersion: 2, graphs: {} },
        });
        const bundle = await fetchTemplateBundle(entry, INDEX_URL);
        expect(routes.urls).toContain(`${base}/ui/uidoc.json`);
        expect(routes.urls).toContain(`${base}/ui/uigraphs.json`);
        expect(bundle.id).toBe("narraleaf.save-load");
        expect((bundle.document as { schemaVersion: number }).schemaVersion).toBe(11);
        expect(bundle.assets).toEqual([]);
    });

    it("refuses a document path that escapes the template directory", async () => {
        stubFetch({});
        const evil = { ...goodEntry, document: "../../../etc/passwd" } as UITemplateRegistryEntry;
        await expect(fetchTemplateBundle(evil, INDEX_URL)).rejects.toThrow(/unsafe|escape/i);
    });

    it("fetches declared resources as base64", async () => {
        const base = "https://raw.githubusercontent.com/NarraLeaf/UI-Templates/master/templates/narraleaf.save-load";
        const withAsset = {
            ...goodEntry,
            assets: [{ id: "src-asset-1", path: "assets/bg.png" }],
        } as UITemplateRegistryEntry;
        stubFetch({
            [`${base}/ui/uidoc.json`]: { schemaVersion: 11, surfaces: [], elements: {} },
            [`${base}/ui/uigraphs.json`]: { schemaVersion: 2, graphs: {} },
            [`${base}/assets/bg.png`]: "PNGBYTES",
        });
        const bundle = await fetchTemplateBundle(withAsset, INDEX_URL);
        expect(bundle.assets).toHaveLength(1);
        expect(bundle.assets[0].id).toBe("src-asset-1");
        expect(bundle.assets[0].fileName).toBe("bg.png");
        expect(bundle.assets[0].mime).toBe("image/png");
        expect(Buffer.from(bundle.assets[0].dataBase64, "base64").toString()).toBe("PNGBYTES");
    });
});
