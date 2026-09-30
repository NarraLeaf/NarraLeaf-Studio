import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "./document";
import {
    UI_FRAME_ELEMENT_TYPE,
    findUIFrameHost,
    getUIFrameTargetInvalidReason,
    listUIFrameSites,
    normalizeUIFrameWidgetProps,
} from "./frame";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "./pageAnimation";

function root(id: string, childrenIds: string[] = []): UIElement {
    return {
        id,
        type: "nl.root",
        parentId: null,
        childrenIds,
        layout: { x: 0, y: 0, width: 320, height: 180 },
    };
}

function frame(id: string, parentId: string, targetSurfaceId: string | null): UIElement {
    return {
        id,
        type: UI_FRAME_ELEMENT_TYPE,
        parentId,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 160, height: 90 },
        props: normalizeUIFrameWidgetProps({ targetSurfaceId }),
    };
}

function createDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "page-a",
                name: "Page A",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-a",
            },
            {
                id: "page-b",
                name: "Page B",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-b",
            },
            {
                id: "page-c",
                name: "Page C",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-c",
            },
            {
                id: "game-ui",
                name: "HUD",
                host: "player",
                kind: "stageSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root-game",
                mount: { kind: "slot", slotId: "onStage" },
            },
        ],
        elements: {
            "root-a": root("root-a", ["frame-a"]),
            "frame-a": frame("frame-a", "root-a", null),
            "root-b": root("root-b", ["frame-b"]),
            "frame-b": frame("frame-b", "root-b", "page-a"),
            "root-c": root("root-c"),
            "root-game": root("root-game"),
        },
    };
}

describe("UI Frame target validation", () => {
    it("accepts another Page target", () => {
        const document = createDocument();

        expect(
            getUIFrameTargetInvalidReason({
                document,
                host: { kind: "surface", surfaceId: "page-a" },
                frameElementId: "frame-a",
                targetSurfaceId: "page-c",
            }),
        ).toBeNull();
    });

    it("rejects missing, non-Page, self, and cyclic targets", () => {
        const document = createDocument();

        expect(
            getUIFrameTargetInvalidReason({
                document,
                host: { kind: "surface", surfaceId: "page-a" },
                frameElementId: "frame-a",
                targetSurfaceId: "missing-page",
            }),
        ).toBe("missing");
        expect(
            getUIFrameTargetInvalidReason({
                document,
                host: { kind: "surface", surfaceId: "page-a" },
                frameElementId: "frame-a",
                targetSurfaceId: "game-ui",
            }),
        ).toBe("not_page");
        expect(
            getUIFrameTargetInvalidReason({
                document,
                host: { kind: "surface", surfaceId: "page-a" },
                frameElementId: "frame-a",
                targetSurfaceId: "page-a",
            }),
        ).toBe("self");
        expect(
            getUIFrameTargetInvalidReason({
                document,
                host: { kind: "surface", surfaceId: "page-a" },
                frameElementId: "frame-a",
                targetSurfaceId: "page-b",
            }),
        ).toBe("cycle");
    });

    it("normalizes optional Page component animation settings", () => {
        expect(normalizeUIFrameWidgetProps({ targetSurfaceId: "page-b" }).animation).toBeUndefined();
        expect(
            normalizeUIFrameWidgetProps({
                targetSurfaceId: "page-b",
                animation: {
                    enter: "fade",
                    exit: "slide",
                    enterDirection: "up",
                    exitDirection: "angle",
                    exitAngleDegrees: 225,
                    enterDurationSeconds: 0.35,
                    exitDurationSeconds: 0.75,
                    exitBlocking: true,
                },
            }).animation,
        ).toEqual({
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enter: "fade",
            exit: "slide",
            enterDirection: "up",
            exitDirection: "angle",
            enterAngleDegrees: 0,
            exitAngleDegrees: 225,
            enterDurationSeconds: 0.35,
            exitDurationSeconds: 0.75,
            exitBlocking: true,
        });
        expect(
            normalizeUIFrameWidgetProps({
                animation: {
                    enter: "spin",
                    exit: "explode",
                },
            }).animation,
        ).toEqual(DEFAULT_UI_PAGE_ANIMATION_SETTINGS);
        expect(
            normalizeUIFrameWidgetProps({
                animation: {
                    enter: "fade",
                    exit: "slide",
                    direction: "right",
                    speed: "fast",
                },
            }).animation,
        ).toEqual({
            ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
            enter: "fade",
            exit: "slide",
            enterDirection: "right",
            exitDirection: "right",
            enterDurationSeconds: 0.16,
            exitDurationSeconds: 0.16,
        });
    });
});

/**
 * A Page widget and a component placement both draw something else inside a tree, and the loop
 * check has to follow both.
 *
 * It used to follow Page widgets alone and only on pages, which was harmless while a Page widget
 * inside a component drew nothing. Now that one does draw its page, "a card's Page widget naming the
 * page the card sits on" is page -> card -> page, a loop with no page-to-page edge in it: it was
 * offered as a valid choice, and only the runtime's "Page loop blocked" caught it.
 */
