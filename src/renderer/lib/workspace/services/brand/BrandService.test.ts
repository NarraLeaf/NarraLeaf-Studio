import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import { formatBrandLink, parseBrandLink } from "@shared/brand/brandLink";
import { getActiveBrandPalette } from "@shared/brand/brandRegistry";
import { getActiveProjectFontIds } from "@shared/typography/projectFonts";
import { PROJECT_FONT_STACK_MAX } from "@shared/types/typography";
import type { LiveBrandOp } from "@shared/live/ops";
import {
    BRAND_SCHEMA_VERSION,
    BUILTIN_BRAND_COLORS,
    isBuiltinBrandColorId,
} from "@shared/types/brand";
import { Services, type WorkspaceContext } from "../services";
import { BrandService } from "./BrandService";

/**
 * The service end of the palette: reads through `loadDocument`, writes through `saveDocument`, seeded
 * from absence, the same "refuse to write over a file we could not read" latch every adopted document
 * service carries - and the one thing that is only true here, that every path which changes the list
 * also publishes it to the module-level palette the colour fields read.
 */

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "brand.json");

type Harness = {
    service: BrandService;
    ctx: WorkspaceContext;
    files: Map<string, string>;
    unreadable: ReturnType<typeof vi.fn>;
};

type HarnessOptions = {
    /** Re-init the same singleton against a fresh project, the way a project switch does. */
    reuse?: BrandService;
    /** Stand in for `UuidService.generate`. Hex, so a slice of it is a legal id body. */
    uuid?: () => string;
    /** The project's source language, which is what the font stack is published as resolved in. */
    sourceLocale?: string;
};

async function createHarness(seed?: string, options?: HarnessOptions): Promise<Harness> {
    const files = new Map<string, string>();
    if (seed !== undefined) {
        files.set(DOCUMENT, seed);
    }
    const unreadable = vi.fn();
    let nextId = 0;

    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            writeFileNoFollowOrCreate: async (path: string, data: string) => {
                files.set(path, data);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async (src: string, dest: string) => {
                files.set(dest, files.get(src) ?? "");
                return ok(undefined);
            },
        },
        [Services.Project]: {},
        [Services.Uuid]: {
            generate: options?.uuid ?? (() => `${(++nextId).toString(16).padStart(7, "a")}0f0f0f0f`),
        },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: unreadable },
        // The service publishes the language the font stack resolves in, so it depends on this one.
        // A project with no localization set up reads the empty source language, which filters no
        // rung out of the stack - which is what every case here expects.
        [Services.Localization]: {
            getConfiguration: () => ({ sourceLocale: options?.sourceLocale ?? "", locales: [] }),
            onConfigChanged: () => () => undefined,
        },
    };

    const ctx = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;

    const service = options?.reuse ?? new BrandService();
    await service.initialize(ctx, async () => undefined);

    return { service, ctx, files, unreadable };
}

const ids = (service: BrandService): string[] => service.listColors().map(color => color.id);

describe("BrandService document adoption", () => {
    it("seeds the whole built-in palette on a project that has never had one", async () => {
        const { service, files } = await createHarness();

        expect(ids(service)).toEqual(BUILTIN_BRAND_COLORS.map(color => color.id));
        expect(service.listColors().every(color => color.builtin === true)).toBe(true);
        // Written on first open, not on first edit: version control has to see the palette from the
        // moment the project is opened.
        expect(files.get(DOCUMENT)).toContain("\"colors\"");
        expect(files.get(DOCUMENT)).toContain(`"schemaVersion": ${BRAND_SCHEMA_VERSION}`);
        expect(files.get(DOCUMENT)?.endsWith("\n")).toBe(true);
    });

    it("puts back a seeded slot a document has lost, and keeps the author's own colours", async () => {
        const stored = JSON.stringify({
            schemaVersion: BRAND_SCHEMA_VERSION,
            colors: [{ id: "primary", value: "#123456" }, { id: "cabc123", name: "Accent", value: "#00FF00" }],
        });
        const { service } = await createHarness(stored);

        expect(ids(service)).toHaveLength(BUILTIN_BRAND_COLORS.length + 1);
        expect(service.getColor("primary")).toMatchObject({ value: "#123456", builtin: true });
        expect(service.getColor("button.primary")).toMatchObject({ value: "nlbrand:primary", builtin: true });
        expect(service.getColor("cabc123")).toEqual({ id: "cabc123", name: "Accent", value: "#00FF00" });
    });

    /** The canonical encoder refuses an explicit `undefined` by name; an author's colour has no `builtin`. */
    it("writes an author's colour without an undefined builtin flag", async () => {
        const { service, files } = await createHarness();

        const color = service.createColor({ name: "Accent", value: "#00FF00" });
        await service.flushPendingChanges();

        expect("builtin" in color).toBe(false);
        expect((files.get(DOCUMENT)?.match(/"builtin"/g) ?? [])).toHaveLength(BUILTIN_BRAND_COLORS.length);
        expect(files.get(DOCUMENT)).toContain("\"name\": \"Accent\"");
    });
});

