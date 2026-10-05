import { assetSetParent, type AssetSet } from "@shared/types/assetSet";
import type { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetGroup } from "@/lib/workspace/services/assets/types";

/**
 * Everything that has to be open before a set's row is on screen.
 *
 * A set can be several levels down from anything the panel is currently showing: filed in a folder
 * inside a folder, hanging under another set, in a section the author has collapsed. A reveal that
 * only selected it would land on a row nothing draws, which reads as a jump that did nothing.
 *
 * Pure, and separate from the panel, because both views need the same answer in different currencies:
 * the tree opens folders and sets in place, the grid walks into them one level at a time. Deriving it
 * twice is how the two would come to disagree about where a set lives.
 */
export interface AssetSetRevealPlan {
    /** The section the set is filed under. */
    category: AssetCategory;
    /**
     * The folders to open, outermost first.
     *
     * Read off the OUTERMOST set rather than off the target: a sub-set is drawn inside the set it
     * hangs under and nowhere else, so its own `groupId` says nothing about where its row appears.
     */
    groupPathIds: string[];
    /** The sets to open, outermost first, and never the target itself — that is the row being revealed. */
    ancestorSetIds: string[];
}

/** What the plan needs of a set: the declaration, and the section its type files it under. */
export interface AssetSetPlacement {
    set: AssetSet;
    category: AssetCategory;
}

/**
 * Where a set's row is, or null when the project no longer holds it.
 *
 * Null is a real answer and the caller must act on it: a reference outlives the set it names (a story
 * row keeps the id after a delete), so "reveal this" arrives for sets that are gone.
 */
export function planAssetSetReveal(input: {
    setId: string;
    placements: readonly AssetSetPlacement[];
    groups: readonly AssetGroup[];
}): AssetSetRevealPlan | null {
    const target = input.placements.find(entry => entry.set.id === input.setId);
    if (!target) {
        return null;
    }
    const sets = input.placements.map(entry => entry.set);

    // Up the nesting first: each step is read from the tags, the same reading the tree draws by.
    const ancestorSetIds: string[] = [];
    let outermost = target.set;
    const seen = new Set<string>([outermost.id]);
    for (;;) {
        const parent = assetSetParent(outermost, sets);
        // A cycle cannot be authored — nesting is derived from tag counts — but it can be read out of
        // a hand-edited document, and walking one here would hang the panel rather than fail a jump.
        if (!parent || seen.has(parent.set.id)) {
            break;
        }
        seen.add(parent.set.id);
        ancestorSetIds.unshift(parent.set.id);
        outermost = parent.set;
    }

    return {
        category: target.category,
        groupPathIds: groupChain(input.groups, outermost.groupId),
        ancestorSetIds,
    };
}

/** A set and the files it answers with, as far as {@link planAssetReveal} needs to know. */
export interface AssetSetHolding {
    set: { id: string };
    contents: { cells: readonly { assetIds: readonly string[]; childSetIds?: readonly string[] }[] };
}

/**
 * Everything that has to be open before one file's row is on screen.
 *
 * A file a set answers with is listed inside that set and nowhere else (see `memberAssetIds`), so its
 * row is reached the way the set's is - and then one step further, into the set itself, which is why
 * the set holding it ends `ancestorSetIds` here rather than being left out as a set's own reveal
 * leaves it. Any other file is reached through the folders it is filed in.
 *
 * The section comes from the file's own type, which never fails to name one; null only for a file a
 * set claims that the plan cannot place, which cannot be drawn either.
 */
export function planAssetReveal(input: {
    asset: { id: string; groupId?: string };
    category: AssetCategory;
    holders: readonly AssetSetHolding[];
    placements: readonly AssetSetPlacement[];
    groups: readonly AssetGroup[];
}): AssetSetRevealPlan | null {
    // The innermost set: a value a sub-set answers is drawn as that sub-set, so the file's own row is
    // under the set whose value it answers directly.
    const holder = input.holders.find(entry =>
        entry.contents.cells.some(cell => cell.assetIds.includes(input.asset.id) && !cell.childSetIds?.length),
    ) ?? input.holders.find(entry => entry.contents.cells.some(cell => cell.assetIds.includes(input.asset.id)));
    if (holder) {
        const plan = planAssetSetReveal({ setId: holder.set.id, placements: input.placements, groups: input.groups });
        return plan ? { ...plan, ancestorSetIds: [...plan.ancestorSetIds, holder.set.id] } : null;
    }
    return {
        category: input.category,
        groupPathIds: groupChain(input.groups, input.asset.groupId),
        ancestorSetIds: [],
    };
}

/** A folder and every folder it is inside, outermost first. */
function groupChain(groups: readonly AssetGroup[], groupId: string | undefined): string[] {
    const byId = new Map(groups.map(group => [group.id, group]));
    const chain: string[] = [];
    const seen = new Set<string>();
    let current = groupId ? byId.get(groupId) : undefined;
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        chain.unshift(current.id);
        current = current.parentGroupId ? byId.get(current.parentGroupId) : undefined;
    }
    return chain;
}
