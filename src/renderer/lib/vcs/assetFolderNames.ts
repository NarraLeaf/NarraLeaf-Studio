import { useEffect, useMemo, useState } from "react";
import type { DocumentChange } from "@shared/documents/diff";
import type { TranslationKey } from "@shared/i18n";
import { Services } from "@/lib/workspace/services/services";
import { VersionControlService } from "@/lib/workspace/services/core/VersionControlService";
import { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { readLibraries } from "./nameSources";
import { comparisonSideKey, type ComparisonSide, type ComparisonSides } from "./presenters/comparisonSide";

/**
 * The group an asset is filed in, named the way the assets panel names it.
 *
 * An asset's record stores its group as `groupId`, and a group id is minted from a clock and a random
 * suffix (`group_1786075133079_orr40gkke`). A comparison that moved a picture from one group to
 * another therefore reported `groupId changed group_1786… → group_1786…`: the field's storage name
 * and two ids, none of which the author has ever seen. What they see is the group's name in the
 * panel, so that is what the row says - the field as the panel's own word for it, and each side's
 * group by its name, nested groups as their path from the top.
 *
 * ## Which side names which value
 *
 * **Each value is named from its own side first.** The old group is looked up in the older side's
 * group list and the new one in the newer side's - so a group renamed in the same change reads as
 * the name it had where it was left and the name it has where it was entered, which is what
 * happened. A value its own side does not list is looked up in the other side, which covers a group
 * deleted in the very change that moved the asset out of it. A group neither side lists is a record
 * pointing at nothing; it reads as a missing group rather than as its id.
 *
 * Group lists are read per category (`assets/assets.groups.<category>.json`) and folded into one
 * lookup per side. Ids are unique across categories, so the fold loses nothing, and it saves knowing
 * which category an asset type is filed under - the record says its type, the list says its category.
 *
 * Presentation only, as `assetRows.ts` is: nothing here is written down or handed to a merge.
 */

/** One group as its list stores it, reduced to what naming it needs. */
export interface AssetFolderRecord {
    readonly name: string;
    readonly parentGroupId?: string;
}

export type AssetFolderMap = ReadonlyMap<string, AssetFolderRecord>;

/** The groups each side of a comparison lists. */
export interface AssetFolderNames {
    readonly before: AssetFolderMap;
    readonly after: AssetFolderMap;
}

/** The label an `assets-metadata` field change wears. See `specs/assetsMetadata.ts`. */
const ASSET_FIELD_LABEL = "documentDiff.assets.field";

/** The record field that holds an asset's group. */
const GROUP_FIELD = "groupId";

const GROUP_FIELD_NAME_KEY = "documentDiff.assets.fields.group" as TranslationKey;
const MISSING_GROUP_KEY = "documentDiff.assets.fields.missingGroup" as TranslationKey;

/** Between the names of nested groups, outermost first. */
const PATH_SEPARATOR = " / ";

/** One group list per asset category, every one of them: a group id does not say its category. */
const ASSET_GROUP_LISTS: readonly string[] = Object.values(AssetCategory).map(
    category => `assets/assets.groups.${category}.json`,
);

/**
 * The groups inside one list, by id.
 *
 * As tolerant as the asset panel's own reader: an entry that is not an object, or has no name, is
 * skipped rather than guessed at - a group this cannot name reads as missing, which is honest.
 */
export function parseAssetFolders(text: string): Map<string, AssetFolderRecord> {
    const folders = new Map<string, AssetFolderRecord>();
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return folders;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return folders;
    }
    for (const [id, record] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof record !== "object" || record === null) {
            continue;
        }
        const { name, parentGroupId } = record as { name?: unknown; parentGroupId?: unknown };
        if (typeof name !== "string" || name.trim().length === 0 || folders.has(id)) {
            continue;
        }
        folders.set(id, {
            name: name.trim(),
            ...(typeof parentGroupId === "string" && parentGroupId.length > 0 ? { parentGroupId } : {}),
        });
    }
    return folders;
}

/**
 * A group's name with the names of the groups it sits in, outermost first - or null when the list
 * does not have it.
 *
 * The path rather than the bare name because two groups may share a name in different parents, and
 * the panel tells them apart by where they are. A parent the list does not have ends the path there;
 * a cycle, which only a hand-edited list can hold, ends it at the first repeat.
 */
