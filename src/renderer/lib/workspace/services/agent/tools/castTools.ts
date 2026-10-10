/**
 * Characters, global variables and audio tracks.
 *
 * A character's name colour is the profile's main colour (`CharacterProfile.color`): it is what Dev
 * Mode's timeline and the `Get Speaker Color` node read for the speaker, and the skeleton's dialogue
 * box paints the name tag with it. Poses exist only on preset characters - a layered character's
 * looks are axes and layers, which this tool does not author, and it says so rather than half-writing
 * them.
 *
 * How big a sprite is drawn and where its feet land is the character's `entranceTransform` - the
 * transform every entrance row falls back to, channel by channel, and the "Entrance" section of
 * Studio's character panel. `spriteStage.ts` states the runtime's rule; this file exposes the field,
 * gives a character that has none a standing default the first time it gets art, and reports the
 * box a sprite lands in so an agent need not take a screenshot to learn it.
 *
 * Comments in English per project convention.
 */

import type { StoryLiteralValue, StoryTransformProps } from "@shared/types/story";
import type { StoryVariableValueType } from "@shared/types/story/document";
import type { VariableRegistryEntry, VariableRegistryScope } from "@shared/types/variables/registry";
import { AssetType } from "../../assets/assetTypes";
import type { Asset, AssetSource } from "../../assets/types";
import { Services, type WorkspaceContext } from "../../services";
import type { CharacterService } from "../../core/CharacterService";
import type { Character } from "../../character/Character";
import type { VariableRegistryService } from "../../variables/VariableRegistryService";
import type { AudioTrackService } from "../../audio/AudioTrackService";
import type { AssetsService } from "../../core/AssetsService";
import type { ProjectService } from "../../core/ProjectService";
import { VARIABLE_PANEL_HISTORY_SCOPE_ID, type LocalBlueprintService } from "../../ui-editor/LocalBlueprintService";
import {
    answerJson,
    readOptionalString,
    readOptionalStringArray,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { assetsService, resolveAsset } from "../agentLookups";
import { blueprintReferencesTo, formatReferrers, storyReferencesTo, storyUsesNotFitting, uiReferencesTo } from "../agentReferences";
import { opaqueImageWarning, readImageAlpha, type ImageAlphaFacts } from "../imageAlpha";
import { drawnBoxAtCenter, stageSizeOf, standingEntrance, type PixelSize } from "../spriteStage";
import { liveBlueprintDocument, loadAllStories, uiDocumentService } from "./textFormat";

/** The project's design resolution: the stage every sprite position is a share of. */
function stageSize(ctx: WorkspaceContext): PixelSize {
    return stageSizeOf(ctx.services.get<ProjectService>(Services.Project).getProjectConfig().metadata?.resolution);
}

export type ImageFacts = { name: string; size: PixelSize | null; header: ImageAlphaFacts };

/**
 * An image asset's pixel size and whether it can be transparent, from its bytes. Null when the asset
 * is gone or will not read - a pose that cannot be measured is reported without a box, never refused.
 */
export async function readImageFacts(ctx: WorkspaceContext, assetId: string): Promise<ImageFacts | null> {
    const assets = assetsService(ctx);
    const asset = assets.getAssets()[AssetType.Image]?.[assetId] as Asset<AssetType, AssetSource> | undefined;
    if (!asset) {
        return null;
    }
    const fetched = await assets.fetch(asset).catch(() => null);
    const data = fetched && fetched.success ? (fetched.data as { data?: unknown; metadata?: { width?: number; height?: number } } | undefined) : undefined;
    if (!data || !(data.data instanceof Uint8Array)) {
        return null;
    }
    const facts = readImageAlpha(data.data);
    const width = data.metadata?.width || facts.width;
    const height = data.metadata?.height || facts.height;
    return { name: asset.name, size: width && height ? { width, height } : null, header: facts };
}

function describeCharacter(character: Character, assets: AssetsService, stage: PixelSize, sprite: PixelSize | null) {
    const profile = character.profile;
    const appearance = profile.appearance;
    const images = assets.getAssets()[AssetType.Image] ?? {};
    const defaultPoseId = appearance.getDefaultPoseId();
    const entranceTransform = profile.getEntranceTransform();
    return {
        id: profile.getId(),
        name: profile.getName(),
        nicknames: [...profile.getNicknames()],
        nameColor: profile.getColor() ?? null,
        kind: appearance.getKind(),
        poses: appearance.getPoses().map(pose => ({
            name: pose.name,
            assetId: pose.assetId ?? null,
            assetName: pose.assetId ? images[pose.assetId]?.name ?? null : null,
        })),
        defaultPose: defaultPoseId ? appearance.getPose(defaultPoseId)?.name ?? null : null,
        entranceTransform: entranceTransform ?? null,
        // The default pose's own pixels, and the box it lands in on a `pos=center` row - the
        // numbers an agent needs to judge size and baseline without a playtest screenshot.
        spriteSize: sprite,
        drawnAtCenter: sprite ? drawnBoxAtCenter(sprite, entranceTransform, stage) : null,
    };
}

/** The default pose's pixel size, for a preset character; null for anything else. */
async function defaultSpriteSize(ctx: WorkspaceContext, character: Character): Promise<PixelSize | null> {
    const appearance = character.profile.appearance;
    if (appearance.getKind() !== "preset") {
        return null;
    }
    const assetId = appearance.resolvePoseAssetId(undefined);
    return assetId ? (await readImageFacts(ctx, assetId))?.size ?? null : null;
}

export const charactersList: AgentToolHandler = async (_args, { ctx }) => {
    const cast = ctx.services.get<CharacterService>(Services.Character);
    const assets = assetsService(ctx);
    const stage = stageSize(ctx);
    const characters = [];
    for (const character of cast.listCharacter()) {
        characters.push(describeCharacter(character, assets, stage, await defaultSpriteSize(ctx, character)));
    }
    return answerJson({ stage, characters });
};

type PoseInput = { name: string; asset: string };

function readPoses(raw: unknown): PoseInput[] | undefined {
    if (raw === undefined || raw === null) {
        return undefined;
    }
    if (!Array.isArray(raw)) {
        throw refuse("invalid_args", "`poses` must be an array of { name, asset }.");
    }
    return raw.map((item, index) => {
        const pose = item as Partial<PoseInput> | null;
        if (!pose || typeof pose.name !== "string" || !pose.name.trim() || typeof pose.asset !== "string" || !pose.asset.trim()) {
            throw refuse("invalid_args", `poses[${index}] needs a \`name\` and an \`asset\`.`);
        }
        return { name: pose.name.trim(), asset: pose.asset.trim() };
    });
}

/** What `entranceTransform` asks for: leave it, clear it, fit it to the art, or state it. */
type EntranceInput = { kind: "keep" } | { kind: "clear" } | { kind: "standing" } | { kind: "set"; props: StoryTransformProps };

const ENTRANCE_KEYS = ["zoom", "scaleX", "scaleY", "position"] as const;
const POSITION_KEYS = ["xalign", "yalign", "xoffset", "yoffset"] as const;

function readEntrance(args: Record<string, unknown>): EntranceInput {
    if (!("entranceTransform" in args) || args.entranceTransform === undefined) {
        return { kind: "keep" };
    }
    const raw = args.entranceTransform;
    if (raw === null) {
        return { kind: "clear" };
    }
    if (raw === "standing") {
        return { kind: "standing" };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw refuse("invalid_args", "`entranceTransform` must be \"standing\", null, or { zoom, scaleX, scaleY, position }.");
    }
    const record = raw as Record<string, unknown>;
    const props: StoryTransformProps = {};
    for (const key of Object.keys(record)) {
        if (!(ENTRANCE_KEYS as readonly string[]).includes(key)) {
            throw refuse("invalid_args", `entranceTransform.${key}: not a channel this tool sets (expected ${ENTRANCE_KEYS.join(", ")}).`);
        }
    }
    for (const key of ["zoom", "scaleX", "scaleY"] as const) {
        const value = record[key];
        if (value === undefined) {
            continue;
        }
        if (typeof value !== "number" || !Number.isFinite(value) || (key === "zoom" && value <= 0)) {
            throw refuse("invalid_args", `entranceTransform.${key} must be a ${key === "zoom" ? "positive " : ""}number.`);
        }
        props[key] = value;
    }
    if (record.position !== undefined) {
        const position = record.position as Record<string, unknown> | null;
        if (!position || typeof position !== "object" || Array.isArray(position)) {
            throw refuse("invalid_args", "entranceTransform.position must be { xalign, yalign, xoffset, yoffset }.");
        }
        const next: NonNullable<StoryTransformProps["position"]> = {};
        for (const [key, value] of Object.entries(position)) {
            if (!(POSITION_KEYS as readonly string[]).includes(key) || typeof value !== "number" || !Number.isFinite(value)) {
                throw refuse("invalid_args", `entranceTransform.position.${key}: expected a number under one of ${POSITION_KEYS.join(", ")}.`);
            }
            next[key as (typeof POSITION_KEYS)[number]] = value;
        }
        props.position = next;
    }
    return { kind: "set", props };
}

export const characterUpsert: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const id = readOptionalString(args, "id");
    const name = readOptionalString(args, "name");
    const nicknames = readOptionalStringArray(args, "nicknames");
    const nameColor = readOptionalString(args, "nameColor");
    const poses = readPoses(args.poses);
    const defaultPose = readOptionalString(args, "defaultPose");
    const entrance = readEntrance(args);
    if (!id && !name) {
        throw refuse("invalid_args", "Give the character's `id` (to update one) or `name`.");
    }
    if (nameColor && typeof CSS !== "undefined" && !CSS.supports("color", nameColor)) {
        throw refuse("invalid_args", `"${nameColor}" is not a CSS colour.`);
    }
    // Every pose's image is resolved before anything is written, so a typo writes nothing.
    const poseAssets = (poses ?? []).map(pose => ({ name: pose.name, assetId: resolveAsset(ctx, pose.asset, AssetType.Image).id }));
    if (defaultPose && poses && !poses.some(pose => pose.name === defaultPose)) {
        throw refuse("invalid_args", `\`defaultPose\` "${defaultPose}" is not one of the poses given.`);
    }

    const cast = ctx.services.get<CharacterService>(Services.Character);
    let character: Character | undefined = id ? cast.getCharacter(id) : undefined;
    if (id && !character) {
        throw refuse("not_found", `No character with id ${id}.`, "Call characters_list for the ids.");
    }
    if (!character && name) {
        const named = cast.listCharacter().filter(item => item.profile.getName() === name);
        if (named.length > 1) {
            throw refuse("invalid_args", `${named.length} characters are called "${name}".`, "Name the character by id.");
        }
        character = named[0];
    }
    follow.describeCall(request.callId, name ?? character?.profile.getName() ?? "");
    if (poses && character && character.profile.appearance.getKind() !== "preset") {
        throw refuse("unavailable", `"${character.profile.getName()}" is a layered character; its poses are axes and layers, which are edited in Studio's character editor.`);
    }
    if (entrance.kind === "standing" && character && character.profile.appearance.getKind() !== "preset") {
        throw refuse("unavailable", `"${character.profile.getName()}" is a layered character, which has no single picture to fit; state \`entranceTransform\` as numbers instead.`);
    }

    // Read before writing, so an opaque picture is reported with the write rather than discovered on
    // the stage. A pose that will not read is not refused - the pose list is the author's to keep.
    const poseFacts = new Map<string, ImageFacts | null>();
    for (const pose of poseAssets) {
        if (!poseFacts.has(pose.assetId)) {
            poseFacts.set(pose.assetId, await readImageFacts(ctx, pose.assetId));
        }
    }
    const warnings: string[] = [];
    for (const facts of poseFacts.values()) {
        if (facts && facts.header.alpha === false) {
            warnings.push(opaqueImageWarning(facts.name, facts.header));
        }
    }

    let created = false;
    if (!character) {
        const made = cast.createCharacter(name!, "preset", nameColor ? { color: nameColor } : undefined);
        character = cast.getCharacter(made.profile.getId()) ?? made;
        created = true;
    }
    const profile = character.profile;
    if (!created && name && name !== profile.getName()) {
        await cast.renameCharacter(profile.getId(), name);
    }
    if (!created && nameColor !== undefined && nameColor !== profile.getColor()) {
        profile.setColor(nameColor);
    }
    if (nicknames) {
        for (const existing of [...profile.getNicknames()]) {
            if (!nicknames.includes(existing)) {
                profile.removeNickname(existing);
            }
        }
        for (const nickname of nicknames.map(item => item.trim()).filter(Boolean)) {
            if (!profile.hasNickname(nickname)) {
                profile.addNickname(nickname);
            }
        }
    }
    const appearance = profile.appearance;
    if (poses) {
        for (const pose of [...appearance.getPoses()]) {
            appearance.removePose(pose.id);
        }
        for (const pose of poseAssets) {
            const made = appearance.createPose(pose.name);
            if (made) {
                appearance.setPoseAsset(made.id, pose.assetId);
            }
        }
    }
    if (defaultPose) {
        const pose = appearance.getPoses().find(item => item.name === defaultPose);
        if (!pose) {
            throw refuse("not_found", `"${profile.getName()}" has no pose "${defaultPose}".`);
        }
        appearance.setDefaultPoseId(pose.id);
    }

    // Entrance defaults. A character that gets art and has none stands on the bottom edge at its
    // own pixels: the stage's neutral would centre it vertically, which no visual novel wants, and an
    // agent cannot see the stage to notice. A character that already has defaults keeps them - they
    // are an author's decision - but when its art was just replaced the numbers were chosen for other
    // pixels (the skeleton's demo cast is tuned for its demo sprite), so the answer says so.
    const stage = stageSize(ctx);
    const defaultAssetId = appearance.getKind() === "preset" ? appearance.resolvePoseAssetId(undefined) : null;
    const defaultSprite = defaultAssetId
        ? (poseFacts.get(defaultAssetId) ?? await readImageFacts(ctx, defaultAssetId))?.size ?? null
        : null;
    let entranceNote = "";
    if (entrance.kind === "set") {
        profile.setEntranceTransform(entrance.props);
    } else if (entrance.kind === "clear") {
        profile.setEntranceTransform(undefined);
    } else if (entrance.kind === "standing" || (poses && poses.length > 0 && profile.getEntranceTransform() === undefined)) {
        if (!defaultSprite) {
            if (entrance.kind === "standing") {
                throw refuse("unavailable", `"${profile.getName()}" has no readable pose image to fit.`, "Give `poses` first, or state `entranceTransform` as numbers.");
            }
        } else {
            profile.setEntranceTransform(standingEntrance(defaultSprite, stage));
            entranceNote = entrance.kind === "standing" ? "" : " Entrance set to a standing sprite (feet on the bottom edge, own pixel size).";
        }
    } else if (poses && profile.getEntranceTransform() !== undefined) {
        warnings.push(
            `"${profile.getName()}" keeps its entrance defaults ${JSON.stringify(profile.getEntranceTransform())}, chosen for its previous art. `
            + "Check drawnAtCenter below; pass `entranceTransform: \"standing\"` to refit them to the new pose, or state them.",
        );
    }

    const current = cast.getCharacter(profile.getId()) ?? character;
    const sprite = defaultSprite ?? await defaultSpriteSize(ctx, current);
    return answerJson(
        {
            created,
            character: describeCharacter(current, assetsService(ctx), stage, sprite),
            ...(warnings.length > 0 ? { warnings } : {}),
        },
        `${created ? "Created" : "Updated"} character "${current.profile.getName()}".${entranceNote}${warnings.length > 0 ? ` ${warnings.length} warning(s).` : ""}`,
    );
};

