/**
 * A layered character as an agent states it, and the stored appearance it becomes.
 *
 * The model (`@shared/types/character/model`) is axes and layers: an axis is a named choice with
 * tags ("expression": normal / smile / angry), a layer is one slot of the stack, bottom to top, that
 * either always draws one image or follows ONE axis and draws an image (or nothing) per tag of it.
 * One axis may drive several layers - one "angry" moves the brows and the mouth together - which is
 * the whole reason the model exists. This file is the agent's spelling of that, by NAME everywhere,
 * and the pure translation into the stored shape:
 *
 *  - **ids survive by name.** Story rows store tag ids, never names, so restating a character whose
 *    axis "expression" already has a tag "smile" must keep that tag's id or every `/char` row that
 *    chose it would silently fall back to the default. Axes, tags and layers are matched to the
 *    previous appearance by name (case-insensitively) and keep their ids; only new names get new ids.
 *  - **a bound layer names every tag of its axis.** That completeness is the model's invariant (the
 *    engine identifies a tag group by its tag SET, so a layer offering part of an axis would declare
 *    a second, colliding group), and the editor maintains it. Here it is the agent's job, and a
 *    missing entry is refused rather than filled in: `null` - "this layer draws nothing for this tag"
 *    - is a decision ("only the casual outfit has a jacket"), and a guess would hide a typo.
 *  - **a tag name is unique across the character's axes.** A story row names a tag alone
 *    (`/char Mei smile`), and the command line resolves it against every axis at once; two axes with
 *    a tag of one name would make that row mean whichever came first.
 *
 * Also here, because it is the same vocabulary: deriving a spec from a set of image assets named by
 * the convention `<prefix>_<layer>_<tag>` (the names Studio's own PSD import gives the files it
 * bakes), and describing a stored appearance back in these words for `characters_list`.
 *
 * Pure: no services, no pixels. Sizes are measured by the caller.
 *
 * Comments in English per project convention.
 */

import type {
    CharacterAxis,
    CharacterLayer,
    CharacterNamed,
    ICharacterAppearance,
    LayeredAppearance,
} from "../character/types";

export type LayeredAxisSpec = {
    name: string;
    /** In the order an author would list them; the first is the default unless `default` says. */
    tags: string[];
    default?: string;
};

export type LayeredLayerSpec = {
    name: string;
    /** The axis this layer follows; absent or null for a layer that always draws `asset`. */
    axis?: string | null;
    /** A constant layer's image (asset name or id). */
    asset?: string | null;
    /** A bound layer's image per tag of its axis (asset name or id), `null` where it draws nothing. */
    options?: Record<string, string | null>;
};

export type LayeredSpec = {
    axes: LayeredAxisSpec[];
    /** Bottom to top. */
    layers: LayeredLayerSpec[];
};

/** Turn an asset reference into an asset id, or throw an Error whose message says why not. */
export type AssetIdResolver = (ref: string) => string;

export type BuiltLayered = {
    appearance: LayeredAppearance;
    /** Previous tag ids no longer present: story rows that chose one fall back to the default. */
    removedTagIds: string[];
    /** Every asset the stack draws, with where: `"mouth" for smile`, `"body"`. */
    placements: { assetId: string; where: string }[];
};

const fold = (name: string) => name.trim().toLowerCase();

let idSequence = 0;

/**
 * A fresh id for an axis (`x`), tag (`t`) or layer (`l`), shaped like the editor's own: unique within
 * one character, which is all an engine tag has to be.
 */
export function newLayeredId(prefix: "x" | "t" | "l"): string {
    idSequence += 1;
    const salt = Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
    return `${prefix}${idSequence.toString(36)}${salt}`;
}