export function assetFolderPath(folders: AssetFolderMap, id: string): string | null {
    const own = folders.get(id);
    if (!own) {
        return null;
    }
    const names = [own.name];
    const seen = new Set([id]);
    let parentId = own.parentGroupId;
    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = folders.get(parentId);
        if (!parent) {
            break;
        }
        names.unshift(parent.name);
        parentId = parent.parentGroupId;
    }
    return names.join(PATH_SEPARATOR);
}

/**
 * The same changes, with every change of an asset's group naming the field and both groups the way
 * the assets panel does.
 *
 * A rewritten parameter rather than a second way of drawing a row, for the reason
 * `nameCharacterFields` gives: what a change says has one implementation and one wording. Both
 * levels are walked, because the field changes are the children of the change to the asset. Changes
 * with nothing to rename are returned as they are.
 */
export function nameAssetFields(
    changes: readonly DocumentChange[],
    t: (key: TranslationKey) => string,
    folders: AssetFolderNames | null,
): DocumentChange[] {
    return changes.map(change => {
        const children = change.children === undefined ? undefined : nameAssetFields(change.children, t, folders);
        const params = change.label.params;
        if (change.label.key !== ASSET_FIELD_LABEL || params?.field !== GROUP_FIELD) {
            return children === undefined ? change : { ...change, children };
        }
        // Until the lists are read there is no name to give, and an id is not one: the values are
        // left off for that moment rather than drawn as ids or claimed missing.
        const name = (value: string | number | undefined, own: AssetFolderMap, other: AssetFolderMap) => {
            if (value === undefined || folders === null) {
                return undefined;
            }
            const id = String(value);
            return assetFolderPath(own, id) ?? assetFolderPath(other, id) ?? t(MISSING_GROUP_KEY);
        };
        const from = name(params.from, folders?.before ?? new Map(), folders?.after ?? new Map());
        const to = name(params.to, folders?.after ?? new Map(), folders?.before ?? new Map());
        const named: Record<string, string | number> = { field: t(GROUP_FIELD_NAME_KEY) };
        for (const [key, value] of Object.entries(params)) {
            if (key !== "field" && key !== "from" && key !== "to") {
                named[key] = value;
            }
        }
        return {
            ...change,
            ...(children === undefined ? {} : { children }),
            label: {
                ...change.label,
                params: {
                    ...named,
                    ...(from === undefined ? {} : { from }),
                    ...(to === undefined ? {} : { to }),
                },
            },
        };
    });
}

/** Whether any change in the list moves an asset between groups - the only reason to read the lists. */
export function changesAssetGroup(changes: readonly DocumentChange[]): boolean {
    return changes.some(change =>
        (change.label.key === ASSET_FIELD_LABEL && change.label.params?.field === GROUP_FIELD)
        || (change.children !== undefined && changesAssetGroup(change.children)));
}

/**
 * The group lists on both sides of a comparison, read when `enabled` and kept until the sides change;
 * null until they have been read.
 *
 * Read the way `useDocumentNames` reads its libraries (`readLibraries`): one round trip for a
 * revision, the files off disk for the working tree, and every failure an empty list - which names
 * nothing, so a value reads as a missing group rather than as an id.
 */
export function useAssetFolderNames(sides: ComparisonSides | null, enabled: boolean): AssetFolderNames | null {
    const context = useOptionalWorkspace()?.context ?? null;
    const [folders, setFolders] = useState<AssetFolderNames | null>(null);
    const service = useMemo(
        () => (context?.services ? context.services.get<VersionControlService>(Services.VersionControl) : null),
        [context],
    );
    const beforeKey = comparisonSideKey(sides?.before ?? null);
    const afterKey = comparisonSideKey(sides?.after ?? null);

    useEffect(() => {
        if (!enabled || !service || !sides) {
            setFolders(null);
            return;
        }
        let cancelled = false;
        void Promise.all([readSide(service, sides.before), readSide(service, sides.after)]).then(([before, after]) => {
            if (!cancelled) {
                setFolders({ before, after });
            }
        });
        return () => {
            cancelled = true;
        };
        // `sides` is excluded for `useDocumentNames`' reason: the keys carry everything about it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [service, enabled, beforeKey, afterKey]);

    return folders;
}

async function readSide(service: VersionControlService, side: ComparisonSide | null): Promise<AssetFolderMap> {
    const folders = new Map<string, AssetFolderRecord>();
    if (!side) {
        return folders;
    }
    for (const text of (await readLibraries(service, side, ASSET_GROUP_LISTS)).values()) {
        for (const [id, record] of parseAssetFolders(text)) {
            if (!folders.has(id)) {
                folders.set(id, record);
            }
        }
    }
    return folders;
}