describe("BrandService identity for an author's own colour", () => {
    /** An id a link cannot address is a colour nothing can point at, which is the whole feature. */
    it("generates an id that round-trips through the link protocol", async () => {
        const { service } = await createHarness();

        const color = service.createColor({ name: "Accent" });

        expect(parseBrandLink(formatBrandLink(color.id)))
            .toEqual({ id: color.id, alpha: 1, alphaExplicit: false });
        expect(parseBrandLink(formatBrandLink(color.id, 0.5)))
            .toEqual({ id: color.id, alpha: 0.5, alphaExplicit: true });
        expect(isBuiltinBrandColorId(color.id)).toBe(false);
        expect(ids(service).filter(id => id === color.id)).toHaveLength(1);
    });

    it("keeps taking ids until it finds a free one, even from a generator that repeats itself", async () => {
        const { service } = await createHarness(undefined, { uuid: () => "deadbeefdeadbeef" });

        const first = service.createColor();
        const second = service.createColor();
        const third = service.createColor();

        expect(new Set([first.id, second.id, third.id]).size).toBe(3);
        for (const color of [first, second, third]) {
            expect(parseBrandLink(formatBrandLink(color.id))?.id).toBe(color.id);
        }
    });

    /** Links are stored by id, so a rename that moved the id would break every one of them. */
    it("does not derive the id from the name, and keeps it across a rename", async () => {
        const { service } = await createHarness();

        const color = service.createColor({ name: "Accent" });
        expect(color.id).not.toContain("accent");

        expect(service.renameColor(color.id, "Highlight")).toBe(true);
        expect(service.getColor(color.id)).toMatchObject({ name: "Highlight" });
        expect(service.renameColor(color.id, "   ")).toBe(false);
        expect(service.renameColor("nope", "Anything")).toBe(false);
    });
});

