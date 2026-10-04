import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import {
    UI_TEXT_SITES,
    uiTextSiteOf,
    uiTextSitesFromPluginDeclaration,
    uiTextSitesOf,
    type UITextSite,
} from "@shared/types/ui-editor/textSource";
import { registerContributedWidgetSource, type ContributedWidgetDeclaration } from "@shared/types/ui-editor/contributedWidgets";
import { EMPTY_UI_TEXT_WRITER_INDEX } from "@shared/types/ui-editor/textWriters";
import { WIDGET_TYPE_PARENTS } from "@shared/types/ui-editor/widgetInheritance";
import { settleIncomingUITextSources } from "@shared/types/ui-editor/textSourceMigration";
import { listInterfaceTextUnitSites, listSurfaceTextSites } from "@/lib/lint/rules/ui";
import { describeWidget } from "@/lib/ui-cli/catalog";
import {
    listBindableValueTargets,
    mergeElementWithBlueprintValues,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintValueRuntimeStore";
import { isInlineTextEditableElement } from "@/lib/ui-editor/interaction/inlineTextEdit";
import { BuiltinWidgetModules } from "@/lib/ui-editor/widget-modules/builtin";
import { extractUiTranslationRows } from "@/lib/workspace/services/localization/localizationModel";

/**
 * Every reader of interface text answers from the one table (`textSites.ts`).
 *
 * Each reader is asked the question it exists to answer about a page holding one of every built-in
 * widget, each of which carries every prop that could plausibly hold words or name a key - its own
 * string props and a list of likely names. Whatever a reader reports has to be exactly what the table
 * says for that reader's question. A reader that grew its own idea of where words live (a widget kind
 * hard-coded beside the table, a prop name the table does not list) reports a site the table does not
 * know, and this fails - which is the point: the alternative is another copy of the rules, and copies
 * that drifted are how a word came to read one way on the canvas and another in the game.
 *
 * A plugin's widget is on the page too, declaring two of its props as words the way a manifest does
 * (`contributes.widgetText`), one with its own key prop and one with the default: every reader that
 * walks a page's words has to find exactly those, and the readers only Studio's own widgets answer
 * (typing in place, value bindings) have to find nothing on it.
 */

/** A plugin widget, as its manifest declares it, answered behind the table as a loaded plugin's would be. */
const PLUGIN_TYPE = "probe.plugin.badge";
const PLUGIN_DECLARATION: ContributedWidgetDeclaration = {
    type: PLUGIN_TYPE,
    ownerPluginId: "probe.plugin",
    textSites: uiTextSitesFromPluginDeclaration(PLUGIN_TYPE, [
        { prop: "caption", keyProp: "captionKey" },
        { prop: "hint", keyProp: "hintLocalizationKey" },
    ]),
};
const removePluginSource = registerContributedWidgetSource({
    get: type => (type === PLUGIN_TYPE ? PLUGIN_DECLARATION : undefined),
    list: () => [PLUGIN_DECLARATION],
});
afterAll(removePluginSource);

/** Props that might hold words on some widget, beyond each widget's own string defaults. */
const CANDIDATE_TEXT_PROPS = ["text", "label", "placeholder", "title", "caption", "value", "hint", "tooltip", "alt"];
/** Props that might name a translation key. */
const CANDIDATE_KEY_PROPS = [
    "localizationKey",
    "placeholderLocalizationKey",
    "labelLocalizationKey",
    "textLocalizationKey",
    "titleLocalizationKey",
    "valueLocalizationKey",
    "captionKey",
    "hintLocalizationKey",
];

/** Every built-in widget type, specialisations included. */
const BUILTIN_WIDGET_TYPES = [...new Set([...BuiltinWidgetModules.map(module => module.type), ...Object.keys(WIDGET_TYPE_PARENTS)])]
    .filter(type => type !== "nl.root");
/** And the plugin's. */
const WIDGET_TYPES = [...BUILTIN_WIDGET_TYPES, PLUGIN_TYPE];

function defaultStringProps(type: string): string[] {
    const module = BuiltinWidgetModules.find(candidate => candidate.type === type);
    try {
        const props = (module?.createDefaultElement().props ?? {}) as Record<string, unknown>;
        return Object.entries(props).filter(([, value]) => typeof value === "string").map(([key]) => key);
    } catch {
        return [];
    }
}

const TEXT_PROPS_BY_TYPE = new Map(
    WIDGET_TYPES.map(type => [type, [...new Set([...CANDIDATE_TEXT_PROPS, ...defaultStringProps(type)])]]),
);

/** The words a probe carries in one prop: distinct per prop, so a reader's answer names the prop it read. */
function probeWords(prop: string): string {
    return `Probe words in ${prop}`;
}

function probeKey(keyProp: string): string {
    return `probe.${keyProp}`;
}

type ProbeShape = { keys: boolean };

function probeElement(type: string, index: number, shape: ProbeShape): UIElement {
    const props: Record<string, unknown> = {};
    for (const prop of TEXT_PROPS_BY_TYPE.get(type) ?? []) {
        props[prop] = probeWords(prop);
    }
    if (shape.keys) {
        for (const keyProp of CANDIDATE_KEY_PROPS) {
            props[keyProp] = probeKey(keyProp);
        }
    }
    return {
        id: `probe-${index}`,
        type,
        name: `Probe ${type}`,
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        props,
    };
}

function probeDocument(shape: ProbeShape): UIDocument {
    const probes = WIDGET_TYPES.map((type, index) => probeElement(type, index, shape));
    const root: UIElement = {
        id: "root",
        type: "nl.root",
        parentId: null,
        childrenIds: probes.map(probe => probe.id),
        layout: { x: 0, y: 0, width: 100, height: 100 },
    };
    return {
        surfaces: [{ id: MAIN_APP_SURFACE_ID, name: "Main Page", kind: "appSurface", rootElementId: "root" }],
        elements: Object.fromEntries([root, ...probes].map(element => [element.id, element])),
    } as unknown as UIDocument;
}

const PLAIN = probeDocument({ keys: false });
const KEYED = probeDocument({ keys: true });

function typeOf(document: UIDocument, elementId: string): string {
    return document.elements[elementId]?.type ?? "?";
}

/**
 * `type.prop` for every site that answers yes to `select`: each built-in type's, read through
 * inheritance, and each the plugin's widget declares.
 */
function expectedSites(select: (site: UITextSite) => string | undefined): string[] {
    const out: string[] = [];
    for (const type of WIDGET_TYPES) {
        for (const site of uiTextSitesOf(type)) {
            const prop = select(site);
            if (prop) {
                out.push(`${type}.${prop}`);
            }
        }
    }
    return out.sort();
}

const words = (site: UITextSite) => (site.role === "words" ? site.textProp : undefined);
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

describe("interface text sites", () => {
    it("declares one site per widget type", () => {
        const types = UI_TEXT_SITES.map(site => site.widgetType);
        expect(new Set(types).size).toBe(types.length);
    });

    it("answers a plugin widget with the sites its manifest declares, and a built-in widget with its one", () => {
        expect(uiTextSitesOf(PLUGIN_TYPE).map(site => [site.textProp, site.keyProp, site.role, site.valueBinding])).toEqual([
            ["caption", "captionKey", "words", "none"],
            ["hint", "hintLocalizationKey", "words", "none"],
        ]);
        expect(uiTextSiteOf(PLUGIN_TYPE)).toBeUndefined();
        expect(uiTextSitesOf("nl.button")).toEqual([uiTextSiteOf("nl.button")]);
        expect(uiTextSitesOf("probe.plugin.unloaded")).toEqual([]);
    });

    it("lint walks exactly the sites a player reads (listSurfaceTextSites)", () => {
        const found = listSurfaceTextSites(PLAIN).map(site => `${site.element.type}.${site.unitId.split(".").pop()}`);
        expect(sorted(found)).toEqual(expectedSites(words));
    });

    it("lint reads each site's key from the table's key prop (listInterfaceTextUnitSites)", () => {
        const found = listInterfaceTextUnitSites(KEYED, EMPTY_UI_TEXT_WRITER_INDEX).map(site => {
            if (site.binding.kind !== "key") {
                return `${site.element.type}.(not a key)`;
            }
            return `${site.element.type}.${site.binding.keyName.slice("probe.".length)}`;
        });
        expect(sorted(found)).toEqual(expectedSites(site => (site.role === "words" ? site.keyProp : undefined)));
    });

    it("lint reads an element's own words through its own unit on exactly the sites a player reads", () => {
        const found = listInterfaceTextUnitSites(PLAIN, EMPTY_UI_TEXT_WRITER_INDEX).map(site =>
            site.binding.kind === "implicit"
                ? `${site.element.type}.${site.binding.unitId.split(".").pop()}`
                : `${site.element.type}.(not a unit)`,
        );
        expect(sorted(found)).toEqual(expectedSites(words));
    });

    it("the localization panel lists an element's own words on exactly the sites a player reads", () => {
        const found = extractUiTranslationRows(PLAIN, EMPTY_UI_TEXT_WRITER_INDEX).map(row => `${typeOf(PLAIN, row.elementId)}.${row.prop}`);
        expect(sorted(found)).toEqual(expectedSites(words));
    });

    it("elements arriving in a project that lacks their keys drop exactly the table's key props", () => {
        const elements = Object.values(
            settleIncomingUITextSources(structuredClone(KEYED).elements, { hasKey: () => false }).table,
        );
        const found: string[] = [];
        for (const element of elements) {
            for (const keyProp of CANDIDATE_KEY_PROPS) {
                if (element.type !== "nl.root" && !(keyProp in ((element.props ?? {}) as object))) {
                    found.push(`${element.type}.${keyProp}`);
                }
            }
        }
        expect(sorted(found)).toEqual(expectedSites(site => (site.role === "words" ? site.keyProp : undefined)));
    });

    it("the canvas types in place exactly where the table says", () => {
        const found = WIDGET_TYPES.filter(type => isInlineTextEditableElement(probeElement(type, 0, { keys: false })));
        expect(sorted(found.map(type => `${type}.${uiTextSiteOf(type)?.textProp}`))).toEqual(
            expectedSites(site => (site.typedOnCanvas ? site.textProp : undefined)),
        );
    });

    it("a value binding writes words exactly where the table takes one", () => {
        const struct: UIStructDef = {
            id: "probe",
            fields: CANDIDATE_TEXT_PROPS.map(prop => ({ id: `f-${prop}`, key: prop, type: "string" as const })),
        };
        const item = Object.fromEntries(CANDIDATE_TEXT_PROPS.map(prop => [prop, `Bound ${prop}`]));
        const found: string[] = [];
        WIDGET_TYPES.forEach((type, index) => {
            const element = probeElement(type, index, { keys: false });
            element.valueBindings = Object.fromEntries(
                CANDIDATE_TEXT_PROPS.map(prop => [prop, { kind: "listItemField" as const, fieldId: `f-${prop}` }]),
            );
            const merged = mergeElementWithBlueprintValues(element, MAIN_APP_SURFACE_ID, null, {
                item,
                index: 0,
                count: 1,
                key: "0",
                struct,
            });
            for (const prop of CANDIDATE_TEXT_PROPS) {
                if ((merged.props as Record<string, unknown>)[prop] === `Bound ${prop}`) {
                    found.push(`${type}.${prop}`);
                }
            }
        });
        expect(sorted(found)).toEqual(expectedSites(site => (site.valueBinding !== "none" ? site.textProp : undefined)));
    });

    it("a component's text parameter shows words exactly where the table takes a binding a player reads", () => {
        const found: string[] = [];
        WIDGET_TYPES.forEach((type, index) => {
            const element = probeElement(type, index, { keys: false });
            element.valueBindings = Object.fromEntries(
                CANDIDATE_TEXT_PROPS.map(prop => [prop, { kind: "componentParam" as const, paramId: `p-${prop}` }]),
            );
            const texts = Object.fromEntries(CANDIDATE_TEXT_PROPS.map(prop => [
                `p-${prop}`,
                { origin: "placement" as const, text: `Given ${prop}`, key: "", unitId: `ui:placement.param.p-${prop}` },
            ]));
            const merged = mergeElementWithBlueprintValues(element, MAIN_APP_SURFACE_ID, null, null, "", texts);
            for (const prop of CANDIDATE_TEXT_PROPS) {
                if ((merged.props as Record<string, unknown>)[prop] === `Given ${prop}`) {
                    found.push(`${type}.${prop}`);
                }
            }
        });
        expect(sorted(found)).toEqual(
            expectedSites(site => (site.role === "words" && site.valueBinding !== "none" ? site.textProp : undefined)),
        );
    });

    it("the interface CLI offers to bind words exactly where the table does", () => {
        const found = listBindableValueTargets()
            .filter(target => target.valueType === "string" && CANDIDATE_TEXT_PROPS.includes(target.propPath))
            .map(target => `${target.elementType}.${target.propPath}`);
        const offered = UI_TEXT_SITES.filter(site => site.valueBinding === "offered").map(site => `${site.widgetType}.${site.textProp}`);
        expect(sorted(found)).toEqual(sorted(offered));
    });

    it("the interface CLI notes a key only where the table gives the site one", () => {
        const keyed = BUILTIN_WIDGET_TYPES.filter(type => (describeWidget(type)?.notes ?? []).some(note => note.includes("is read from that translation key")));
        const expected = BUILTIN_WIDGET_TYPES.filter(type => {
            const site = uiTextSiteOf(type);
            return site?.role === "words" && Boolean(site.keyProp) && site.canvasDrawsKey;
        });
        expect(sorted(keyed)).toEqual(sorted(expected));
    });

    it("the skeleton template's language generator reads the table instead of keeping a copy", () => {
        const source = fs.readFileSync(path.join(process.cwd(), "scripts/gen-skeleton-locale.mjs"), "utf8");
        expect(source).toContain("src/shared/types/ui-editor/textSites.ts");
        expect(source).not.toMatch(/["']nl\.(?:text|button|textInput|dialog\.sentence|nvl\.texts)["']\s*:/);
    });

    it("keeps the table importable without resolving anything (the generator transforms it alone)", () => {
        const source = fs.readFileSync(path.join(process.cwd(), "src/shared/types/ui-editor/textSites.ts"), "utf8");
        expect(source).not.toMatch(/^\s*import\s/m);
    });
});
