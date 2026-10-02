// @vitest-environment jsdom
import { readFileSync } from "fs";
import { join } from "path";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The incoming picture of a stage image's transition is placed the way it will be at rest.
 *
 * narraleaf-react draws an image as a box (`[data-image-id]`) sized to its picture, with the
 * picture inside it. At rest the picture sits in the box by layout alone; while a transition runs,
 * the incoming picture is centred with `top/left: 50%` plus `translate(-50%, -50%)`. On a stage
 * scaled by a non-integer factor those two land on different sub-pixel positions, so when the
 * transition ends the background visibly steps by under a pixel and sharpens - measured in the real
 * Dev Mode window at up to 0.6px across and 0.7px down. styles.css repositions the incoming picture
 * so the last frame of a transition and the settled frame are laid out the same way.
 *
 * What this can see is the cascade, not the pixels: jsdom resolves which declarations win, it does
 * not lay anything out. The pixel half was measured in the app (see the comment above the rules in
 * styles.css); this pins the half that can regress silently - a selector that stops matching, or a
 * rule that starts reaching something it should not.
 */

const STYLESHEET = join(process.cwd(), "src", "renderer", "styles", "styles.css");

/**
 * The inline styles narraleaf-react's `Image` writes on a non-layered picture while a transition
 * runs: the outgoing picture keeps its resting style, the incoming one gets the centring style.
 * Copied from the engine's `transitionsProps`; the strings are what the selector keys on.
 */
const SETTLED_STYLE: Record<string, string> = {
    position: "absolute",
    transformOrigin: "center",
    transform: "none",
    top: "auto",
    left: "auto",
    right: "auto",
    bottom: "auto",
    filter: "brightness(1)",
};
const INCOMING_STYLE: Record<string, string> = {
    position: "absolute",
    transformOrigin: "center",
    transform: "translate(-50%, -50%)",
    top: "50%",
    left: "50%",
    right: "auto",
    bottom: "auto",
    maxWidth: "none",
    maxHeight: "none",
    filter: "brightness(1)",
};

/** The properties that decide where a picture is drawn inside its box. */
const PLACEMENT = ["position", "top", "left", "right", "bottom", "transform"] as const;

/** Only the rules about the engine's stage: the rest of the sheet is Studio chrome and Tailwind directives. */
function stageRules(): string {
    const root = postcss.parse(readFileSync(STYLESHEET, "utf8"));
    const rules: string[] = [];
    root.walkRules(rule => {
        if (rule.selector.includes(".__narraleaf_content-player")) {
            rules.push(rule.toString());
        }
    });
    return rules.join("\n");
}

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attributes: Record<string, string> = {},
    style: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
        node.setAttribute(name, value);
    }
    Object.assign(node.style, style);
    return node;
}

/** An image the engine has mid-transition, inside a player, in the shape `Image` renders it. */
function imageMidTransition(incomingStyle: Record<string, string> = INCOMING_STYLE) {
    const player = element("div", { class: "__narraleaf_content-player" });
    const wrapper = element("div", { "data-element-type": "image", class: "absolute w-max h-max" });
    const box = element("div", { "data-image-id": "background", class: "relative h-full w-full" }, {
        width: "1283.55px",
        height: "721.85px",
    });
    const settled = element("img", {}, SETTLED_STYLE);
    const incoming = element("img", {}, incomingStyle);
    box.append(settled, incoming, element("div", { class: "w-full h-full top-0 left-0 absolute" }));
    wrapper.append(box);
    player.append(wrapper);
    document.body.append(player);
    return { box, settled, incoming };
}

function placementOf(node: Element): Record<string, string> {
    const style = getComputedStyle(node);
    return Object.fromEntries(PLACEMENT.map(property => [property, style.getPropertyValue(property)]));
}

describe("stage image transition placement", () => {
    beforeAll(() => {
        const sheet = document.createElement("style");
        sheet.textContent = stageRules();
        document.head.append(sheet);
    });

    it("draws the incoming picture where the settled picture is drawn", () => {
        const { settled, incoming } = imageMidTransition();
        // The engine's own centring really is on the element - the rule overrides it, not replaces it.
        expect(incoming.getAttribute("style")).toContain("transform: translate(-50%, -50%)");
        expect(placementOf(incoming)).toEqual(placementOf(settled));
        expect(placementOf(incoming)).toMatchObject({ top: "auto", left: "auto", transform: "none" });
    });

    it("centres the box's pictures by layout, so one of a different size still lands in the middle", () => {
        const { box } = imageMidTransition();
        const style = getComputedStyle(box);
        expect(style.display).toBe("flex");
        expect(style.alignItems).toBe("center");
        expect(style.justifyContent).toBe("center");
    });

    it("leaves a transition that writes a transform of its own alone", () => {
        const { incoming } = imageMidTransition({ ...INCOMING_STYLE, transform: "scale(1.2)" });
        expect(placementOf(incoming)).toMatchObject({ top: "50%", left: "50%", transform: "scale(1.2)" });
    });

    it("leaves the layers of a layered picture alone, which never change how they are centred", () => {
        const { box } = imageMidTransition();
        const stack = element("div", {}, { position: "absolute", top: "0px", left: "0px", right: "0px", bottom: "0px" });
        const layer = element("img", {}, {
            position: "absolute",
            transformOrigin: "center",
            transform: "translate(-50%, -50%)",
            top: "50%",
            left: "50%",
        });
        stack.append(layer);
        box.append(stack);
        expect(placementOf(layer)).toMatchObject({ top: "50%", left: "50%", transform: "translate(-50%, -50%)" });
    });

    it("does not reach a picture outside the engine's player", () => {
        const box = element("div", { "data-image-id": "elsewhere" });
        const incoming = element("img", {}, INCOMING_STYLE);
        box.append(incoming);
        document.body.append(box);
        expect(getComputedStyle(box).display).toBe("block");
        expect(placementOf(incoming)).toMatchObject({ top: "50%", transform: "translate(-50%, -50%)" });
    });
});