describe("BrandService mutations", () => {
    it("refuses to delete a seeded slot and deletes an author's colour", async () => {
        const { service } = await createHarness();
        const color = service.createColor({ name: "Accent" });

        expect(service.deleteColor("primary")).toBe(false);
        expect(service.deleteColor("button.primary")).toBe(false);
        expect(service.getColor("primary")).toBeDefined();

        expect(service.deleteColor(color.id)).toBe(true);
        expect(service.getColor(color.id)).toBeUndefined();
        expect(service.deleteColor(color.id)).toBe(false);
    });

    it("re-points a seeded slot, because that is what the feature is", async () => {
        const { service } = await createHarness();

        service.updateColor("button.primary", { value: "nlbrand:secondary" });

        expect(service.getColor("button.primary")).toMatchObject({ value: "nlbrand:secondary", builtin: true });
    });

    /** The normalizer drops a row it cannot paint, so a blank must not reach it. */
    it("ignores a blank value rather than deleting the colour that was being retyped", async () => {
        const { service } = await createHarness();
        const color = service.createColor({ name: "Accent", value: "#00FF00" });

        service.updateColor(color.id, { value: "   " });

        expect(service.getColor(color.id)).toMatchObject({ value: "#00FF00" });
    });

    it("removes the name key rather than storing an empty one", async () => {
        const { service, files } = await createHarness();
        const color = service.createColor({ name: "Accent", value: "#00FF00" });

        service.updateColor(color.id, { name: "" });
        await service.flushPendingChanges();

        expect("name" in service.getColor(color.id)!).toBe(false);
        expect(files.get(DOCUMENT)).not.toContain("Accent");
    });

    it("reorders colours, seeded slots included", async () => {
        const { service } = await createHarness();
        const color = service.createColor({ name: "Accent" });

        service.moveColor(color.id, "primary");
        expect(ids(service)[0]).toBe(color.id);

        service.moveColor(color.id, null);
        expect(ids(service).at(-1)).toBe(color.id);
    });

    it("reports dirty and clean around a flush, and bumps the revision per mutation", async () => {
        const { service } = await createHarness();
        const dirtyStates: boolean[] = [];
        service.onDirtyChanged(value => dirtyStates.push(value));

        const before = service.getRevision();
        service.createColor({ name: "Accent" });
        expect(service.isDirty()).toBe(true);
        expect(service.getRevision()).toBe(before + 1);

        await service.flushPendingChanges();
        expect(service.isDirty()).toBe(false);
        expect(dirtyStates).toEqual([true, false]);
    });

    it("tells its subscribers on every mutation", async () => {
        const { service } = await createHarness();
        const seen: number[] = [];
        const unsubscribe = service.onColorsChanged(colors => seen.push(colors.length));

        const color = service.createColor({ name: "Accent" });
        service.updateColor(color.id, { value: "#00FF00" });
        service.deleteColor(color.id);
        unsubscribe();
        service.createColor({ name: "Ignored" });

        const seeds = BUILTIN_BRAND_COLORS.length;
        expect(seen).toEqual([seeds + 1, seeds + 1, seeds]);
    });

    /** History restore hands back a whole document; it must land like any other change. */
    it("replaces the whole document and republishes it", async () => {
        const { service } = await createHarness();

        service.replaceDocument({
            schemaVersion: BRAND_SCHEMA_VERSION,
            colors: [{ id: "primary", value: "#ABCDEF" }],
            fonts: [],
        });

        expect(service.getColor("primary")).toMatchObject({ value: "#ABCDEF" });
        expect(service.listColors()).toHaveLength(BUILTIN_BRAND_COLORS.length);
        expect(service.isDirty()).toBe(true);
        expect(getActiveBrandPalette().resolveCss("button.primary")).toBe("#ABCDEF");
    });
});

describe("BrandService publishing to the active palette", () => {
    it("publishes the loaded palette, so a field reads the project's colours and not the seeds", async () => {
        await createHarness(JSON.stringify({
            schemaVersion: BRAND_SCHEMA_VERSION,
            colors: [{ id: "primary", value: "#010203" }],
        }));

        expect(getActiveBrandPalette().resolveCss("primary")).toBe("#010203");
    });

    /** The point of the whole feature: change one colour, everything pointing at it follows. */
    it("resolves a link chain through the new value after a mutation", async () => {
        const { service } = await createHarness();

        expect(getActiveBrandPalette().resolveCss("button.primary")).toBe("#40A8C4");
        service.updateColor("primary", { value: "#FF0000" });

        expect(getActiveBrandPalette().resolveCss("button.primary")).toBe("#FF0000");
        expect(service.getPalette().resolveCss("button.primary")).toBe("#FF0000");
    });

    it("publishes an author's own colour the moment it exists", async () => {
        const { service } = await createHarness();

        const color = service.createColor({ name: "Accent", value: "#00FF00" });

        expect(getActiveBrandPalette().resolveCss(color.id)).toBe("#00FF00");
        service.deleteColor(color.id);
        // Deleting does not repoint the links that used it; they simply stop resolving, and lint says so.
        expect(getActiveBrandPalette().resolveCss(color.id)).toBeNull();
    });

    /** The palette is module-level, so closing a project has to hand the window back the seeds. */
    it("restores the built-in palette when the project closes", async () => {
        const { service, ctx } = await createHarness();
        service.updateColor("primary", { value: "#FF0000" });

        await service.teardown(ctx);

        expect(getActiveBrandPalette().resolveCss("primary")).toBe("#40A8C4");
    });
});

