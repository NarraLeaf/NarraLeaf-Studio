/**
 * The interface tool's view of a project, as functions of documents rather than of a directory.
 *
 * Everything here takes the documents themselves - the interface document, the blueprint document,
 * the translation key registry - and never a path. The command line reads them off disk in
 * `project.ts` and hands them in; Studio's agent bridge hands in the live documents its services
 * hold. Both then run the same parser, compiler and checks over the same shapes, which is the whole
 * point: an answer that differs between the terminal and the open project would be an answer nobody
 * could trust.
 *
 * Nothing in this file may import a Node module. `agent-core/bundle.test.ts` bundles the renderer
 * entry for the browser and fails on the first one that becomes reachable.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { normalizeLocalizationConfiguration, normalizeLocalizationKeysDocument } from "@shared/types/localization";
import {
    UI_DOCUMENT_MIN_SUPPORTED_VERSION,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UIElementId,
    type UISurface,
} from "@shared/types/ui-editor/document";
import { migrateUITextSourcesV13, UI_TEXT_SOURCES_SCHEMA_VERSION } from "@shared/types/ui-editor/textSourceMigration";
import { sha1, toHex } from "./sha1";

// ---------------------------------------------------------------------------
// The translation keys
// ---------------------------------------------------------------------------

/** The project's named translation keys, and its source language. */
export type TextKeys = {
    /** The project's source language, or "" when it has none. Keys are read either way. */
    sourceLocale: string;
    /** Key name to source-language text, from `editor/localization/keys.json`. */
    keys: ReadonlyMap<string, string>;
};

/**
 * The key registry and the source language, from the two documents they live in.
 *
 * `localization` is the project config's `app.localization` as stored (normalised here), and
 * `keysDocument` the parsed `editor/localization/keys.json`, or null/undefined when the project has
 * none - which is a project with no keys, not an unreadable one. Null when the key document will not
 * normalise, which is the same answer the file reader gives for a key file it cannot read.
 */
export function textKeysOf(input: { localization?: unknown; keysDocument?: unknown }): TextKeys | null {
    const localization = normalizeLocalizationConfiguration(input.localization);
    const keys = new Map<string, string>();
    if (input.keysDocument != null) {
        try {
            const document = normalizeLocalizationKeysDocument(input.keysDocument);
            for (const [name, definition] of Object.entries(document.keys)) {
                keys.set(name, definition.sourceText);
            }
        } catch {
            return null;
        }
    }
    return { sourceLocale: localization.sourceLocale, keys };
}

// ---------------------------------------------------------------------------
// Reading an older interface document
// ---------------------------------------------------------------------------

/** Whether the document predates v13, so reading it goes through the text-source step. */
export function needsTextSourceStep(raw: Pick<UIDocument, "schemaVersion">): boolean {
    return typeof raw.schemaVersion === "number"
        && raw.schemaVersion >= UI_DOCUMENT_MIN_SUPPORTED_VERSION
        && raw.schemaVersion < UI_TEXT_SOURCES_SCHEMA_VERSION;
}

/**
 * The document as Studio will read it.
 *
 * A document from before v13 goes through the same text-source step Studio runs when it opens the
 * project (`textSourceMigration.ts`), against the project's keys. Only the document comes back - the
 * translation edits that step makes are Studio's to write when it opens the project - so such a
 * document carries `migratedFrom` and is never written back (see `assertWritableSchema` in
 * `project.ts`). A current document is returned as it is.
 */
export function readableUiDocument(raw: UIDocument, textKeys: TextKeys | null): { document: UIDocument; migratedFrom?: number } {
    if (needsTextSourceStep(raw)) {
        const migrated = migrateUITextSourcesV13(raw, {
            keys: Object.fromEntries(textKeys?.keys ?? []),
            sourceLocale: textKeys?.sourceLocale ?? "",
            translations: {},
        });
        return { document: migrated.document, migratedFrom: raw.schemaVersion };
    }
    return { document: raw };
}