/** Read `axes` / `layers` from a call's arguments, refusing anything that is not the documented shape. */
export function readLayeredSpec(args: Record<string, unknown>): { spec: LayeredSpec } | { errors: string[] } {
    const errors: string[] = [];
    const axesRaw = args.axes;
    const layersRaw = args.layers;
    if (!Array.isArray(axesRaw)) {
        errors.push("`axes` must be an array of { name, tags, default? }.");
    }
    if (!Array.isArray(layersRaw) || layersRaw.length === 0) {
        errors.push("`layers` must be a non-empty array of { name, axis?, asset?, options? }, bottom to top.");
    }
    if (errors.length > 0) {
        return { errors };
    }
    const axes: LayeredAxisSpec[] = [];
    (axesRaw as unknown[]).forEach((raw, index) => {
        const axis = raw as Partial<LayeredAxisSpec> | null;
        if (!axis || typeof axis !== "object" || typeof axis.name !== "string" || !axis.name.trim()) {
            errors.push(`axes[${index}] needs a \`name\`.`);
            return;
        }
        if (!Array.isArray(axis.tags) || axis.tags.some(tag => typeof tag !== "string" || !tag.trim())) {
            errors.push(`axis "${axis.name}": \`tags\` must be an array of non-empty names.`);
            return;
        }
        if (axis.default !== undefined && axis.default !== null && typeof axis.default !== "string") {
            errors.push(`axis "${axis.name}": \`default\` must be one of its tag names.`);
            return;
        }
        axes.push({
            name: axis.name.trim(),
            tags: axis.tags.map(tag => tag.trim()),
            ...(typeof axis.default === "string" && axis.default.trim() ? { default: axis.default.trim() } : {}),
        });
    });
    const layers: LayeredLayerSpec[] = [];
    (layersRaw as unknown[]).forEach((raw, index) => {
        const layer = raw as Partial<LayeredLayerSpec> | null;
        if (!layer || typeof layer !== "object" || typeof layer.name !== "string" || !layer.name.trim()) {
            errors.push(`layers[${index}] needs a \`name\`.`);
            return;
        }
        if (layer.axis !== undefined && layer.axis !== null && typeof layer.axis !== "string") {
            errors.push(`layer "${layer.name}": \`axis\` must be an axis name or null.`);
            return;
        }
        if (layer.asset !== undefined && layer.asset !== null && typeof layer.asset !== "string") {
            errors.push(`layer "${layer.name}": \`asset\` must be an image asset name or id.`);
            return;
        }
        if (layer.options !== undefined && layer.options !== null) {
            const options = layer.options as unknown;
            if (typeof options !== "object" || Array.isArray(options)
                || Object.values(options as Record<string, unknown>).some(value => value !== null && typeof value !== "string")) {
                errors.push(`layer "${layer.name}": \`options\` must map each tag name to an image asset or null.`);
                return;
            }
        }
        layers.push({
            name: layer.name.trim(),
            axis: typeof layer.axis === "string" && layer.axis.trim() ? layer.axis.trim() : null,
            asset: typeof layer.asset === "string" && layer.asset.trim() ? layer.asset.trim() : null,
            ...(layer.options ? { options: { ...layer.options } } : {}),
        });
    });
    return errors.length > 0 ? { errors } : { spec: { axes, layers } };
}

