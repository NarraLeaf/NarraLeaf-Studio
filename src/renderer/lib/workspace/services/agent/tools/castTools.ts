/**
 * Characters, global variables and audio tracks.
 *
 * A character's name colour is the profile's main colour (`CharacterProfile.color`): it is what Dev
 * Mode's timeline and the `Get Speaker Color` node read for the speaker, and the skeleton's dialogue
 * box paints the name tag with it. Poses exist only on preset characters - a layered character's
 * looks are axes and layers, which this tool does not author, and it says so rather than half-writing
 * them.
 *
 * Comments in English per project convention.
 */

import type { StoryLiteralValue } from "@shared/types/story";
import type { VariableRegistryScope } from "@shared/types/variables/registry";
import { AssetType } from "../../assets/assetTypes";
import { Services } from "../../services";
import type { CharacterService } from "../../core/CharacterService";
import type { Character } from "../../character/Character";
import type { VariableRegistryService } from "../../variables/VariableRegistryService";
import type { AudioTrackService } from "../../audio/AudioTrackService";
import type { AssetsService } from "../../core/AssetsService";
import {
    answerJson,
    readOptionalString,
    readOptionalStringArray,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { assetsService, resolveAsset } from "../agentLookups";
import { blueprintReferencesTo, formatReferrers, storyReferencesTo, uiReferencesTo } from "../agentReferences";
import { liveBlueprintDocument, loadAllStories, uiDocumentService } from "./textFormat";

function describeCharacter(character: Character, assets: AssetsService) {
    const profile = character.profile;
    const appearance = profile.appearance;
    const images = assets.getAssets()[AssetType.Image] ?? {};
    const defaultPoseId = appearance.getDefaultPoseId();
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
    };
}

export const charactersList: AgentToolHandler = async (_args, { ctx }) => {
    const cast = ctx.services.get<CharacterService>(Services.Character);
    const assets = assetsService(ctx);
    return answerJson({ characters: cast.listCharacter().map(character => describeCharacter(character, assets)) });
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

export const characterUpsert: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const id = readOptionalString(args, "id");
    const name = readOptionalString(args, "name");
    const nicknames = readOptionalStringArray(args, "nicknames");
    const nameColor = readOptionalString(args, "nameColor");
    const poses = readPoses(args.poses);
    const defaultPose = readOptionalString(args, "defaultPose");
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
    const current = cast.getCharacter(profile.getId()) ?? character;
    return answerJson(
        { created, character: describeCharacter(current, assetsService(ctx)) },
        `${created ? "Created" : "Updated"} character "${current.profile.getName()}".`,
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

export const variablesList: AgentToolHandler = async (_args, { ctx }) => {
    const registry = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
    return answerJson({
        variables: registry.listEntries().map(entry => ({
            id: entry.id,
            name: entry.name,
            scope: entry.scope,
            valueType: entry.valueType,
            defaultValue: entry.defaultValue ?? null,
            description: entry.description ?? null,
        })),
    });
};

const VALUE_TYPES = ["number", "boolean", "string"] as const;

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

export const variableUpsert: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const name = readString(args, "name");
    const valueType = readString(args, "valueType");
    if (!VALUE_TYPES.includes(valueType as (typeof VALUE_TYPES)[number])) {
        throw refuse("invalid_args", `\`valueType\` must be one of ${VALUE_TYPES.join(", ")}.`);
    }
    const scope = (readOptionalString(args, "scope") ?? "saved") as VariableRegistryScope;
    if (scope !== "saved" && scope !== "persistent") {
        throw refuse("invalid_args", "`scope` must be saved or persistent.");
    }
    const defaultValue = checkDefault(valueType, args.defaultValue);
    follow.describeCall(request.callId, name);

    const registry = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
    const existing = registry.listEntries().filter(entry => entry.name === name);
    if (existing.length > 1) {
        throw refuse("invalid_args", `${existing.length} variables are called "${name}".`);
    }
    const entry = existing[0];
    if (entry) {
        if (entry.scope !== scope) {
            throw refuse("unavailable", `"${name}" already exists as a ${entry.scope} variable.`, "Pick another name, or keep its scope - a variable cannot move between saved and persistent here.");
        }
        if (entry.valueType !== valueType) {
            registry.setEntryValueType(entry.id, valueType as (typeof VALUE_TYPES)[number], defaultValue);
        } else if (defaultValue !== undefined) {
            registry.setEntryDefault(entry.id, defaultValue);
        }
        const updated = registry.getEntry(entry.id) ?? entry;
        return answerJson({ created: false, variable: updated }, `Updated variable "${name}".`);
    }
    const made = registry.createEntry(scope, { name, valueType, defaultValue });
    return answerJson({ created: true, variable: registry.getEntry(made.id) ?? made }, `Created ${scope} variable "${name}".`);
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