/**
 * Delete a character, refusing while anything still names it.
 *
 * Studio's own deletion keeps the lines a deleted character spoke, as lines under a bare name - the
 * right thing for an author who knows what they are removing. An agent clearing out demo content
 * should not silently turn a cast member's lines into nameless ones, and a stage row or a blueprint
 * naming the character has no such fallback at all. So the refusal lists every place first; the
 * deletion is Studio's own, one step of undo on the project's stack.
 */
export const characterDelete: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const ref = readString(args, "character");
    const cast = ctx.services.get<CharacterService>(Services.Character);
    let character = cast.getCharacter(ref);
    if (!character) {
        const named = cast.listCharacter().filter(item => item.profile.getName() === ref);
        if (named.length > 1) {
            throw refuse("invalid_args", `${named.length} characters are called "${ref}".`, "Name the character by id (characters_list).");
        }
        character = named[0];
    }
    if (!character) {
        throw refuse("not_found", `No character "${ref}".`, "Call characters_list for the names and ids.");
    }
    const id = character.profile.getId();
    const name = character.profile.getName();
    follow.describeCall(request.callId, name);
    const { stories } = await loadAllStories(ctx);
    const referrers = [
        ...storyReferencesTo(stories, id),
        ...blueprintReferencesTo(liveBlueprintDocument(ctx), id),
        ...uiReferencesTo(uiDocumentService(ctx).getDocument(), id),
    ];
    if (referrers.length > 0) {
        throw refuse(
            "unavailable",
            `"${name}" is still named in ${referrers.length} place(s):\n${formatReferrers(referrers)}`,
            "Rewrite or delete those rows first (story_apply, or scene_delete for a whole scene), then delete the character.",
        );
    }
    if (!(await cast.deleteCharacter(id))) {
        throw refuse("unavailable", `"${name}" could not be deleted.`);
    }
    return answerJson({ deleted: { id, name } }, `Deleted character "${name}". One step of undo in Studio.`);
};