/** Problems with the spec's own shape that need no project to find. Empty when it is coherent. */
export function checkLayeredSpec(spec: LayeredSpec): string[] {
    const errors: string[] = [];
    const axisByName = new Map<string, LayeredAxisSpec>();
    const tagOwner = new Map<string, string>();
    for (const axis of spec.axes) {
        if (axisByName.has(fold(axis.name))) {
            errors.push(`Two axes are called "${axis.name}".`);
            continue;
        }
        axisByName.set(fold(axis.name), axis);
        if (axis.tags.length === 0) {
            errors.push(`Axis "${axis.name}" has no tags; give it at least one, or leave the axis out.`);
        }
        const seen = new Set<string>();
        for (const tag of axis.tags) {
            if (seen.has(fold(tag))) {
                errors.push(`Axis "${axis.name}" lists the tag "${tag}" twice.`);
                continue;
            }
            seen.add(fold(tag));
            const owner = tagOwner.get(fold(tag));
            if (owner !== undefined) {
                errors.push(
                    `The tag "${tag}" is on both axis "${owner}" and axis "${axis.name}". A story row names a tag alone `
                    + `(\`/char <character> ${tag}\`), so a tag name must be unique across the character's axes - rename one.`,
                );
                continue;
            }
            tagOwner.set(fold(tag), axis.name);
        }
        if (axis.default !== undefined && !axis.tags.some(tag => fold(tag) === fold(axis.default!))) {
            errors.push(`Axis "${axis.name}": default "${axis.default}" is not one of its tags (${axis.tags.join(", ")}).`);
        }
    }

    const layerNames = new Set<string>();
    const usedAxes = new Set<string>();
    for (const layer of spec.layers) {
        if (layerNames.has(fold(layer.name))) {
            errors.push(`Two layers are called "${layer.name}".`);
            continue;
        }
        layerNames.add(fold(layer.name));
        if (!layer.axis) {
            if (layer.options && Object.keys(layer.options).length > 0) {
                errors.push(`Layer "${layer.name}" has \`options\` but no \`axis\`; name the axis it follows, or give one \`asset\`.`);
            } else if (!layer.asset) {
                errors.push(`Layer "${layer.name}" draws nothing: a layer without an axis needs an \`asset\`.`);
            }
            continue;
        }
        const axis = axisByName.get(fold(layer.axis));
        if (!axis) {
            errors.push(`Layer "${layer.name}" follows axis "${layer.axis}", which is not in \`axes\`.`);
            continue;
        }
        usedAxes.add(fold(axis.name));
        if (layer.asset) {
            errors.push(`Layer "${layer.name}" follows axis "${axis.name}", so it takes \`options\` per tag, not one \`asset\`.`);
            continue;
        }
        const given = Object.keys(layer.options ?? {});
        const unknown = given.filter(key => !axis.tags.some(tag => fold(tag) === fold(key)));
        const missing = axis.tags.filter(tag => !given.some(key => fold(key) === fold(tag)));
        if (unknown.length > 0) {
            errors.push(`Layer "${layer.name}": ${unknown.map(name => `"${name}"`).join(", ")} ${unknown.length === 1 ? "is not a tag" : "are not tags"} of axis "${axis.name}" (${axis.tags.join(", ")}).`);
        }
        if (missing.length > 0) {
            errors.push(
                `Layer "${layer.name}" does not say what it draws for ${missing.map(name => `"${name}"`).join(", ")} of axis "${axis.name}". `
                + "Every tag of the axis needs an entry: an image, or null where this layer draws nothing for that tag.",
            );
        }
        if (unknown.length === 0 && missing.length === 0 && Object.values(layer.options ?? {}).every(value => !value)) {
            errors.push(`Layer "${layer.name}" draws nothing for any tag of "${axis.name}"; give at least one image, or remove the layer.`);
        }
    }
    for (const axis of spec.axes) {
        if (!usedAxes.has(fold(axis.name)) && axis.tags.length > 0) {
            errors.push(`Axis "${axis.name}" drives no layer; bind a layer to it (\`axis: "${axis.name}"\`) or leave it out.`);
        }
    }
    return errors;
}

/**
 * The stored appearance a spec describes, keeping every id the previous layered appearance had for a
 * name that is still there. Fields the spec does not speak to - snapshots, the PSD fingerprint, the
 * avatar table, which axes the avatar varies with - are carried over (the last two cut to what still
 * exists), so restating a stack never throws away the author's editor-side work.
 *
 * Throws nothing: problems with the spec come back from {@link checkLayeredSpec} first, and asset
 * references that do not resolve are collected into `errors`.
 */