describe("BrandService when the file on disk cannot be read", () => {
    const BROKEN = "{\"colors\": [{\"id\": \"primary\"";

    it("opens the project anyway, and reports the failure where the author can see it", async () => {
        const { service, unreadable } = await createHarness(BROKEN);

        expect(unreadable).toHaveBeenCalledTimes(1);
        expect(unreadable.mock.calls[0][0].path).toBe("editor/brand.json");
        expect(service.listColors()).toHaveLength(BUILTIN_BRAND_COLORS.length);
    });

    /** Writing the bare seeds over it would turn "unreadable" into "the author's colours are gone". */
    it("refuses to write, rather than replacing it with the seeds", async () => {
        const { service, files } = await createHarness(BROKEN);

        await expect(service.save(service.getDocument())).rejects.toThrow(/could not be read/);
        await expect(service.flushPendingChanges()).resolves.toBeUndefined();
        expect(files.get(DOCUMENT)).toBe(BROKEN);
    });

    it("leaves the original bytes in place and keeps a copy", async () => {
        const { files } = await createHarness(BROKEN);

        expect(files.get(DOCUMENT)).toBe(BROKEN);
        const quarantined = [...files.keys()].filter(path => path.includes("quarantine"));
        expect(quarantined).toHaveLength(1);
        expect(files.get(quarantined[0]!)).toBe(BROKEN);
    });

    /** These services are singletons, so the refusal has to be per-project, not per-process. */
    it("does not follow the author into the next project they open", async () => {
        const broken = await createHarness(BROKEN);

        const healthy = await createHarness(undefined, { reuse: broken.service });

        expect(healthy.files.get(DOCUMENT)).toContain("\"colors\"");
        healthy.service.createColor({ name: "Accent" });
        await expect(healthy.service.flushPendingChanges()).resolves.toBeUndefined();
    });

    /** A palette with a ring in it is a bad document, not an unopenable project. */
    it("opens a project whose palette contains a cycle, with the cycle unresolvable", async () => {
        const cyclic = JSON.stringify({
            schemaVersion: BRAND_SCHEMA_VERSION,
            colors: [{ id: "primary", value: "nlbrand:secondary" }, { id: "secondary", value: "nlbrand:primary" }],
        });
        const { service, unreadable } = await createHarness(cyclic);

        expect(unreadable).not.toHaveBeenCalled();
        expect(getActiveBrandPalette().resolveCss("primary")).toBeNull();
        expect(getActiveBrandPalette().resolveCss("text.muted")).toBe("#9AA3AE");
    });
});


/**
 * The project's default font stack, stored beside the palette in the same document.
 *
 * What is being pinned here is the pair of things a font stack has that a palette does not: it is
 * ordered, and its order is the priority every piece of text in the project inherits - so a move
 * that wrapped, or a duplicate that appeared twice, is a change to how the whole game renders.
 */
describe("BrandService default font stack", () => {
    it("is empty for a project that has never chosen one, and for a v1 document", async () => {
        const fresh = await createHarness();
        expect(fresh.service.listFonts()).toEqual([]);

        const v1 = await createHarness(JSON.stringify({
            schemaVersion: 1,
            colors: [{ id: "primary", value: "#ABCDEF" }],
        }));
        expect(v1.service.listFonts()).toEqual([]);
        expect(getActiveProjectFontIds()).toEqual([]);
    });

    it("appends, publishes and persists", async () => {
        const { service, files } = await createHarness();

        expect(service.addFont("font-a")).toBe(true);
        expect(service.addFont("font-b")).toBe(true);

        expect(service.listFonts()).toEqual([{ assetId: "font-a" }, { assetId: "font-b" }]);
        expect(getActiveProjectFontIds()).toEqual(["font-a", "font-b"]);

        await service.flushPendingChanges();
        expect(JSON.parse(files.get(DOCUMENT)!).fonts).toEqual([{ assetId: "font-a" }, { assetId: "font-b" }]);
    });

    // The caller is a picker the author has just pressed a font in: a silent no-op there is
    // indistinguishable from a control that does not work.
    it("refuses a font already on the stack, and says so", async () => {
        const { service } = await createHarness();
        service.addFont("font-a");

        expect(service.addFont("font-a")).toBe(false);
        expect(service.listFonts()).toHaveLength(1);
    });

    it("refuses to grow past the cap", async () => {
        const { service } = await createHarness();
        for (let index = 0; index < PROJECT_FONT_STACK_MAX; index += 1) {
            expect(service.addFont(`font-${index}`)).toBe(true);
        }

        expect(service.addFont("one-too-many")).toBe(false);
        expect(service.listFonts()).toHaveLength(PROJECT_FONT_STACK_MAX);
    });

    it("moves one rung at a time", async () => {
        const { service } = await createHarness();
        service.addFont("a");
        service.addFont("b");
        service.addFont("c");

        expect(service.moveFont("c", -1)).toBe(true);
        expect(service.listFonts().map(entry => entry.assetId)).toEqual(["a", "c", "b"]);
        expect(service.moveFont("a", 1)).toBe(true);
        expect(service.listFonts().map(entry => entry.assetId)).toEqual(["c", "a", "b"]);
    });

    /** The end of the list is a no-op, never a wrap - a wrap is the one outcome nobody meant. */
    it("does not wrap at either end", async () => {
        const { service } = await createHarness();
        service.addFont("a");
        service.addFont("b");

        expect(service.moveFont("a", -1)).toBe(false);
        expect(service.moveFont("b", 1)).toBe(false);
        expect(service.listFonts().map(entry => entry.assetId)).toEqual(["a", "b"]);
    });

    it("removes, and reports a font that was not there", async () => {
        const { service } = await createHarness();
        service.addFont("a");

        expect(service.removeFont("b")).toBe(false);
        expect(service.removeFont("a")).toBe(true);
        expect(service.listFonts()).toEqual([]);
        expect(getActiveProjectFontIds()).toEqual([]);
    });

    it("notifies subscribers", async () => {
        const { service } = await createHarness();
        const seen: number[] = [];
        const unsubscribe = service.onFontsChanged(fonts => seen.push(fonts.length));

        service.addFont("a");
        service.addFont("b");
        service.removeFont("a");
        unsubscribe();
        service.addFont("c");

        expect(seen).toEqual([1, 2, 1]);
    });
});