function describeVariable(entry: VariableRegistryEntry) {
    return {
        id: entry.id,
        name: entry.name,
        scope: entry.scope,
        valueType: entry.valueType,
        defaultValue: entry.defaultValue ?? null,
        description: entry.description ?? null,
    };
}

export const variablesList: AgentToolHandler = async (_args, { ctx }) => {
    const registry = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
    return answerJson({ variables: registry.listEntries().map(describeVariable) });
};

const VALUE_TYPES = ["number", "boolean", "string"] as const;
type AgentValueType = (typeof VALUE_TYPES)[number];

function checkDefault(valueType: string, value: unknown): StoryLiteralValue | undefined {
    if (value === undefined) {
        return undefined;
    }
    const ok =
        (valueType === "number" && typeof value === "number" && Number.isFinite(value))
        || (valueType === "boolean" && typeof value === "boolean")
        || (valueType === "string" && typeof value === "string");
    if (!ok) {
        throw refuse("invalid_args", `\`defaultValue\` must be a ${valueType}.`);
    }
    return value as StoryLiteralValue;
}

/** A variable by name or id - the same lookup every variable tool uses. */
function findVariable(registry: VariableRegistryService, ref: string): VariableRegistryEntry {
    const byId = registry.getEntry(ref);
    if (byId) {
        return byId;
    }
    const named = registry.listEntries().filter(entry => entry.name === ref);
    if (named.length > 1) {
        throw refuse("invalid_args", `${named.length} variables are called "${ref}".`, "Name the variable by id (variables_list).");
    }
    if (named.length === 0) {
        throw refuse("not_found", `No variable "${ref}".`, "Call variables_list for the names and ids.");
    }
    return named[0];
}

