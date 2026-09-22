/**
 * The starter template's CG viewer, played rather than read.
 *
 * `starterExtraScreen.test.ts` says what the graphs are made of; this runs them. The shipped page,
 * the shipped grid and viewer blueprints and the shipped Global (whose confirm cue the press calls)
 * are loaded as they are on disk and driven through what a game uses - the Dev Mode host adapter,
 * the real host API, the built-in nodes, and the Gallery plugin's own nodes over a catalog written
 * here. What is asserted is what a player would see: which picture the viewer holds after each
 * press, whether it is open, and whether the page was left.
 *
 * The walk is the part worth running. Each press steps along the artwork's variants from the one on
 * screen, skips a locked one, wraps from the last to the first, and closes on coming back to the
 * picture the viewer opened on - four rules that read correctly on a canvas and can each be off by
 * one in a way no structural check would notice.
 *
 * Comments in English per project convention.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Blueprint } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { buildUIListItemInstanceKey, type UIListItemScope } from "@shared/types/ui-editor/list";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import type { BlueprintNodeDef } from "@/lib/ui-editor/blueprint-nodes/types";
import { createRowRuntime } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import {
    normalizeGalleryStore,
    projectGalleryEntries,
    readUnlockedVariantIds,
    RUNTIME_UNLOCKED_KEY,
} from "../../../builtin-plugins/gallery/catalog";
import { createGalleryBlueprintNodes } from "../../../builtin-plugins/gallery/nodes";

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton/content/editor/ui");
const document = JSON.parse(fs.readFileSync(path.join(TEMPLATE, "uidoc.json"), "utf-8")) as UIDocument;
const shipped = Object.values(
    (JSON.parse(fs.readFileSync(path.join(TEMPLATE, "uigraphs.json"), "utf-8")) as {
        blueprintDocument: { blueprints: Record<string, Blueprint> };
    }).blueprintDocument.blueprints,
);

const EXTRA = document.surfaces.find(surface => surface.name === "Extra")!;

function elementNamed(name: string, type: string): string {
    const found = Object.values(document.elements).filter(element => element.name === name && element.type === type);
    expect(found, `the template has ${found.length} ${type} named ${name}`).toHaveLength(1);
    return found[0]!.id;
}

const GRID = elementNamed("CG grid", "nl.list");
const VIEWER = elementNamed("Viewer", "nl.container");
/** The viewer's picture: the only image inside it. */
const PICTURE = (document.elements[VIEWER]!.childrenIds ?? []).find(id => document.elements[id]?.type === "nl.image")!;

/** The Extra page's own blueprints, and the Global whose Fn plays the confirm cue. */
const BLUEPRINTS = shipped.filter(blueprint => {
    const owner = blueprint.owner as { kind: string; surfaceId?: string };
    return owner.kind === "globalMain" || owner.surfaceId === EXTRA.id;
});

/**
 * One artwork per case, four variants each. Which are unlocked, and which is the authored cover,
 * is what the cases vary.
 */
const CATALOG = {
    version: 2,
    items: ["mid", "lockedCover", "single", "sealed"].map(artwork => ({
        id: artwork,
        name: artwork,
        kind: "cg",
        variants: ["a", "b", "c", "d"].map(variant => ({
            id: `${artwork}.${variant}`,
            name: variant,
            imageAssetId: `asset-${artwork}-${variant}`,
        })),
        coverVariantId: artwork === "lockedCover" ? "lockedCover.a" : `${artwork}.c`,
    })),
};

/** What the player has found. */
const UNLOCKED = [
    // b locked, c the cover: opens on c, then d, a, and b is never shown.
    "mid.a", "mid.c", "mid.d",
    // The cover is locked, so the tile shows the first unlocked variant, b - and so does the viewer.
    "lockedCover.b", "lockedCover.d",
    "single.c",
];

let persisted: Record<string, unknown> = {};

/**
 * The Gallery plugin's nodes as the game registers them: the plugin's own definitions, handed the
 * narrowed context a plugin node gets, over the catalog above and a store this file holds.
 */
function registerGalleryNodes(): void {
    for (const def of createGalleryBlueprintNodes(() => CATALOG)) {
        if (blueprintNodeRegistry.get(def.type)) {
            continue;
        }
        blueprintNodeRegistry.register({
            ...(def as unknown as BlueprintNodeDef),
            execute: ctx => def.execute({
                params: ctx.params,
                resolveInput: ctx.resolveInput,
                game: {
                    log: () => undefined,
                    store: {
                        get: async (key: string) => persisted[key] ?? null,
                        set: async (key: string, value: unknown) => {
                            persisted[key] = value;
                        },
                    },
                },
            } as never) as never,
        });
    }
}