// ---------------------------------------------------------------------------
// The blueprint document, read only
// ---------------------------------------------------------------------------

export type BlueprintIndex = {
    /** Every blueprint by id, with the owner it claims. */
    byId: Map<string, { name: string; owner: BlueprintOwnerRef }>;
    /** Blueprint ids by the element they hang off, whether as a widget's own graph or a value. */
    byElement: Map<string, { id: string; name: string; owner: BlueprintOwnerRef }[]>;
};

/**
 * Which blueprints exist and which element each hangs off.
 *
 * Read so that a value binding can be checked against the blueprint it names, and so that replacing
 * a surface can say which blueprints it is about to orphan. A missing document is an empty index.
 */
export function indexBlueprintDocument(document: BlueprintDocument | null | undefined): BlueprintIndex {
    const index: BlueprintIndex = { byId: new Map(), byElement: new Map() };
    for (const blueprint of Object.values(document?.blueprints ?? {})) {
        index.byId.set(blueprint.id, { name: blueprint.name, owner: blueprint.owner });
        const owner = blueprint.owner as { elementId?: string };
        if (typeof owner.elementId === "string") {
            const list = index.byElement.get(owner.elementId) ?? [];
            list.push({ id: blueprint.id, name: blueprint.name, owner: blueprint.owner });
            index.byElement.set(owner.elementId, list);
        }
    }
    return index;
}

// ---------------------------------------------------------------------------
// Walking the document
// ---------------------------------------------------------------------------

/** Every element reachable from `rootId` in `pool`, root first, cycles and missing ids survived. */
export function collectTree(pool: Record<UIElementId, UIElement>, rootId: string | undefined): UIElement[] {
    const out: UIElement[] = [];
    if (!rootId) {
        return out;
    }
    const seen = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
        const id = stack.pop() as string;
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        const element = pool[id];
        if (!element) {
            continue;
        }
        out.push(element);
        for (const childId of [...(element.childrenIds ?? [])].reverse()) {
            stack.push(childId);
        }
    }
    return out;
}

export function findSurface(document: UIDocument, nameOrId: string): UISurface | undefined {
    return document.surfaces.find(surface => surface.id === nameOrId)
        ?? document.surfaces.find(surface => surface.name === nameOrId);
}

export function findComponent(document: UIDocument, nameOrId: string): UIComponentDefinition | undefined {
    const components = document.components ?? [];
    return components.find(component => component.id === nameOrId)
        ?? components.find(component => component.name === nameOrId);
}

/** The names from the tree's root down to this element, which is what tells two "Button" apart. */
export function elementPathSegments(pool: Record<UIElementId, UIElement>, element: UIElement): string[] {
    const names: string[] = [];
    let current: UIElement | undefined = element;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name ?? current.type);
        current = current.parentId ? pool[current.parentId] : undefined;
    }
    return names;
}

/** The same path as one readable line. */
export function elementPath(pool: Record<UIElementId, UIElement>, element: UIElement): string {
    return elementPathSegments(pool, element).join(" / ");
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const UI_CLI_ID_NAMESPACE = "narraleaf-studio:ui-cli";

/**
 * A stable id for an element the file did not name one for.
 *
 * Derived from where the element sits rather than drawn at random, so writing the same file into two
 * fresh projects produces the same ids - which is what makes a template a template. It is a real
 * v5-shaped UUID, so nothing downstream can tell it from one the editor minted.
 *
 * The digest is the pure-JS SHA-1 in `sha1.ts`, byte-identical to the `node:crypto` one this used to
 * call (`sha1.test.ts` holds the two side by side), so ids derived before and after are the same.
 */
export function deriveElementId(scope: string, elementPathKey: string): string {
    const bytes = sha1(`${UI_CLI_ID_NAMESPACE}\u0000${scope}\u0000${elementPathKey}`).slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = toHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