/**
 * Registry edits ride the blueprint history channel, under the same scope the Variables panel uses,
 * so one call is one step of undo there - a rename, a retype and a description together included.
 */
function inVariableHistory<T>(ctx: WorkspaceContext, action: () => T): T {
    return ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint).runBlueprintHistoryTransaction(VARIABLE_PANEL_HISTORY_SCOPE_ID, action);
}

/**
 * Create a variable, or update one: by `id` (which is how one is renamed - story rows and nodes
 * hold the id, so they follow), else by exact `name`. `name` and `valueType` are required only to
 * create; the schema cannot say "required unless `id`", so the check is here.
 */
export const variableUpsert: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const id = readOptionalString(args, "id");
    const name = readOptionalString(args, "name");
    const valueType = readOptionalString(args, "valueType");
    if (valueType !== undefined && !VALUE_TYPES.includes(valueType as AgentValueType)) {
        throw refuse("invalid_args", `\`valueType\` must be one of ${VALUE_TYPES.join(", ")}.`);
    }
    const scopeArg = readOptionalString(args, "scope") as VariableRegistryScope | undefined;
    if (scopeArg !== undefined && scopeArg !== "saved" && scopeArg !== "persistent") {
        throw refuse("invalid_args", "`scope` must be saved or persistent.");
    }
    // Raw rather than through `readOptionalString`, which reads "" as absent: "" is how a
    // description is cleared.
    const rawDescription = args.description;
    if (rawDescription !== undefined && rawDescription !== null && typeof rawDescription !== "string") {
        throw refuse("invalid_args", "`description` must be a string.");
    }
    const description = typeof rawDescription === "string" ? rawDescription.trim() : undefined;
    if (!id && !name) {
        throw refuse("invalid_args", "Give the variable's `id` (to update or rename one) or its `name`.");
    }

    const registry = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
    let entry: VariableRegistryEntry | undefined;
    if (id) {
        entry = registry.getEntry(id);
        if (!entry) {
            throw refuse("not_found", `No variable with id ${id}.`, "Call variables_list for the ids.");
        }
    } else {
        const existing = registry.listEntries().filter(item => item.name === name);
        if (existing.length > 1) {
            throw refuse("invalid_args", `${existing.length} variables are called "${name}".`, "Name the variable by id (variables_list).");
        }
        entry = existing[0];
    }
    follow.describeCall(request.callId, name ?? entry?.name ?? "");

    if (!entry) {
        if (!valueType) {
            throw refuse("invalid_args", "`valueType` is required to create a variable.", "To update or rename an existing one, give its `id`.");
        }
        const scope = scopeArg ?? "saved";
        const defaultValue = checkDefault(valueType, args.defaultValue);
        const made = inVariableHistory(ctx, () => registry.createEntry(scope, { name: name!, valueType, defaultValue, description }));
        const stored = registry.getEntry(made.id) ?? made;
        return answerJson({ created: true, variable: describeVariable(stored) }, `Created ${scope} variable "${stored.name}". One step of undo in Studio.`);
    }

    const target = entry;
    if (scopeArg && target.scope !== scopeArg) {
        throw refuse("unavailable", `"${target.name}" is a ${target.scope} variable.`, "A variable cannot move between saved and persistent; create a new one and delete this one (variable_delete).");
    }
    if (name && name !== target.name) {
        const clash = registry.listEntries().find(item => item.id !== target.id && item.name === name);
        if (clash) {
            throw refuse("invalid_args", `Another ${clash.scope} variable is already called "${name}".`);
        }
    }
    const nextType = (valueType ?? target.valueType) as StoryVariableValueType;
    const defaultValue = checkDefault(nextType, args.defaultValue);
    inVariableHistory(ctx, () => {
        if (name && name !== target.name) {
            registry.renameEntry(target.id, name);
        }
        if (valueType && valueType !== target.valueType) {
            // Retype and default together, as the panel does: they hold each other up.
            registry.setEntryValueType(target.id, valueType as AgentValueType, defaultValue);
        } else if (defaultValue !== undefined) {
            registry.setEntryDefault(target.id, defaultValue);
        }
        if (description !== undefined && description !== (target.description ?? "")) {
            registry.setEntryDescription(target.id, description || undefined);
        }
    });
    const updated = registry.getEntry(target.id) ?? target;
    // A retype rewrites the variable and nothing that uses it: a `/set` still writing the old type,
    // or a branch still testing it as one, is left as it was and goes wrong at play time. Said here,
    // with each row, rather than left for the agent to find in a playtest.
    const warnings: string[] = [];
    if (valueType && valueType !== target.valueType) {
        const { stories } = await loadAllStories(ctx);
        const misfits = storyUsesNotFitting(stories, target.id, valueType as StoryVariableValueType);
        if (misfits.length > 0) {
            warnings.push(
                `${misfits.length} story row(s) still use "${updated.name}" as a ${target.valueType}, which a ${valueType} `
                    + `no longer fits; rewrite them with story_apply:\n${formatReferrers(misfits)}`,
            );
        }
        const elsewhere = [
            ...blueprintReferencesTo(liveBlueprintDocument(ctx), target.id),
            ...uiReferencesTo(uiDocumentService(ctx).getDocument(), target.id),
        ];
        if (elsewhere.length > 0) {
            warnings.push(
                `"${updated.name}" is also used by ${elsewhere.length} blueprint(s) or element(s), whose values were not checked `
                    + `against the new type - look at them (blueprint_show):\n${formatReferrers(elsewhere)}`,
            );
        }
    }
    return answerJson(
        { created: false, variable: describeVariable(updated), ...(warnings.length > 0 ? { warnings } : {}) },
        `Updated variable "${updated.name}". One step of undo in Studio.${warnings.length > 0 ? `\n${warnings.join("\n")}` : ""}`,
    );
};

