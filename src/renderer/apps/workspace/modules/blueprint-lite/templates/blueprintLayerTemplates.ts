/**
 * The layers a blueprint with none yet can start from.
 *
 * Each template is written in the blueprint text format (`.bp`) and goes through the same parser and
 * compiler the blueprint CLI uses, which check every node type, pin and field against the live node
 * registry. So there is no second catalogue here to fall behind: a node renamed in the registry is a
 * template that fails `blueprintLayerTemplates.test.ts`, not one that quietly builds a broken graph.
 *
 * A template says which owner kinds it is for. A widget's templates are narrowed again by the widget
 * itself - a click template on a list, which has no click, is not offered - and that narrowing is the
 * compiler's own scope check rather than a list kept beside it (see `buildBlueprintLayerTemplate`).
 *
 * Comments in English per project convention.
 */

import type { LucideIcon } from "lucide-react";
import {
    ArrowLeft,
    ArrowRight,
    AudioLines,
    Camera,
    Clapperboard,
    Keyboard,
    Layers,
    Maximize,
    MessageSquareWarning,
    Music,
    PanelsTopLeft,
    Play,
    Power,
    Scaling,
    Volume2,
} from "lucide-react";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";

export type BlueprintLayerTemplateId =
    | "splash"
    | "pressAnyKey"
    | "pageMusic"
    | "escapeBack"
    | "escapeMenu"
    | "confirmClose"
    | "fullscreenKey"
    | "screenshotKey"
    | "openPage"
    | "startGame"
    | "goBack"
    | "overlayPage"
    | "quitApp"
    | "clickSound"
    | "hoverSound"
    | "hoverGrow";

/** Text a template writes into the graph itself, in the editor's language. */
export type BlueprintLayerTemplateText = "quitQuestion" | "quitConfirm" | "quitCancel";

/**
 * What the project already says that a template can start from, instead of leaving a picker empty.
 *
 * Every one of these is read off the project, never guessed: absent means the project does not
 * answer it, and the node is left for the author to fill in.
 */
export type BlueprintLayerTemplateFacts = {
    /**
     * The one element on this page, when the page holds exactly one - fading it is fading everything
     * the page shows. A page holding several has no single answer.
     */
    pageContent?: { surfaceId: string; elementId: string };
    /** The page the project's other confirmations already ask through. */
    confirmPage?: string;
    /** Where the game begins: the default story and the scene it opens on. */
    gameStart?: { storyId: string; sceneId: string };
    text: (key: BlueprintLayerTemplateText) => string;
};

export type BlueprintLayerTemplate = {
    id: BlueprintLayerTemplateId;
    owners: readonly BlueprintOwnerRef["kind"][];
    icon: LucideIcon;
    /** The layer's nodes and edges, in the blueprint text format, without the `event` line. */
    graph: (facts: BlueprintLayerTemplateFacts) => string;
    /**
     * Whether the template can go into this project at all, for the one whose graph would trap the
     * player while a choice is still empty. Absent means always.
     */
    available?: (facts: BlueprintLayerTemplateFacts) => boolean;
    /**
     * The fields the author is expected to choose, by node. A node any of these is still empty on is
     * selected once the layer exists, so the canvas opens on what is left to do.
     */
    choices?: Readonly<Record<string, readonly string[]>>;
};

const WIDGET_OWNERS = ["widgetMain", "componentWidgetMain"] as const;

/** A `key = value` line under a node, or nothing when there is no value to write. */
function field(key: string, value: string | undefined): string {
    return value === undefined ? "" : `        ${key} = ${JSON.stringify(value)}`;
}

function lines(...rows: string[]): string {
    return rows.filter(row => row.length > 0).join("\n");
}

/** `Show Confirm` asking whether to quit, with Quit as the first button and Cancel as the second. */
function quitConfirmNode(id: string, position: string, facts: BlueprintLayerTemplateFacts): string {
    return lines(
        `    ${id}: blueprint.layer.confirm ${position}`,
        field("surfaceId", facts.confirmPage),
        `        __confirmButtonPins = ["button_1_label","button_1_pressed","button_2_label","button_2_pressed"]`,
        field("message", facts.text("quitQuestion")),
        field("button_1_label", facts.text("quitConfirm")),
        field("button_2_label", facts.text("quitCancel")),
    );
}

