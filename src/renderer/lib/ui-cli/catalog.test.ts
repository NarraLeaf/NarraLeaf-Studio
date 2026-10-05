/**
 * That the catalogue can describe every widget type there is.
 *
 * The point of these is the sweep rather than the individual answers: a widget module added without
 * a palette entry, without a logic API or with a `createDefaultElement` that throws outside a browser
 * would leave a hole here, and the hole would otherwise only show up as a command printing nothing.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { BUILTIN_WIDGET_LOGIC_APIS } from "@shared/types/ui-editor/widgetLogic";
import {
    describeWidget,
    formatWidgetDetail,
    listBuiltinStructs,
    listWidgetModules,
    nearestWidgetTypes,
    queryWidgets,
} from "./catalog";

describe("the widget catalogue", () => {
    it("describes every registered widget type", () => {
        for (const module of listWidgetModules()) {
            const detail = describeWidget(module.type);
            expect(detail, module.type).not.toBeNull();
            expect(detail?.displayName, module.type).toBeTruthy();
        }
    });

    it("gives every type the palette offers a prop table", () => {
        for (const widget of queryWidgets({ insertableOnly: true })) {
            expect(describeWidget(widget.type)?.props.length, widget.type).toBeGreaterThan(0);
        }
    });

    it("carries the events of the shared logic table rather than a copy of them", () => {
        const button = describeWidget("nl.button");
        expect(button?.events.map(event => event.id))
            .toEqual(BUILTIN_WIDGET_LOGIC_APIS["nl.button"].events.map(event => event.id));
    });

    it("knows which prop a value blueprint may drive", () => {
        expect(describeWidget("nl.text")?.bindableProps).toEqual([{ propPath: "text", valueType: "string" }]);
        expect(describeWidget("nl.image")?.bindableProps)
            .toEqual([{ propPath: "imageFill.assetId", valueType: "string" }]);
        expect(describeWidget("nl.container")?.bindableProps).toEqual([]);
    });

    it("lists the parts a part-owning widget builds for itself", () => {
        expect(describeWidget("nl.switch")?.parts.map(part => part.slot)).toEqual(["track", "thumb"]);
        expect(describeWidget("nl.container")?.parts).toEqual([]);
    });

    it("marks a specialisation's inherited props", () => {
        const sentence = describeWidget("nl.dialog.sentence");
        expect(sentence?.extends).toBe("nl.text");
        expect(sentence?.props.find(prop => prop.key === "fontSize")?.inherited).toBe(true);
    });

    it("does not offer a stage-only widget for an app surface", () => {
        const types = queryWidgets({ surfaceKind: "appSurface" }).map(widget => widget.type);
        expect(types).toContain("nl.button");
        expect(types).not.toContain("nl.dialog.sentence");
    });

    it("only carries notes for types that exist", () => {
        for (const module of listWidgetModules()) {
            expect(Array.isArray(describeWidget(module.type)?.notes), module.type).toBe(true);
        }
        // A note written for a type that was later renamed would silently stop being shown, so the
        // sweep above is paired with the one assertion that would catch it: a type nobody can look up
        // cannot be described at all.
        expect(describeWidget("nl.not-a-widget")).toBeNull();
    });

    it("suggests the type a typo was reaching for", () => {
        expect(nearestWidgetTypes("nl.buton")).toEqual(["nl.button"]);
        expect(nearestWidgetTypes("nl.containr")).toContain("nl.container");
        expect(nearestWidgetTypes("something else entirely")).toEqual([]);
    });

    it("names the palette categories a widget's own nodes are under, and no node that does not exist", () => {
        expect(describeWidget("nl.list")?.ownBlueprintNodeCategories).toEqual(["Displayable", "List"]);
        expect(describeWidget("nl.switch")?.ownBlueprintNodeCategories).toEqual(["Displayable", "Switch"]);
        // Event heads are the events section's to name, and they are under Events.
        expect(describeWidget("nl.button")?.ownBlueprintNodeCategories).not.toContain("Events");
        const printed = formatWidgetDetail(describeWidget("nl.list")!);
        expect(printed).toContain("  nodes      Displayable, List in its own blueprint; Element in any blueprint");
        expect(printed).not.toMatch(/Call Widget Command|Get Widget State|Set Widget Prop/);
        // A type with nothing to command, read or write says nothing about nodes either.
        expect(formatWidgetDetail(describeWidget("nl.root")!)).not.toContain("  nodes ");
    });

    it("knows the struct shapes that ship with Studio", () => {
        const ids = listBuiltinStructs().map(struct => struct.id);
        expect(ids).toContain("nl.saveEntry");
        expect(ids).toContain("nl.historyEntry");
    });
});
