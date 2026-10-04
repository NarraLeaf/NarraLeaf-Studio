import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { DependencyKind } from "@shared/types/pluginDependencies";
import type { StoryDocument } from "@shared/types/story";

/**
 * How a project's documents are read for the plugins they use.
 *
 * One reading, two readers. The workspace's dependency scan (`ProjectDependencyService`) turns it
 * into the dependency table, and a Dev Mode session reads its own bundle with it to tell a plugin
 * the project never touches apart from one it has started using since the table was written. Two
 * readings would be two answers to "does this project use that plugin", and the second one would
 * drift from the first the day a new kind of reference is taught to only one of them.
 *
 * Pure: nothing here reaches a service, the bridge or a registry. Which types belong to a loaded
 * plugin is handed in (see {@link TypeOwnership}), so a caller with no registries at all can still
 * attribute every type by its name.
 */

/** A single instance of a plugin-owned type/namespace referenced by the project. */
export interface DependencyUsageRecord {
    pluginId: string;
    kind: DependencyKind;
    /** The referenced id - node type, widget type, story action, or storage namespace. */
    id: string;
    /** True when the reference breaks the document if the plugin is absent. */
    hard: boolean;
    /**
     * True when the type was attributed by its name alone, because the plugin that owns it is not
     * loaded here to claim it (see {@link attributeByNamespace}). Such a reference says the project
     * still uses the plugin; it says nothing about which version the project is being made with.
     */
    byName?: boolean;
}

/** How a collector tells whose a type is. */
export interface TypeOwnership {
    /** The loaded plugin that registered this type, if a plugin did. */
    ownerOf(type: string): string | undefined;
    /** Whether anything loaded here - Studio itself or a plugin - defines this type. */
    isRegistered(type: string): boolean;
    /** Plugin ids a type that nothing here defines may belong to. */
    candidatePluginIds: Iterable<string>;
}

/** The part of the interface document the widget scan reads: every page's elements and every component's. */
export type InterfaceDocumentElements = {
    elements: Record<string, { type: string }>;
    components?: ReadonlyArray<{ elements: Record<string, { type: string }> }>;
};

/**
 * The plugin a type that nothing loaded here defines belongs to, read off the type's name.
 *
 * Every type a plugin contributes is namespaced under the plugin's id: a manifest whose contributed
 * node or widget is not is refused at install, and registering one the manifest does not declare
 * throws. So a node or an element of type `acme.fx.shake` belongs to `acme.fx` whether or not that
 * plugin is loaded, switched on or even installed - which is what lets a scan tell "nothing refers
 * to this plugin any more" apart from "this plugin is not here to claim its types". The longest id
 * wins, so `acme.fx.pro.glow` is `acme.fx.pro`'s and not `acme.fx`'s.
 *
 * Only ids the caller names are candidates. A type whose plugin is not among them has no version to
 * record, and where its plugin id ends cannot be read off it.
 */
export function attributeByNamespace(type: string, candidatePluginIds: Iterable<string>): string | undefined {
    let owner: string | undefined;
    for (const id of candidatePluginIds) {
        if (type.startsWith(`${id}.`) && (owner === undefined || id.length > owner.length)) {
            owner = id;
        }
    }
    return owner;
}

function attributeType(type: string, kind: DependencyKind, types: TypeOwnership): DependencyUsageRecord | null {
    const owner = types.ownerOf(type);
    if (owner) {
        return { pluginId: owner, kind, id: type, hard: true };
    }
    if (types.isRegistered(type)) {
        return null; // one of Studio's own
    }
    const named = attributeByNamespace(type, types.candidatePluginIds);
    return named ? { pluginId: named, kind, id: type, hard: true, byName: true } : null;
}

/** Plugin blueprint nodes in every graph of every blueprint - event layers, functions and macros. */
export function collectBlueprintDocumentUsage(document: BlueprintDocument, types: TypeOwnership): DependencyUsageRecord[] {
    const usage: DependencyUsageRecord[] = [];
    for (const blueprint of Object.values(document.blueprints)) {
        const { events, functions, macros } = blueprint.graphs;
        for (const group of [events, functions, macros]) {
            if (!group) {
                continue;
            }
            for (const entry of Object.values(group)) {
                const nodes = entry.graph?.nodes;
                if (!nodes) {
                    continue;
                }
                for (const node of Object.values(nodes)) {
                    const record = attributeType(node.type, "blueprintNode", types);
                    if (record) {
                        usage.push(record);
                    }
                }
            }
        }
    }
    return usage;
}

/** Plugin widgets placed on any page or inside any component definition. */
export function collectInterfaceDocumentUsage(document: InterfaceDocumentElements, types: TypeOwnership): DependencyUsageRecord[] {
    const usage: DependencyUsageRecord[] = [];
    const collect = (elements: Record<string, { type: string }>): void => {
        for (const element of Object.values(elements)) {
            const record = attributeType(element.type, "widget", types);
            if (record) {
                usage.push(record);
            }
        }
    };
    collect(document.elements);
    for (const component of document.components ?? []) {
        collect(component.elements);
    }
    return usage;
}

/**
 * Plugin story rows (`{action:"plugin"}`) in every scene of one story.
 *
 * Hard, unlike storage, and the row itself says why: a marker's whole meaning is what its owner does
 * with it, so a project that authored one plays differently without the plugin rather than merely
 * losing some editor convenience. The row carries `pluginId` directly, so this attributes from the
 * document and not from what happens to be installed right now.
 */
export function collectStoryDocumentUsage(document: StoryDocument): DependencyUsageRecord[] {
    const usage: DependencyUsageRecord[] = [];
    for (const scene of Object.values(document.scenes)) {
        for (const block of Object.values(scene.blocks)) {
            if (block.kind === "action" && block.payload.action === "plugin") {
                usage.push({
                    pluginId: block.payload.pluginId,
                    kind: "storyAction",
                    id: block.payload.actionId,
                    hard: true,
                });
            }
        }
    }
    return usage;
}