/**
 * The language half of the stack: a rung may name the languages it is for, and the window resolves
 * the stack in the project's source language.
 */
describe("BrandService font languages", () => {
    it("adds a rung with the restriction it was given, and one without when it was not", async () => {
        const { service, files } = await createHarness();

        service.addFont("jp", ["ja"]);
        service.addFont("serif");
        service.addFont("empty", []);

        expect(service.listFonts()).toEqual([
            { assetId: "jp", locales: ["ja"] },
            { assetId: "serif" },
            { assetId: "empty" },
        ]);
        await service.flushPendingChanges();
        expect(JSON.parse(files.get(DOCUMENT)!).fonts[0]).toEqual({ assetId: "jp", locales: ["ja"] });
    });

    // Whole-list, because the control is a set of checkboxes and what it has to be able to say is
    // "this is the set now".
    it("replaces a rung's restriction, and clearing it means every language again", async () => {
        const { service } = await createHarness();
        service.addFont("jp");

        expect(service.setFontLocales("jp", ["ja", "zh-Hans"])).toBe(true);
        expect(service.listFonts()).toEqual([{ assetId: "jp", locales: ["ja", "zh-Hans"] }]);

        expect(service.setFontLocales("jp", [])).toBe(true);
        expect(service.listFonts()).toEqual([{ assetId: "jp" }]);
    });

    it("reports a rung that is not on the stack, and a write that changes nothing", async () => {
        const { service } = await createHarness();
        service.addFont("jp", ["ja"]);

        expect(service.setFontLocales("gone", ["ja"])).toBe(false);
        // Already exactly this: a write here would mark the document dirty and repaint every text
        // widget in the project for no change at all.
        expect(service.setFontLocales("jp", ["ja"])).toBe(false);
    });

    /**
     * What makes one list serve every language. The published ids are the source language's stack;
     * the whole list is still what the Design surface reads.
     */
    it("publishes the stack resolved in the project's source language", async () => {
        const { service } = await createHarness(undefined, { sourceLocale: "ja" });

        service.addFont("jp", ["ja"]);
        service.addFont("sc", ["zh-Hans"]);
        service.addFont("serif");

        expect(getActiveProjectFontIds()).toEqual(["jp", "serif"]);
        expect(service.listFonts().map(entry => entry.assetId)).toEqual(["jp", "sc", "serif"]);
    });

    it("leaves the whole stack published when the project has no source language", async () => {
        const { service } = await createHarness();

        service.addFont("jp", ["ja"]);
        service.addFont("serif");

        expect(getActiveProjectFontIds()).toEqual(["jp", "serif"]);
    });
});