describe("UI Frame target validation through components", () => {
    function page(id: string, rootElementId: string) {
        return {
            id,
            name: id,
            host: "app" as const,
            kind: "appSurface" as const,
            designSize: { width: 320, height: 180 },
            rootElementId,
        };
    }

    function placement(id: string, parentId: string, componentId: string): UIElement {
        return {
            id,
            type: "nl.container",
            parentId,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 160, height: 90 },
            extra: { componentLink: { componentId, linked: true } },
        };
    }

    function container(id: string, parentId: string | null, childrenIds: string[] = [], type = "nl.container"): UIElement {
        return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 160, height: 90 } };
    }

    /**
     * Pages `home`, `gallery` and `about`; a `card` definition holding a Page widget `window`, and an
     * `outer` definition that places the card. Where each is placed is up to the test.
     */
    function project(input: {
        home?: UIElement[];
        gallery?: UIElement[];
        cardTarget: string | null;
        outerPlacesCard?: boolean;
    }): UIDocument {
        const home = input.home ?? [];
        const gallery = input.gallery ?? [];
        const topLevel = (items: UIElement[], rootId: string) =>
            items.filter(item => item.parentId === rootId).map(item => item.id);
        return {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [page("home", "home-root"), page("gallery", "gallery-root"), page("about", "about-root")],
            elements: {
                "home-root": root("home-root", topLevel(home, "home-root")),
                ...Object.fromEntries(home.map(item => [item.id, item])),
                "gallery-root": root("gallery-root", topLevel(gallery, "gallery-root")),
                ...Object.fromEntries(gallery.map(item => [item.id, item])),
                "about-root": root("about-root"),
            },
            components: [
                {
                    id: "card",
                    name: "Card",
                    rootElementId: "card-root",
                    elements: {
                        "card-root": container("card-root", null, ["window"]),
                        window: frame("window", "card-root", input.cardTarget),
                    },
                },
                {
                    id: "outer",
                    name: "Outer",
                    rootElementId: "outer-root",
                    elements: {
                        "outer-root": container("outer-root", null, input.outerPlacesCard ? ["inner"] : []),
                        ...(input.outerPlacesCard ? { inner: placement("inner", "outer-root", "card") } : {}),
                    },
                },
            ],
        };
    }

    const card = { kind: "component", componentId: "card" } as const;

    it("refuses the page a card is placed on as the target of the card's Page widget", () => {
        const document = project({ home: [placement("slot", "home-root", "card")], cardTarget: null });

        expect(getUIFrameTargetInvalidReason({ document, host: card, frameElementId: "window", targetSurfaceId: "home" }))
            .toBe("cycle");
        expect(getUIFrameTargetInvalidReason({ document, host: card, frameElementId: "window", targetSurfaceId: "about" }))
            .toBeNull();
    });

    it("refuses a page that reaches the card through another page's Page widget", () => {
        // gallery shows home, and home places the card: the card may not show gallery either.
        const document = project({
            home: [placement("slot", "home-root", "card")],
            gallery: [frame("show-home", "gallery-root", "home")],
            cardTarget: null,
        });

        expect(getUIFrameTargetInvalidReason({ document, host: card, frameElementId: "window", targetSurfaceId: "gallery" }))
            .toBe("cycle");
    });

    it("refuses a page for a Page widget on a page when the loop runs back through a card", () => {
        // The card shows gallery, and home places the card: gallery's Page widget may not show home.
        const document = project({
            home: [placement("slot", "home-root", "card")],
            gallery: [frame("show", "gallery-root", null)],
            cardTarget: "gallery",
        });

        expect(getUIFrameTargetInvalidReason({
            document,
            host: { kind: "surface", surfaceId: "gallery" },
            frameElementId: "show",
            targetSurfaceId: "home",
        })).toBe("cycle");
        expect(getUIFrameTargetInvalidReason({
            document,
            host: { kind: "surface", surfaceId: "gallery" },
            frameElementId: "show",
            targetSurfaceId: "about",
        })).toBeNull();
    });

    it("follows a card placed inside another component", () => {
        const document = project({
            home: [placement("slot", "home-root", "outer")],
            cardTarget: null,
            outerPlacesCard: true,
        });

        expect(getUIFrameTargetInvalidReason({ document, host: card, frameElementId: "window", targetSurfaceId: "home" }))
            .toBe("cycle");
    });

    it("follows a card placed in a list row", () => {
        const document = project({
            home: [container("grid", "home-root", ["cell"], "nl.list"), placement("cell", "grid", "card")],
            cardTarget: null,
        });

        expect(getUIFrameTargetInvalidReason({ document, host: card, frameElementId: "window", targetSurfaceId: "home" }))
            .toBe("cycle");
    });

    it("does not count the widget's own current target as a way back", () => {
        // The card already names home, which is the loop; asking about about must not be refused
        // because of the answer it is replacing.
        const document = project({ home: [placement("slot", "home-root", "card")], cardTarget: "home" });

        expect(getUIFrameTargetInvalidReason({ document, host: card, frameElementId: "window", targetSurfaceId: "about" }))
            .toBeNull();
    });

    it("lists a definition's Page widget once, however many times it is placed, and finds where it is", () => {
        const document = project({
            home: [placement("a", "home-root", "card"), placement("b", "home-root", "card")],
            gallery: [frame("show", "gallery-root", "about")],
            cardTarget: "about",
        });

        expect(listUIFrameSites(document).map(site => [site.host, site.element.id])).toEqual([
            [{ kind: "surface", surfaceId: "gallery" }, "show"],
            [card, "window"],
        ]);
        expect(findUIFrameHost(document, "window")).toEqual(card);
        expect(findUIFrameHost(document, "show")).toEqual({ kind: "surface", surfaceId: "gallery" });
        expect(findUIFrameHost(document, "nowhere")).toBeNull();
    });
});