export function buildLayeredAppearance(
    previous: ICharacterAppearance | null,
    spec: LayeredSpec,
    resolveAssetId: AssetIdResolver,
    canvas: { width: number; height: number } | null,
    makeId: (prefix: "x" | "t" | "l") => string = newLayeredId,
): { built: BuiltLayered } | { errors: string[] } {
    const errors: string[] = [];
    const before = previous?.kind === "layered" ? previous : null;
    const previousAxes = before?.axes ?? [];
    const previousLayers = before?.layers ?? [];
    const takenAxisIds = new Set<string>();
    const takenLayerIds = new Set<string>();

    const axes: CharacterAxis[] = spec.axes.map(axisSpec => {
        const old = previousAxes.find(axis => fold(axis.name) === fold(axisSpec.name) && !takenAxisIds.has(axis.id));
        const id = old?.id ?? makeId("x");
        takenAxisIds.add(id);
        const tags: CharacterNamed[] = axisSpec.tags.map(name => {
            const oldTag = old?.tags.find(tag => fold(tag.name) === fold(name));
            return { id: oldTag?.id ?? makeId("t"), name };
        });
        const wanted = axisSpec.default
            ?? old?.tags.find(tag => tag.id === old.defaultTagId)?.name
            ?? axisSpec.tags[0];
        const defaultTag = tags.find(tag => fold(tag.name) === fold(wanted ?? "")) ?? tags[0];
        return { id, name: axisSpec.name, tags, defaultTagId: defaultTag?.id ?? null };
    });

    const placements: BuiltLayered["placements"] = [];
    const resolve = (ref: string, where: string): string | null => {
        try {
            const assetId = resolveAssetId(ref);
            placements.push({ assetId, where });
            return assetId;
        } catch (error) {
            errors.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };

    const layers: CharacterLayer[] = spec.layers.map(layerSpec => {
        const old = previousLayers.find(layer => fold(layer.name) === fold(layerSpec.name) && !takenLayerIds.has(layer.id));
        const id = old?.id ?? makeId("l");
        takenLayerIds.add(id);
        if (!layerSpec.axis) {
            return { id, name: layerSpec.name, axisId: null, assetId: resolve(layerSpec.asset ?? "", `layer "${layerSpec.name}"`) };
        }
        const axis = axes.find(candidate => fold(candidate.name) === fold(layerSpec.axis!))!;
        const options: Record<string, string | null> = {};
        for (const tag of axis.tags) {
            const key = Object.keys(layerSpec.options ?? {}).find(name => fold(name) === fold(tag.name));
            const ref = key !== undefined ? layerSpec.options![key] : null;
            options[tag.id] = ref ? resolve(ref, `layer "${layerSpec.name}" for ${tag.name}`) : null;
        }
        return { id, name: layerSpec.name, axisId: axis.id, assetId: null, options };
    });

    if (errors.length > 0) {
        return { errors };
    }

    const liveTagIds = new Set(axes.flatMap(axis => axis.tags.map(tag => tag.id)));
    const removedTagIds = previousAxes.flatMap(axis => axis.tags.map(tag => tag.id)).filter(id => !liveTagIds.has(id));
    const liveAxisIds = new Set(axes.map(axis => axis.id));

    const appearance: LayeredAppearance = {
        kind: "layered",
        canvas: canvas ? { ...canvas } : before?.canvas ?? null,
        axes,
        layers,
        snapshots: before?.snapshots ?? [],
        ...(before?.psd ? { psd: before.psd } : {}),
        ...(before?.avatarAxisIds ? { avatarAxisIds: before.avatarAxisIds.filter(id => liveAxisIds.has(id)) } : {}),
        ...(before?.avatars ? { avatars: before.avatars } : {}),
    };
    return { built: { appearance, removedTagIds, placements } };
}

// ── Naming convention ────────────────────────────────────────────────────────────────────────────

export type NamedImage = { id: string; name: string };

export type ConventionOptions = {
    /** What every file name starts with, before the first `_`: usually the character's name. */
    prefix: string;
    /** Layer names bottom to top. Required once more than one layer is found. */
    order?: string[];
    /** Axis name -> the layers it drives. A varying layer not listed gets an axis of its own name. */
    axes?: Record<string, string[]>;
    /** Axis name -> default tag. */
    defaults?: Record<string, string>;
};

/** The default an axis falls back to when none is named: a neutral-sounding tag, else the first. */
const NEUTRAL_TAGS = ["normal", "default", "neutral", "base"];

function stripExt(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The layered spec a set of images describes by their names: `<prefix>_<layer>` is a layer that
 * always draws, `<prefix>_<layer>_<tag>` is one tag of a varying layer. The layer is everything up
 * to the first `_` after the prefix, so a layer name must not contain `_` (`back-hair`, not
 * `back_hair`); a tag may.
 *
 * Images whose name does not start with the prefix are ignored and listed, never guessed at. The
 * stack order cannot be read off file names, so it must be stated once there is more than one
 * layer; the refusal lists the layers found so the caller can.
 */
export function layeredSpecFromNames(
    images: readonly NamedImage[],
    options: ConventionOptions,
): { spec: LayeredSpec; ignored: string[]; layersFound: string[] } | { errors: string[]; layersFound: string[]; ignored: string[] } {
    const prefix = fold(options.prefix);
    const ignored: string[] = [];
    type Found = { name: string; constant: string | null; constantCount: number; tags: { tag: string; assetId: string }[] };
    const found = new Map<string, Found>();
    const errors: string[] = [];
    for (const image of images) {
        const base = stripExt(image.name);
        if (!fold(base).startsWith(`${prefix}_`)) {
            ignored.push(image.name);
            continue;
        }
        const rest = base.slice(options.prefix.trim().length + 1);
        const cut = rest.indexOf("_");
        const layer = (cut === -1 ? rest : rest.slice(0, cut)).trim();
        const tag = cut === -1 ? null : rest.slice(cut + 1).trim();
        if (!layer || tag === "") {
            ignored.push(image.name);
            continue;
        }
        const entry = found.get(fold(layer)) ?? { name: layer, constant: null, constantCount: 0, tags: [] };
        if (tag === null) {
            entry.constant = image.id;
            entry.constantCount += 1;
        } else if (entry.tags.some(existing => fold(existing.tag) === fold(tag))) {
            errors.push(`Two images give layer "${layer}" the tag "${tag}".`);
        } else {
            entry.tags.push({ tag, assetId: image.id });
        }
        found.set(fold(layer), entry);
    }
    const layersFound = [...found.values()].map(entry => entry.name);
    if (found.size === 0) {
        return {
            errors: [`No image is named "${options.prefix}_<layer>" or "${options.prefix}_<layer>_<tag>".`],
            layersFound,
            ignored,
        };
    }
    for (const entry of found.values()) {
        if (entry.constant && entry.tags.length > 0) {
            errors.push(`Layer "${entry.name}" has both a fixed image ("${options.prefix}_${entry.name}") and tagged ones; keep one form.`);
        }
        if (entry.constantCount > 1) {
            errors.push(`Two images are named "${options.prefix}_${entry.name}".`);
        }
    }

    // Which axis drives which layer.
    const axisOfLayer = new Map<string, string>();
    for (const [axisName, members] of Object.entries(options.axes ?? {})) {
        for (const member of members) {
            const entry = found.get(fold(member));
            if (!entry) {
                errors.push(`\`axes\`: axis "${axisName}" names layer "${member}", which no image provides (found: ${layersFound.join(", ")}).`);
                continue;
            }
            if (entry.tags.length === 0) {
                errors.push(`\`axes\`: layer "${member}" has one fixed image, so it follows no axis.`);
                continue;
            }
            const other = axisOfLayer.get(fold(member));
            if (other !== undefined && fold(other) !== fold(axisName)) {
                errors.push(`\`axes\`: layer "${member}" is listed under both "${other}" and "${axisName}".`);
                continue;
            }
            axisOfLayer.set(fold(member), axisName.trim());
        }
    }
    for (const entry of found.values()) {
        if (entry.tags.length > 0 && !axisOfLayer.has(fold(entry.name))) {
            axisOfLayer.set(fold(entry.name), entry.name);
        }
    }

    // Stack order.
    let ordered: Found[];
    if (options.order && options.order.length > 0) {
        const missing = layersFound.filter(name => !options.order!.some(item => fold(item) === fold(name)));
        const unknown = options.order.filter(item => !found.has(fold(item)));
        if (missing.length > 0) {
            errors.push(`\`order\` leaves out ${missing.map(name => `"${name}"`).join(", ")}; list every layer, bottom to top.`);
        }
        if (unknown.length > 0) {
            errors.push(`\`order\` names ${unknown.map(name => `"${name}"`).join(", ")}, which no image provides.`);
        }
        ordered = options.order.filter(item => found.has(fold(item))).map(item => found.get(fold(item))!);
    } else if (found.size === 1) {
        ordered = [...found.values()];
    } else {
        errors.push(`Found ${found.size} layers (${layersFound.join(", ")}). Their stacking cannot be read off file names: pass \`order\`, bottom to top.`);
        ordered = [];
    }
    if (errors.length > 0) {
        return { errors, layersFound, ignored };
    }

    // Axes: the union of their layers' tags, in the order the images first named them.
    const axisTags = new Map<string, { name: string; tags: string[] }>();
    for (const entry of ordered) {
        const axisName = axisOfLayer.get(fold(entry.name));
        if (!axisName) {
            continue;
        }
        const axis = axisTags.get(fold(axisName)) ?? { name: axisName, tags: [] };
        for (const { tag } of entry.tags) {
            if (!axis.tags.some(existing => fold(existing) === fold(tag))) {
                axis.tags.push(tag);
            }
        }
        axisTags.set(fold(axisName), axis);
    }
    const defaults = Object.fromEntries(Object.entries(options.defaults ?? {}).map(([axis, tag]) => [fold(axis), tag]));
    const axes: LayeredAxisSpec[] = [...axisTags.values()].map(axis => {
        const stated = defaults[fold(axis.name)];
        const neutral = axis.tags.find(tag => NEUTRAL_TAGS.includes(fold(tag)));
        const chosen = stated ?? neutral;
        return { name: axis.name, tags: axis.tags, ...(chosen ? { default: chosen } : {}) };
    });
    for (const axisName of Object.keys(options.defaults ?? {})) {
        if (!axisTags.has(fold(axisName))) {
            errors.push(`\`defaults\` names axis "${axisName}", which is not one of ${axes.map(axis => `"${axis.name}"`).join(", ") || "(none)"}.`);
        }
    }
    if (errors.length > 0) {
        return { errors, layersFound, ignored };
    }

    const layers: LayeredLayerSpec[] = ordered.map(entry => {
        const axisName = axisOfLayer.get(fold(entry.name));
        if (!axisName) {
            return { name: entry.name, axis: null, asset: entry.constant };
        }
        const axis = axisTags.get(fold(axisName))!;
        // A tag of the axis this layer has no image for reads as "draws nothing for that tag" - the
        // jacket that only the casual outfit has. A bound layer has no "keep what was there": it
        // draws its tag's image or none, so `null` is the only reading the files support. The answer
        // lists these gaps, and a layer empty under every tag is refused by `checkLayeredSpec`.
        const optionsByTag: Record<string, string | null> = {};
        for (const tag of axis.tags) {
            optionsByTag[tag] = entry.tags.find(item => fold(item.tag) === fold(tag))?.assetId ?? null;
        }
        return { name: entry.name, axis: axisName, options: optionsByTag };
    });
    return { spec: { axes, layers }, ignored, layersFound };
}

// ── Describing ───────────────────────────────────────────────────────────────────────────────────

/** A stored layered appearance in the words `character_layered_set` takes, so it can be edited and sent back. */
export function describeLayered(appearance: LayeredAppearance, assetName: (assetId: string) => string | null) {
    const name = (assetId: string | null | undefined) => (assetId ? assetName(assetId) ?? assetId : null);
    return {
        canvas: appearance.canvas ?? null,
        axes: appearance.axes.map(axis => ({
            name: axis.name,
            tags: axis.tags.map(tag => tag.name),
            default: axis.tags.find(tag => tag.id === axis.defaultTagId)?.name ?? axis.tags[0]?.name ?? null,
        })),
        layers: appearance.layers.map(layer => {
            const axis = layer.axisId ? appearance.axes.find(candidate => candidate.id === layer.axisId) : undefined;
            if (!axis) {
                return { name: layer.name, axis: null, asset: name(layer.assetId) };
            }
            return {
                name: layer.name,
                axis: axis.name,
                options: Object.fromEntries(axis.tags.map(tag => [tag.name, name(layer.options?.[tag.id])])),
            };
        }),
    };
}

/**
 * A tag selection by name (`{ expression: "smile" }`, or a bare tag list `["smile", "casual"]`) as
 * the stored id selection, or the names it could not place.
 */
export function selectionByName(
    appearance: LayeredAppearance,
    wanted: Record<string, string> | readonly string[],
): { tags: Record<string, string> } | { errors: string[] } {
    const errors: string[] = [];
    const tags: Record<string, string> = {};
    const entries: [string | null, string][] = Array.isArray(wanted)
        ? (wanted as readonly string[]).map(tag => [null, tag])
        : Object.entries(wanted as Record<string, string>);
    for (const [axisName, tagName] of entries) {
        const axes = axisName === null
            ? appearance.axes
            : appearance.axes.filter(axis => fold(axis.name) === fold(axisName));
        if (axisName !== null && axes.length === 0) {
            errors.push(`No axis "${axisName}" (axes: ${appearance.axes.map(axis => axis.name).join(", ")}).`);
            continue;
        }
        const hit = axes.flatMap(axis => axis.tags.filter(tag => fold(tag.name) === fold(tagName)).map(tag => ({ axis, tag })))[0];
        if (!hit) {
            errors.push(`No tag "${tagName}"${axisName !== null ? ` on axis "${axisName}"` : ""}.`);
            continue;
        }
        tags[hit.axis.id] = hit.tag.id;
    }
    return errors.length > 0 ? { errors } : { tags };
}