describe("BrandService inside a live session", () => {
    /** A sink that takes everything and remembers it - what `LiveSession` installs, minus the room. */
    function sink(): { ops: LiveBrandOp[]; handle(op: LiveBrandOp): boolean } {
        const ops: LiveBrandOp[] = [];
        return {
            ops,
            handle(op) {
                ops.push(op);
                return true;
            },
        };
    }

    it("states every colour gesture and leaves the palette alone", async () => {
        const { service } = await createHarness();
        const created = service.createColor({ name: "Ink", value: "#101318" });
        const taken = sink();
        service.setOperationSink(taken);

        service.renameColor(created.id, "Charcoal");
        service.updateColor(created.id, { value: "#000000" });
        service.moveColor(created.id, null);
        service.deleteColor(created.id);

        expect(taken.ops.map(op => op.op)).toEqual([
            "update-brand-color",
            "update-brand-color",
            "move-brand-color",
            "delete-brand-color",
        ]);
        expect(service.getColor(created.id)).toEqual({ id: created.id, name: "Ink", value: "#101318" });
    });

    it("states the font stack whole, which is what all four of its gestures produce", async () => {
        // The one verb here that is not about a record: appending a rung, restricting one to some
        // languages, removing one and moving one all state a new order of at most a handful of
        // entries, and none of them has a draft layer to lose.
        const { service } = await createHarness();
        service.addFont("serif");
        const taken = sink();
        service.setOperationSink(taken);

        service.addFont("sans");
        service.setFontLocales("serif", ["ja"]);
        service.removeFont("serif");

        // Each one states the stack it would have produced from the stack this window still holds -
        // nothing lands here, so the second and third are not built on the first.
        expect(taken.ops.map(op => op.op)).toEqual(["set-brand-fonts", "set-brand-fonts", "set-brand-fonts"]);
        expect(taken.ops.map(op => (op.op === "set-brand-fonts" ? op.fonts : []))).toEqual([
            [{ assetId: "serif" }, { assetId: "sans" }],
            [{ assetId: "serif", locales: ["ja"] }],
            [],
        ]);
        // And the stack this window holds has not moved at all.
        expect(service.listFonts().map(font => font.assetId)).toEqual(["serif"]);
    });

    it("addresses a seeded slot like any other, because re-pointing one is the whole feature", async () => {
        const { service } = await createHarness();
        const seeded = BUILTIN_BRAND_COLORS[0]!.id;
        const taken = sink();
        service.setOperationSink(taken);

        service.updateColor(seeded, { value: "#ABCDEF" });
        expect(taken.ops[0]).toEqual({
            op: "update-brand-color",
            colorId: seeded,
            color: expect.objectContaining({ id: seeded, value: "#ABCDEF" }),
        });
    });

    it("refuses to state a delete of a seeded slot, exactly as it refuses to perform one", async () => {
        const { service } = await createHarness();
        const taken = sink();
        service.setOperationSink(taken);

        expect(service.deleteColor(BUILTIN_BRAND_COLORS[0]!.id)).toBe(false);
        expect(taken.ops).toEqual([]);
    });

    it("publishes the palette when an effect arrives, or the window would paint a frame behind", async () => {
        // Every colour field in Studio reads the module-level palette rather than this service, so an
        // effect that reached the document without publishing would be a colour nothing paints with
        // until something unrelated repainted.
        const { service } = await createHarness();
        service.setOperationSink(sink());

        service.applyLiveOp({ op: "create-brand-color", color: { id: "c1a2b3c", name: "Ink", value: "#101318" } });
        expect(service.getColor("c1a2b3c")?.value).toBe("#101318");
        expect(getActiveBrandPalette().resolveCss("c1a2b3c")).toBe("#101318");
    });

    it("puts a colour back where it sat when an effect names its neighbour", async () => {
        const { service } = await createHarness();
        service.setOperationSink(sink());
        service.applyLiveOp({ op: "create-brand-color", color: { id: "aaaaaaa", value: "#000000" } });
        service.applyLiveOp({ op: "create-brand-color", color: { id: "bbbbbbb", value: "#111111" } });
        service.applyLiveOp({ op: "delete-brand-color", colorId: "aaaaaaa" });

        service.applyLiveOp({ op: "create-brand-color", color: { id: "aaaaaaa", value: "#000000" }, beforeId: "bbbbbbb" });
        const authored = service.listColors().filter(color => !color.builtin).map(color => color.id);
        expect(authored).toEqual(["aaaaaaa", "bbbbbbb"]);
    });

    it("does not resurrect a colour an effect names that this machine does not hold", async () => {
        const { service } = await createHarness();
        service.applyLiveOp({ op: "update-brand-color", colorId: "gone", color: { id: "gone", value: "#000000" } });
        expect(service.getColor("gone")).toBeUndefined();
    });
});