/** The CG grid's row for one artwork, projected by the catalog exactly as `Get Gallery` hands it over. */
function rowFor(artworkId: string): UIListItemScope {
    const store = normalizeGalleryStore(CATALOG);
    const unlocked = readUnlockedVariantIds(UNLOCKED, store.items);
    const rows = projectGalleryEntries(store, unlocked, { kind: "cg" });
    const index = rows.findIndex(row => row.id === artworkId);
    return {
        item: rows[index] as unknown as Record<string, unknown>,
        index,
        count: rows.length,
        key: artworkId,
        struct: document.structs!["extra.galleryEntry"]!,
        selected: false,
    };
}

type Page = ReturnType<typeof createRowRuntime>;

let page: Page;
let leftThePage = 0;

function open(): Page {
    page = createRowRuntime(BLUEPRINTS, {
        document,
        surfaceId: EXTRA.id,
        onPageBack: () => {
            leftThePage += 1;
        },
    });
    return page;
}

async function pressTile(artworkId: string): Promise<void> {
    await page.runtime.dispatchElementBlueprintEvent(GRID, "itemClick", { index: rowFor(artworkId).index }, {
        listItemScope: rowFor(artworkId),
        instanceKey: buildUIListItemInstanceKey(undefined, GRID, artworkId),
    });
}

async function pressViewer(): Promise<void> {
    await page.runtime.dispatchElementBlueprintEvent(VIEWER, "mouseClick", {});
}

async function rightClickViewer(): Promise<void> {
    await page.runtime.dispatchElementBlueprintEvent(VIEWER, "rightClick", {});
}

async function escape(): Promise<void> {
    await page.runtime.dispatchSurfaceInputAction!({ actionId: "dismiss", source: "key" });
}

/** Whether the viewer is open, from the last visibility the graphs wrote to it. */
function viewerOpen(): boolean {
    const writes = page.visibleWrites().filter(([address]) => address === VIEWER);
    return writes.length > 0 && writes[writes.length - 1]![1] === true;
}

/** The picture the viewer holds, read back through the host the way a graph would. */
function picture(): string | null {
    return page.hostApi.widget.getImageProperties(PICTURE).assetId;
}

beforeAll(() => {
    registerCoreBlueprintNodes();
    registerGalleryNodes();
});

beforeEach(() => {
    persisted = { [RUNTIME_UNLOCKED_KEY]: [...UNLOCKED] };
    leftThePage = 0;
});

afterEach(() => {
    page.release();
    expect(page.errors).toEqual([]);
});

describe("the starter template's CG viewer, played", () => {
    it("opens on the picture the tile shows, then steps past a locked variant and round to the start", async () => {
        open();
        await pressTile("mid");
        expect(viewerOpen()).toBe(true);
        expect(picture()).toBe("asset-mid-c");

        const seen: (string | null)[] = [];
        for (let press = 0; press < 2; press += 1) {
            await pressViewer();
            expect(viewerOpen()).toBe(true);
            seen.push(picture());
        }
        // From the cover to the end, then round to the first: every unlocked picture once, b never.
        expect(seen).toEqual(["asset-mid-d", "asset-mid-a"]);

        // The next unlocked one is where it started, so the press after the last closes it.
        await pressViewer();
        expect(viewerOpen()).toBe(false);
        expect(leftThePage).toBe(0);
    });

    it("starts from the variant the tile shows when the authored cover is still locked", async () => {
        open();
        await pressTile("lockedCover");
        expect(picture()).toBe("asset-lockedCover-b");

        await pressViewer();
        expect(picture()).toBe("asset-lockedCover-d");
        await pressViewer();
        expect(viewerOpen()).toBe(false);
    });

    it("closes on the first press when the artwork has one picture found", async () => {
        open();
        await pressTile("single");
        expect(picture()).toBe("asset-single-c");
        await pressViewer();
        expect(viewerOpen()).toBe(false);
    });

    it("does nothing at all for a locked tile", async () => {
        open();
        await pressTile("sealed");
        expect(page.visibleWrites()).toEqual([]);
        expect(picture()).toBeNull();
    });

    it("starts over on the tile pressed next, however far the last one got", async () => {
        open();
        await pressTile("mid");
        await pressViewer();
        await rightClickViewer();
        expect(viewerOpen()).toBe(false);

        await pressTile("lockedCover");
        expect(picture()).toBe("asset-lockedCover-b");
        await pressViewer();
        expect(picture()).toBe("asset-lockedCover-d");
        await pressViewer();
        expect(viewerOpen()).toBe(false);
    });

    it("closes on the page's dismiss action while open, and only then leaves the screen", async () => {
        open();
        await pressTile("mid");
        await escape();
        expect(viewerOpen()).toBe(false);
        expect(leftThePage).toBe(0);

        await escape();
        expect(leftThePage).toBe(1);
    });
});
