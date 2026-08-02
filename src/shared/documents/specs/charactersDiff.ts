import type {CharacterStoreDocument} from "@shared/characters/characterStoreModel";
import type {
    CharacterAxis,
    CharacterGroup,
    CharacterLayer,
    CharacterPose,
    ICharacterAppearance,
    LayeredAppearance,
    PresetAppearance,
    PuppetAppearance,
    StoredCharacter,
} from "@shared/types/character/model";
import {isPuppetAppearance} from "@shared/types/character/model";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {authoredName, byId, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";

/**
 * What changed in the cast, said the way an author would say it.
 *
 * The example this exists for is one sentence long - "Alice's angry differential points at a
 * different image" - and it is the reason the character store became a document at all. The
 * structural tier answers the same edit with
 * `characters[3].profile.appearance.layers[2].options.t4k` and a pair of UUIDs, which is not a worse
 * rendering of the sentence; it is a different claim, made out of names nobody wrote.
 *
 * So the shape here is: one row per character, named by the character, and under it one leaf per
 * thing that moved, named by the pose, layer, axis or tag the author named. Two levels, because that
 * is all {@link DocumentChange} has and all a 320px rail can draw.
 *
 * Pure and non-throwing, per {@link import("../types").DocumentSpec.diff}: it runs inside the loop
 * that builds a whole revision's change list, where one exception costs every document's changes
 * rather than this one's. Every field below is therefore read defensively - these documents came out
 * of a repository, and some of them were written by a Studio that did not have half of this model.
 */

const LABEL = {
    castOrder: "documentDiff.characters.castOrder",
    added: "documentDiff.characters.added",
    removed: "documentDiff.characters.removed",
    changed: "documentDiff.characters.changed",
    renamed: "documentDiff.characters.renamed",
    profileField: "documentDiff.characters.profileField",
    kindChanged: "documentDiff.characters.kindChanged",
    poseAdded: "documentDiff.characters.poseAdded",
    poseRemoved: "documentDiff.characters.poseRemoved",
    poseRenamed: "documentDiff.characters.poseRenamed",
    poseAsset: "documentDiff.characters.poseAsset",
    poseChanged: "documentDiff.characters.poseChanged",
    poseOrder: "documentDiff.characters.poseOrder",
    defaultPose: "documentDiff.characters.defaultPose",
    axisAdded: "documentDiff.characters.axisAdded",
    axisRemoved: "documentDiff.characters.axisRemoved",
    axisChanged: "documentDiff.characters.axisChanged",
    layerAdded: "documentDiff.characters.layerAdded",
    layerRemoved: "documentDiff.characters.layerRemoved",
    layerChanged: "documentDiff.characters.layerChanged",
    layerAsset: "documentDiff.characters.layerAsset",
    layerOptionAsset: "documentDiff.characters.layerOptionAsset",
    layerOrder: "documentDiff.characters.layerOrder",
    appearanceField: "documentDiff.characters.appearanceField",
    avatarChanged: "documentDiff.characters.avatarChanged",
    groupAdded: "documentDiff.characters.groupAdded",
    groupRemoved: "documentDiff.characters.groupRemoved",
    groupRenamed: "documentDiff.characters.groupRenamed",
} as const;

/**
 * The profile fields compared one by one, in the order their rows are listed.
 *
 * `name` is not here because it has its own label (a rename is the one profile change worth a
 * sentence of its own), and `id` is not because it is the key this whole diff is aligned on - a
 * character whose id changed is a different character, and it already reads as one removed and one
 * added.
 */
const PROFILE_FIELDS = [
    "description",
    "tags",
    "nicknames",
    "attributes",
    "groupId",
    "color",
    "thumbnail",
    "portrait",
    "defaultAvatarAssetId",
    "voiceTrackId",
] as const;

/** Puppet fields, same idea. `kind` is handled above them - a kind switch discards everything else. */
const PUPPET_FIELDS = ["assetId", "backend", "entry", "size", "options", "defaultState"] as const;

/** Layered fields that are not one of the keyed collections. */
const LAYERED_FIELDS = ["canvas", "avatarAxisIds", "psd"] as const;

export function diffCharacterStore(
    base: CharacterStoreDocument,
    head: CharacterStoreDocument,
    options: {limit: number},
): DocumentDiff {
    const rows: DocumentChange[] = [];

    const baseCharacters = charactersById(base);
    const headCharacters = charactersById(head);

    // The cast order is an ordered array the author arranges, so it gets ONE row for the whole array
    // rather than a row per moved character. Reported only when the membership is otherwise the
    // same: while characters are being added and removed, "the order changed" is not news, it is
    // arithmetic.
    const baseOrder = Object.keys(baseCharacters);
    const headOrder = Object.keys(headCharacters);
    if (baseOrder.length === headOrder.length
        && baseOrder.some((id, index) => id !== headOrder[index])
        && baseOrder.every(id => Object.prototype.hasOwnProperty.call(headCharacters, id))) {
        rows.push(change(["characters"], "moved", LABEL.castOrder, {params: {count: headOrder.length}}));
    }

    const characterRows: DocumentChange[] = [];
    for (const entry of diffKeyed(baseCharacters, headCharacters)) {
        const row = characterRow(entry.key, entry.base, entry.head);
        if (row) {
            characterRows.push(row);
        }
    }
    // By the author's own name, then by id so two characters called the same thing still have a
    // fixed order. Sorted BEFORE `buildDocumentDiff` truncates, which is the whole discipline: a
    // list truncated first and sorted after is a confident, ranked, arbitrary answer.
    characterRows.sort(byNameThenPath);
    rows.push(...characterRows);

    const groupRows: DocumentChange[] = [];
    for (const entry of diffKeyed<CharacterGroup>(base.groups, head.groups)) {
        const row = groupRow(entry.key, entry.base, entry.head);
        if (row) groupRows.push(row);
    }
    groupRows.sort(byNameThenPath);
    rows.push(...groupRows);

    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}

/** The cast as a map, keyed by the id the profile carries. Entries with no id are dropped rather than guessed at. */
function charactersById(store: CharacterStoreDocument): Record<string, StoredCharacter> {
    const record: Record<string, StoredCharacter> = {};
    for (const character of Array.isArray(store.characters) ? store.characters : []) {
        const id = character?.profile?.id;
        if (typeof id === "string" && id.length > 0 && !Object.prototype.hasOwnProperty.call(record, id)) {
            record[id] = character;
        }
    }
    return record;
}

function characterRow(
    id: string,
    base: StoredCharacter | undefined,
    head: StoredCharacter | undefined,
): DocumentChange | undefined {
    const path = ["characters", id];
    if (!base || !head) {
        const present = (head ?? base) as StoredCharacter;
        return change(path, head ? "added" : "removed", head ? LABEL.added : LABEL.removed, {
            subject: authoredName(present?.profile?.name),
        });
    }

    const children = characterLeaves(path, base, head);
    if (children.length === 0) {
        // Reachable: two characters that differ only in a field this diff does not model (or in key
        // order, which `sameJsonValue` already collapses). Saying "changed, and the detail is not
        // shown" beats an empty list, which reads as "nothing happened to a character you can see is
        // dirty".
        return change(path, "changed", LABEL.changed, {subject: authoredName(head.profile?.name)});
    }
    return change(path, "changed", LABEL.changed, {
        subject: authoredName(head.profile?.name),
        children,
    });
}

function characterLeaves(path: readonly string[], base: StoredCharacter, head: StoredCharacter): DocumentChange[] {
    const leaves: DocumentChange[] = [];
    // Read as a bare record rather than as the typed profile: the fields are visited by name from
    // {@link PROFILE_FIELDS}, and these two documents came out of a repository - one of them may
    // predate half the fields the type declares, and neither is guaranteed to have a profile at all.
    const baseProfile = (base.profile ?? {}) as unknown as Record<string, unknown>;
    const headProfile = (head.profile ?? {}) as unknown as Record<string, unknown>;

    if (!sameJsonValue(baseProfile.name, headProfile.name)) {
        leaves.push(change([...path, "name"], "changed", LABEL.renamed, {
            params: fromToParams(baseProfile.name, headProfile.name),
            subject: authoredName(headProfile.name),
        }));
    }
    for (const field of PROFILE_FIELDS) {
        if (!sameJsonValue(baseProfile[field], headProfile[field])) {
            leaves.push(change([...path, field], presence(baseProfile[field], headProfile[field]), LABEL.profileField, {
                params: {field, ...fromToParams(baseProfile[field], headProfile[field])},
            }));
        }
    }

    leaves.push(...appearanceLeaves(
        [...path, "appearance"],
        baseProfile.appearance as ICharacterAppearance | undefined,
        headProfile.appearance as ICharacterAppearance | undefined,
    ));
    return leaves;
}

/**
 * The appearance, which is three unrelated shapes behind one `kind`.
 *
 * A kind switch is reported as ONE row and stops there. That is not a shortcut: switching kinds
 * discards everything the two kinds do not share (which is everything), so listing the poses that
 * "disappeared" beside it would describe the same single act N more times, in the vocabulary of a
 * model the character is no longer on.
 */
function appearanceLeaves(
    path: readonly string[],
    base: ICharacterAppearance | undefined,
    head: ICharacterAppearance | undefined,
): DocumentChange[] {
    if (!base || !head) {
        return sameJsonValue(base, head)
            ? []
            : [change([...path], presence(base, head), LABEL.appearanceField, {params: {field: "appearance"}})];
    }
    if (base.kind !== head.kind) {
        return [change([...path, "kind"], "changed", LABEL.kindChanged, {
            params: {from: String(base.kind), to: String(head.kind)},
        })];
    }
    if (isPuppetAppearance(head) && isPuppetAppearance(base)) {
        return puppetLeaves(path, base, head);
    }
    if (head.kind === "layered" && base.kind === "layered") {
        return layeredLeaves(path, base, head);
    }
    if (head.kind === "preset" && base.kind === "preset") {
        return presetLeaves(path, base, head);
    }
    return [];
}

function presetLeaves(path: readonly string[], base: PresetAppearance, head: PresetAppearance): DocumentChange[] {
    const leaves: DocumentChange[] = [];
    const basePoses = byId<CharacterPose>(base.poses);
    const headPoses = byId<CharacterPose>(head.poses);

    for (const entry of diffKeyed(basePoses, headPoses)) {
        const posePath = [...path, "poses", entry.key];
        if (!entry.base || !entry.head) {
            const present = (entry.head ?? entry.base) as CharacterPose;
            leaves.push(change(posePath, entry.kind, entry.head ? LABEL.poseAdded : LABEL.poseRemoved, {
                subject: authoredName(present?.name),
            }));
            continue;
        }
        // The motivating row: a differential whose art changed. Reported as its own leaf, named by
        // the pose, rather than as a pair of asset UUIDs at the end of a JSON path.
        if (!sameJsonValue(entry.base.assetId, entry.head.assetId)) {
            leaves.push(change([...posePath, "assetId"], "changed", LABEL.poseAsset, {
                subject: authoredName(entry.head.name),
            }));
        }
        if (!sameJsonValue(entry.base.name, entry.head.name)) {
            leaves.push(change([...posePath, "name"], "changed", LABEL.poseRenamed, {
                params: fromToParams(entry.base.name, entry.head.name),
                subject: authoredName(entry.head.name),
            }));
        }
        if (!sameJsonValue(entry.base.folder, entry.head.folder)
            || !sameJsonValue(entry.base.portrait, entry.head.portrait)) {
            leaves.push(change(posePath, "changed", LABEL.poseChanged, {
                subject: authoredName(entry.head.name),
            }));
        }
    }

    if (orderChanged(base.poses, head.poses)) {
        leaves.push(change([...path, "poses"], "moved", LABEL.poseOrder));
    }
    if (!sameJsonValue(base.defaultPoseId, head.defaultPoseId)) {
        leaves.push(change([...path, "defaultPoseId"], "changed", LABEL.defaultPose, {
            subject: authoredName(headPoses[String(head.defaultPoseId)]?.name),
        }));
    }
    leaves.push(...avatarLeaves(path, base.avatars, head.avatars));
    return leaves;
}

function layeredLeaves(path: readonly string[], base: LayeredAppearance, head: LayeredAppearance): DocumentChange[] {
    const leaves: DocumentChange[] = [];
    const headTagNames = tagNames(head.axes);
    const baseTagNames = tagNames(base.axes);

    for (const entry of diffKeyed(byId<CharacterAxis>(base.axes), byId<CharacterAxis>(head.axes))) {
        const axisPath = [...path, "axes", entry.key];
        const present = (entry.head ?? entry.base) as CharacterAxis;
        if (!entry.base || !entry.head) {
            leaves.push(change(axisPath, entry.kind, entry.head ? LABEL.axisAdded : LABEL.axisRemoved, {
                subject: authoredName(present?.name),
            }));
            continue;
        }
        leaves.push(change(axisPath, "changed", LABEL.axisChanged, {subject: authoredName(entry.head.name)}));
    }

    for (const entry of diffKeyed(byId<CharacterLayer>(base.layers), byId<CharacterLayer>(head.layers))) {
        const layerPath = [...path, "layers", entry.key];
        if (!entry.base || !entry.head) {
            const present = (entry.head ?? entry.base) as CharacterLayer;
            leaves.push(change(layerPath, entry.kind, entry.head ? LABEL.layerAdded : LABEL.layerRemoved, {
                subject: authoredName(present?.name),
            }));
            continue;
        }
        const layerName = authoredName(entry.head.name);
        if (!sameJsonValue(entry.base.assetId, entry.head.assetId)) {
            leaves.push(change([...layerPath, "assetId"], "changed", LABEL.layerAsset, {subject: layerName}));
        }
        // A layer's `options` is one image per tag of its axis, so the layered model's version of
        // "the angry differential points at a different image" is one entry of this map. One leaf
        // per tag, named by the TAG - the layer is the mechanism, the tag is what the author calls
        // the look.
        for (const option of diffKeyed(entry.base.options, entry.head.options)) {
            const tag = headTagNames[option.key] ?? baseTagNames[option.key];
            leaves.push(change([...layerPath, "options", option.key], option.kind, LABEL.layerOptionAsset, {
                params: {...(layerName ? {layer: layerName} : {}), ...(tag ? {tag} : {})},
                subject: tag ?? layerName,
            }));
        }
        if (!sameJsonValue(entry.base.name, entry.head.name) || !sameJsonValue(entry.base.axisId, entry.head.axisId)) {
            leaves.push(change(layerPath, "changed", LABEL.layerChanged, {
                params: fromToParams(entry.base.name, entry.head.name),
                subject: layerName,
            }));
        }
    }

    if (orderChanged(base.layers, head.layers)) {
        // The stack order IS the picture - it decides what draws over what - so it is one row about
        // the array, never a row per layer that moved.
        leaves.push(change([...path, "layers"], "moved", LABEL.layerOrder));
    }

    for (const field of LAYERED_FIELDS) {
        if (!sameJsonValue(base[field], head[field])) {
            leaves.push(change([...path, field], presence(base[field], head[field]), LABEL.appearanceField, {
                params: {field},
            }));
        }
    }
    if (!sameJsonValue(base.snapshots, head.snapshots)) {
        leaves.push(change([...path, "snapshots"], "changed", LABEL.appearanceField, {params: {field: "snapshots"}}));
    }
    leaves.push(...avatarLeaves(path, base.avatars, head.avatars));
    return leaves;
}

function puppetLeaves(path: readonly string[], base: PuppetAppearance, head: PuppetAppearance): DocumentChange[] {
    const leaves: DocumentChange[] = [];
    for (const field of PUPPET_FIELDS) {
        if (!sameJsonValue(base[field], head[field])) {
            leaves.push(change([...path, field], presence(base[field], head[field]), LABEL.appearanceField, {
                params: {field, ...fromToParams(base[field], head[field])},
            }));
        }
    }
    return leaves;
}

/**
 * The dialog avatar table, keyed by pose id (preset) or by a sorted tag combination (layered).
 *
 * The key is not the author's word in either case, so it goes in the label's parameters and never in
 * `subject`. One leaf per key rather than one for the table: a re-bake that changed one differential
 * and a re-bake that changed forty are different-sized events.
 */
function avatarLeaves(
    path: readonly string[],
    base: Readonly<Record<string, unknown>> | undefined,
    head: Readonly<Record<string, unknown>> | undefined,
): DocumentChange[] {
    return diffKeyed(base, head).map(entry => change(
        [...path, "avatars", entry.key],
        entry.kind,
        LABEL.avatarChanged,
        {params: {key: entry.key}},
    ));
}

/**
 * A group row, or nothing when the two versions differ only in ways the author cannot see.
 *
 * `CharacterGroup` is `{id, name, createdAt, updatedAt}` - one authored field and two
 * timestamps. So a group whose name is unchanged has, by construction, changed only in a
 * timestamp, and the honest number of rows for that is zero: the label here says
 * "renamed", and reporting a rename with an identical `from` and `to` is a change list
 * asserting something false. It is also the kind of row that trains an author to stop
 * reading the list, which costs more than the row itself.
 */
function groupRow(
    id: string,
    base: CharacterGroup | undefined,
    head: CharacterGroup | undefined,
): DocumentChange | undefined {
    const path = ["groups", id];
    if (!base || !head) {
        const present = (head ?? base) as CharacterGroup;
        return change(path, head ? "added" : "removed", head ? LABEL.groupAdded : LABEL.groupRemoved, {
            subject: authoredName(present?.name),
        });
    }
    if (base.name === head.name) return undefined;
    return change(path, "changed", LABEL.groupRenamed, {
        params: fromToParams(base.name, head.name),
        subject: authoredName(head.name),
    });
}

/** Whether two id-carrying lists hold the same ids in a different order. */
function orderChanged(base: readonly {id?: unknown}[] | undefined, head: readonly {id?: unknown}[] | undefined): boolean {
    const left = Object.keys(byId(base));
    const right = Object.keys(byId(head));
    if (left.length !== right.length) {
        // Membership changed, which is already a row per added or removed element. Calling that a
        // reorder as well would double-report one act.
        return false;
    }
    const inBase = new Set(left);
    return right.every(id => inBase.has(id)) && (base ?? []).some((element, index) => element?.id !== head?.[index]?.id);
}

/** `tagId -> the author's name for it`, across every axis. */
function tagNames(axes: readonly CharacterAxis[] | undefined): Record<string, string> {
    const names: Record<string, string> = {};
    for (const axis of axes ?? []) {
        for (const tag of axis?.tags ?? []) {
            const name = authoredName(tag?.name);
            if (typeof tag?.id === "string" && name && !names[tag.id]) {
                names[tag.id] = name;
            }
        }
    }
    return names;
}

/** Whether an optional field appeared, disappeared, or merely changed. */
function presence(base: unknown, head: unknown): "added" | "removed" | "changed" {
    if (base === undefined) {
        return "added";
    }
    return head === undefined ? "removed" : "changed";
}

/** By the author's own name, then by path. Rows with no name sort last, since there is nothing to read them by. */
function byNameThenPath(a: DocumentChange, b: DocumentChange): number {
    const left = a.subject ?? "";
    const right = b.subject ?? "";
    if (left !== right) {
        if (left === "") return 1;
        if (right === "") return -1;
        return left < right ? -1 : 1;
    }
    const leftPath = a.path.join("/");
    const rightPath = b.path.join("/");
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
}