/**
 * Delete a global variable, refusing while anything still uses it.
 *
 * Studio's own deletion clears every `Get`/`Set` node that named the variable and leaves them empty,
 * which an author deleting by hand can see; story rows reading it have no such sweep and would fail
 * at play time. An agent clearing out the skeleton's demo variables should do neither silently, so
 * the refusal lists every row, blueprint and element first. The deletion itself is Studio's own,
 * one step of undo on the Variables panel's history.
 */
export const variableDelete: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const ref = readString(args, "variable");
    const registry = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
    const entry = findVariable(registry, ref);
    follow.describeCall(request.callId, entry.name);
    const { stories } = await loadAllStories(ctx);
    const referrers = [
        ...storyReferencesTo(stories, entry.id),
        ...blueprintReferencesTo(liveBlueprintDocument(ctx), entry.id),
        ...uiReferencesTo(uiDocumentService(ctx).getDocument(), entry.id),
    ];
    if (referrers.length > 0) {
        throw refuse(
            "unavailable",
            `"${entry.name}" is still used in ${referrers.length} place(s):\n${formatReferrers(referrers)}`,
            "Rewrite those rows (story_apply) or blueprints (blueprint_apply) first, then delete the variable. To keep it under a new name, use variable_upsert with its id.",
        );
    }
    const blueprints = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    const deleted = entry.scope === "persistent"
        ? blueprints.deletePersistentVariable(VARIABLE_PANEL_HISTORY_SCOPE_ID, entry.id)
        : blueprints.deleteSavedRegistryVariable(VARIABLE_PANEL_HISTORY_SCOPE_ID, entry.id);
    if (!deleted) {
        throw refuse("unavailable", `"${entry.name}" cannot be deleted right now: the live session this project is in cannot carry the deletion.`);
    }
    return answerJson(
        { deleted: describeVariable(entry), variables: registry.listEntries().map(describeVariable) },
        `Deleted ${entry.scope} variable "${entry.name}". One step of undo in Studio.`,
    );
};

export const audioTracksList: AgentToolHandler = async (_args, { ctx }) => {
    const tracks = ctx.services.get<AudioTrackService>(Services.AudioTracks).listTracks();
    return answerJson({
        tracks: tracks.map(track => ({
            id: track.id,
            name: track.name,
            parentId: track.parentId,
            volume: track.volume,
            loop: track.loop,
            builtin: track.builtin === true,
        })),
    });
};
