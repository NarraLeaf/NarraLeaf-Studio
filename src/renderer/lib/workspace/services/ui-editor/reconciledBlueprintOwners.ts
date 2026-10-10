import type { Blueprint, BlueprintDocument, BlueprintPrivateOwnerRecord } from "@shared/types/blueprint/document";

/**
 * The private blueprints an interface edit made or removed through the blueprint reconcile, for a
 * step that takes the edit back as a delta of interface records.
 *
 * Every interface edit runs the reconcile (`UIBlueprintLifecycleCoordinator`): a widget that went
 * away loses its graph, and a widget that has none - one put back by an undo, say - is given a fresh,
 * empty one. A step that restores only the interface records would therefore bring a deleted button
 * back with an empty click graph. The page and component editors' own steps avoid that by carrying
 * the page's blueprints in their snapshot; a step over several pages carries, here, exactly the owner
 * records whose presence the edit changed - never a blueprint's content, which the author may have
 * edited since and which the interface edit did not write.
 *
 * Comments in English per project convention.
 */

/** Owner records and the blueprints they point at, as they stood when taken. */
export type HeldBlueprintOwners = Record<string, { record: BlueprintPrivateOwnerRecord; blueprint: Blueprint | null }>;

/** What the reconcile did to owner presence between two states: which keys appeared and which went. */
export function ownerPresenceChange(
    before: Readonly<Record<string, BlueprintPrivateOwnerRecord>>,
    after: Readonly<Record<string, BlueprintPrivateOwnerRecord>>,
): { added: string[]; removed: string[] } {
    return {
        added: Object.keys(after).filter(key => !(key in before)),
        removed: Object.keys(before).filter(key => !(key in after)),
    };
}

/** Copies of the named owners' records and blueprints, from `records` and `blueprints`. */
export function holdBlueprintOwners(
    records: Readonly<Record<string, BlueprintPrivateOwnerRecord>>,
    blueprints: Readonly<Record<string, Blueprint>>,
    keys: readonly string[],
): HeldBlueprintOwners {
    const held: HeldBlueprintOwners = {};
    for (const key of keys) {
        const record = records[key];
        if (!record) {
            continue;
        }
        const blueprint = blueprints[record.blueprintId];
        held[key] = { record: clone(record), blueprint: blueprint ? clone(blueprint) : null };
    }
    return held;
}

/** Take the named owners, and the blueprints they point at, out of `document`. */
export function dropBlueprintOwners(document: BlueprintDocument, keys: readonly string[]): void {
    for (const key of keys) {
        const record = document.ownerRecords[key];
        if (!record) {
            continue;
        }
        delete document.blueprints[record.blueprintId];
        delete document.ownerRecords[key];
    }
}

/** Put held owners back into `document`, each with its blueprint. */
export function putBlueprintOwners(document: BlueprintDocument, held: HeldBlueprintOwners): void {
    for (const [key, entry] of Object.entries(held)) {
        document.ownerRecords[key] = clone(entry.record);
        if (entry.blueprint) {
            document.blueprints[entry.blueprint.id] = clone(entry.blueprint);
        }
    }
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