/**
 * Every template, in the order a tile grid shows them. Within an owner kind the commonest need
 * comes first.
 */
export const BLUEPRINT_LAYER_TEMPLATES: readonly BlueprintLayerTemplate[] = [
    {
        id: "splash",
        owners: ["surfaceMain"],
        icon: Clapperboard,
        // Faded from Surface Init, which runs before the page is first painted, so the content is
        // already transparent when it appears rather than drawn once and then hidden. The hold is
        // the fade-out's own delay rather than a Delay node, which keeps the graph narrow enough to
        // be read whole in a narrow editor.
        graph: facts => lines(
            "    init: blueprint.event.head.surfaceInit @0,0",
            "    content: blueprint.element.ref @0,140",
            field("surfaceId", facts.pageContent?.surfaceId),
            field("elementId", facts.pageContent?.elementId),
            "    fadeIn: blueprint.element.displayable.animateProperty @260,0",
            "        property = opacity",
            "        from = 0",
            "        to = 100",
            "        duration = 1",
            "        easing = easeOut",
            "    fadeOut: blueprint.element.displayable.animateProperty @580,0",
            "        property = opacity",
            "        from = 100",
            "        to = 0",
            "        duration = 1",
            "        delay = 2",
            "        easing = easeIn",
            "    next: blueprint.page.go @900,0",
            "    click: blueprint.event.head.mouseClick @580,360",
            "    key: blueprint.event.head.anyKeyDown @580,500",
            "    init -> fadeIn -> fadeOut -> next",
            "    content.element -> fadeIn.element",
            "    content.element -> fadeOut.element",
            "    click -> next",
            "    key -> next",
        ),
        choices: { content: ["elementId"], next: ["surfaceId"] },
    },
    {
        id: "pressAnyKey",
        owners: ["surfaceMain"],
        icon: Keyboard,
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    key: blueprint.event.head.anyKeyDown @0,160",
            "    next: blueprint.page.go @260,80",
            "    click -> next",
            "    key -> next",
        ),
        choices: { next: ["surfaceId"] },
    },
    {
        id: "pageMusic",
        owners: ["surfaceMain"],
        icon: Music,
        // Stop Sound with no handle stops what this page started, which is the music and nothing
        // another page owns.
        graph: () => lines(
            "    enter: blueprint.event.head.afterSurfaceEnter @0,0",
            "    play: blueprint.sound.play @260,0",
            "        audioTrackId = bgm",
            "    exit: blueprint.event.head.beforeSurfaceExit @0,220",
            "    stop: blueprint.sound.stop @260,220",
            "        fade = 1",
            "    enter -> play",
            "    exit -> stop",
        ),
        choices: { play: ["soundAssetId"] },
    },
    {
        id: "escapeBack",
        owners: ["surfaceMain"],
        icon: ArrowLeft,
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=Escape @0,0",
            "    back: blueprint.page.back @260,0",
            "    key -> back",
        ),
    },
    {
        id: "escapeMenu",
        owners: ["surfaceMain"],
        icon: PanelsTopLeft,
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=Escape @0,0",
            "    menu: blueprint.layer.show @260,0",
            "        modal = true",
            "        dismissible = true",
            "    key -> menu",
        ),
        choices: { menu: ["surfaceId"] },
    },
    {
        id: "confirmClose",
        owners: ["globalMain"],
        icon: MessageSquareWarning,
        // The close request waits for this graph, so the window is kept first and the question
        // asked after; Quit Application is what closes it once the player agrees. Offered only
        // where the project already has a page it asks through: with the page left to choose, the
        // window would be kept open and the question never asked, and the close button would do
        // nothing at all.
        available: facts => facts.confirmPage !== undefined,
        graph: facts => lines(
            "    close: blueprint.event.head.windowCloseRequested @0,0",
            "    keep: blueprint.app.keepWindowOpen @260,0",
            quitConfirmNode("ask", "@520,0", facts),
            "    quit: blueprint.page.quit @840,0",
            "    close -> keep -> ask",
            "    ask.button_1_pressed -> quit",
        ),
        choices: { ask: ["surfaceId"] },
    },
    {
        id: "fullscreenKey",
        owners: ["globalMain"],
        icon: Maximize,
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=f11 @0,0",
            "    toggle: blueprint.app.setFullscreen mode=toggle @260,0",
            "    key -> toggle",
        ),
    },
    {
        id: "screenshotKey",
        owners: ["globalMain"],
        icon: Camera,
        graph: () => lines(
            "    key: blueprint.event.head.keyDown key=S @0,0",
            "    shot: blueprint.app.saveScreenshot @260,0",
            "    key -> shot",
        ),
    },
    {
        id: "openPage",
        owners: WIDGET_OWNERS,
        icon: ArrowRight,
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    open: blueprint.page.go @260,0",
            "    click -> open",
        ),
        choices: { open: ["surfaceId"] },
    },
    {
        id: "startGame",
        owners: WIDGET_OWNERS,
        icon: Play,
        graph: facts => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    start: blueprint.game.startStory @260,0",
            field("storyId", facts.gameStart?.storyId),
            field("sceneId", facts.gameStart?.sceneId),
            "    click -> start",
        ),
        choices: { start: ["storyId", "sceneId"] },
    },
    {
        id: "goBack",
        owners: WIDGET_OWNERS,
        icon: ArrowLeft,
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    back: blueprint.page.back @260,0",
            "    click -> back",
        ),
    },
    {
        id: "overlayPage",
        owners: WIDGET_OWNERS,
        icon: Layers,
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    show: blueprint.layer.show @260,0",
            "        modal = true",
            "        dismissible = true",
            "    click -> show",
        ),
        choices: { show: ["surfaceId"] },
    },
    {
        id: "quitApp",
        owners: WIDGET_OWNERS,
        icon: Power,
        graph: facts => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            quitConfirmNode("ask", "@260,0", facts),
            "    quit: blueprint.page.quit @580,0",
            "    click -> ask",
            "    ask.button_1_pressed -> quit",
        ),
        choices: { ask: ["surfaceId"] },
    },
    {
        id: "clickSound",
        owners: WIDGET_OWNERS,
        icon: Volume2,
        graph: () => lines(
            "    click: blueprint.event.head.mouseClick @0,0",
            "    play: blueprint.sound.play @260,0",
            "        audioTrackId = sound",
            "    click -> play",
        ),
        choices: { play: ["soundAssetId"] },
    },
    {
        id: "hoverSound",
        owners: WIDGET_OWNERS,
        icon: AudioLines,
        graph: () => lines(
            "    enter: blueprint.event.head.mouseEnter @0,0",
            "    play: blueprint.sound.play @260,0",
            "        audioTrackId = sound",
            "    enter -> play",
        ),
        choices: { play: ["soundAssetId"] },
    },
    {
        id: "hoverGrow",
        owners: WIDGET_OWNERS,
        icon: Scaling,
        // No `from`: each animation starts wherever the last one left the widget, so a pointer that
        // leaves halfway through growing shrinks back from there rather than jumping.
        graph: () => lines(
            "    enter: blueprint.event.head.mouseEnter @0,0",
            "    grow: blueprint.displayable.animateProperty @260,0",
            "        property = scale",
            "        to = 1.05",
            "        duration = 0.15",
            "        easing = easeOut",
            "    leave: blueprint.event.head.mouseLeave @0,340",
            "    shrink: blueprint.displayable.animateProperty @260,340",
            "        property = scale",
            "        to = 1",
            "        duration = 0.15",
            "        easing = easeOut",
            "    enter -> grow",
            "    leave -> shrink",
        ),
    },
];
