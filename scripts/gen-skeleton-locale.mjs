// Builds the skeleton project template's content as it reads in another language.
//
// The skeleton is authored once, in English (`resources/templates/skeleton/content/`), and the
// wizard hands an author writing in Chinese or Japanese a project authored in that language instead
// — story, screens, layer names and all. Those trees are `content.zh/` and `content.ja/`, and this
// script is what produces them, so a variant can never become a second project: everything
// structural (ids, layouts, blueprints, assets) is copied from the English tree unchanged, and the
// only thing that differs is the words.
//
// Two sources of words per variant, and neither is invented here:
//   - the story, the character names and the named keys come from the template's OWN translation
//     file for that language (`editor/localization/zh-CN.json`, `ja.json`), promoted into the
//     source text;
//   - everything the localization system never covered - button labels, screen text, confirm
//     dialogs, element and blueprint names - comes from that variant's table beside this script.
//
// The English text becomes `editor/localization/en.json`, so a project made in Chinese ships an
// English translation exactly as one made in English ships a Chinese one, and the other languages'
// files are carried over with their source hashes recomputed against the new source text.
//
// Regenerate after editing the English skeleton:  node scripts/gen-skeleton-locale.mjs
// Verify the committed trees match:               node scripts/gen-skeleton-locale.mjs --check
// List every word the blueprints show, as JSON:   node scripts/gen-skeleton-locale.mjs --graph-text
//
// Three things fail the run, and each is named, so English cannot leak into a variant by being
// forgotten:
//   - a string in a translatable place that the table has no entry for;
//   - a table entry nothing asked for. That is how a part of the content the generator has stopped
//     reading shows up: the blueprints moved from `blueprint.program.graphs` to `blueprint.graphs`,
//     and every layer name, function name and on-screen literal in them went on shipping in English
//     for as long as the generator went on looking in the old place - while their entries sat in
//     both tables, looked up by nothing;
//   - in the blueprint document, a string somewhere this script has not been told about (below).
//
// What a blueprint says, and what it only stores
//
// The blueprint document (`editor/ui/uigraphs.json`) is walked field by field against a
// description of its shape, and every string in it has to land somewhere that description names. A
// field it does not name that holds a string fails the run, rather than being copied as it is: a
// new node, a new field on a layer, or the graphs moving again then needs a decision, instead of
// being English nobody noticed. Every blueprint is walked the same way whatever owns it - the
// global one, surfaces, widgets, component definitions, value bindings, story actions.
//
// Translated (through the table): the names an author navigates by - a blueprint's, each layer's,
// each member variable, field and function's, a `Fn` head's and its pins' - and the words a node
// puts in front of someone: text a node writes on screen (`Set Text`), what a confirm dialog asks
// and its answers, what `Log` prints to the author.
//
// Never translated: anything the code looks up, compares or parses. Ids and references of every
// kind (elements, surfaces, assets, variables, stories, functions), localization keys, input action
// ids, broadcast event names, JSON paths and field names, enum values (`enter`, `cg`, `true`), the
// operand of a string comparison, and a date pattern: `YYYY/MM/DD HH:mm` is read by `Format Time`,
// not by a player, and it is the same pattern in all three languages.
//
// Decided by where it goes: a string literal node, and a literal typed into `Concat`, is whatever
// the pin its value reaches is - text if every pin it feeds is text, left alone if every one is
// something the code reads. A value graph's `Return Value` is text when the property it binds is
// a widget's `text` or `label`, or when it is a story's inline value. A literal that reaches one of
// each is left as it is and printed as ambiguous on every run; the fix for one is in the English
// content (a literal per use), not here.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(HERE, "../resources/templates/skeleton");
const TABLES = ["zh", "ja"];

const TEXT = "text";
const VERBATIM = "verbatim";
/** The class of whatever this node's output is wired into. */
const FEEDS = "feeds";
/** A value graph's result: the class of the property or story slot the blueprint binds. */
const RETURN = "return";
/** A literal whose uses disagree: left as it is, and printed. */
const AMBIGUOUS = "ambiguous";

/**
 * What each node param holds, by node type and param key. A literal typed into a data pin is stored
 * as a param under the pin's id, so the same entry answers for a literal typed into the pin and for a
 * literal node wired into it.
 *
 * Only strings need an entry, and only strings that are not empty. A string in a param with no
 * entry fails the run: add the param here, as text or as verbatim, once you know which it is.
 */
const NODE_PARAM_SLOTS = [
    ["blueprint.app.setFullscreen", "mode", VERBATIM],
    ["blueprint.collection.arrayFind", "key", VERBATIM],
    ["blueprint.component.getParam", "paramId", VERBATIM],
    ["blueprint.data.booleanLiteral", "value", VERBATIM],
    ["blueprint.data.jsonGet", "path", VERBATIM],
    ["blueprint.data.jsonMakeObject", /^field_\d+_name$/, VERBATIM],
    ["blueprint.data.returnValue", "value", RETURN],
    ["blueprint.data.stringLiteral", "value", FEEDS],
    ["blueprint.element.displayable.getProperty", "property", VERBATIM],
    ["blueprint.element.displayable.setProperty", "property", VERBATIM],
    ["blueprint.element.displayable.setVariant", "variantId", VERBATIM],
    ["blueprint.element.ref", "elementId", VERBATIM],
    ["blueprint.element.ref", "elementType", VERBATIM],
    ["blueprint.element.ref", "surfaceId", VERBATIM],
    ["blueprint.element.text.setText", "text", TEXT],
    ["blueprint.event.head.action", "actionId", VERBATIM],
    ["blueprint.event.head.onBroadcast", "event", VERBATIM],
    ["blueprint.fn.call", "fnRef", VERBATIM],
    ["blueprint.fn.head", "name", TEXT],
    ["blueprint.game.getTrackVolume", "audioTrackId", VERBATIM],
    ["blueprint.game.isSceneVisited", "storyId", VERBATIM],
    ["blueprint.game.isSceneVisited", "sceneId", VERBATIM],
    ["blueprint.game.quit", "surfaceId", VERBATIM],
    ["blueprint.game.setTrackVolume", "audioTrackId", VERBATIM],
    ["blueprint.game.startStory", "sceneId", VERBATIM],
    ["blueprint.game.startStory", "storyId", VERBATIM],
    ["blueprint.layer.confirm", "message", TEXT],
    ["blueprint.layer.confirm", /^button_\d+_label$/, TEXT],
    ["blueprint.layer.confirm", "surfaceId", VERBATIM],
    ["blueprint.list.getItemField", "field", VERBATIM],
    ["blueprint.local.get", "variableId", VERBATIM],
    ["blueprint.local.set", "variableId", VERBATIM],
    ["blueprint.localization.getText", "key", VERBATIM],
    ["blueprint.log", "value", TEXT],
    ["blueprint.page.go", "surfaceId", VERBATIM],
    ["blueprint.persistent.get", "persistentVariableId", VERBATIM],
    ["blueprint.sound.play", "audioTrackId", VERBATIM],
    ["blueprint.sound.play", "soundAssetId", VERBATIM],
    ["blueprint.string.concat", /^(a|b|in_\d+)$/, FEEDS],
    ["blueprint.string.equals", /^(a|b)$/, VERBATIM],
    ["blueprint.time.format", "pattern", VERBATIM],
    ["narraleaf.gallery.getEntries", "galleryKind", VERBATIM],
    ["narraleaf.gallery.getStats", "galleryKind", VERBATIM],
];

/** Bookkeeping params any node may carry: lists of the pin ids it grew, and their value types. */
const SHARED_PARAM_SLOTS = [
    [/^__\w+(Pins|PinIds|PinTypes)$/, VERBATIM],
    ["__variableValueType", VERBATIM],
];

function nodeParamSlot(nodeType, key) {
    const matches = pattern => (typeof pattern === "string" ? pattern === key : pattern.test(key));
    for (const [type, pattern, slot] of NODE_PARAM_SLOTS) {
        if (type === nodeType && matches(pattern)) {
            return slot;
        }
    }
    for (const [pattern, slot] of SHARED_PARAM_SLOTS) {
        if (matches(pattern)) {
            return slot;
        }
    }
    return undefined;
}

/** What a value graph's result is, from what its blueprint is bound to. */
function returnSlot(owner) {
    if (owner?.kind === "widgetValue") {
        return owner.propPath === "text" || owner.propPath === "label" ? TEXT : VERBATIM;
    }
    if (owner?.kind === "storyAction") {
        return owner.mode === "value" ? TEXT : VERBATIM;
    }
    return AMBIGUOUS;
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True when a string anyone could read is somewhere inside `value`. */
function holdsText(value) {
    if (typeof value === "string") {
        return value !== "";
    }
    if (value && typeof value === "object") {
        return Object.values(value).some(holdsText);
    }
    return false;
}

/**
 * Translates the blueprint document in place, and accounts for every string in it.
 *
 * Returns the places a word was translated (`slots`, as JSON-pointer paths with the English they
 * held), the places nothing here describes that hold a string (`unclassified`, each with one
 * blueprint and layer it was seen in), and the literals whose uses disagree (`ambiguous`).
 */
function translateBlueprintDocument(file, say) {
    const slots = [];
    const unclassified = new Map();
    const ambiguous = [];

    const unknown = (label, ctx) => {
        if (!unclassified.has(label)) {
            unclassified.set(label, ctx.seenIn ?? "");
        }
    };
    const child = (ctx, key, parent, label = key) => ({
        ...ctx,
        pointer: [...ctx.pointer, key],
        parent,
        key,
        where: `${ctx.where}.${label}`,
    });

    const verbatim = () => {};
    const word = (value, ctx) => {
        if (typeof value === "string") {
            if (value !== "") {
                slots.push({ pointer: ctx.pointer, source: value });
                ctx.parent[ctx.key] = say(value);
            }
        } else if (holdsText(value)) {
            unknown(ctx.where, ctx);
        }
    };
    /** A record whose keys are known: each one handled as given, and text under any other fails. */
    const shape = handlers => (value, ctx) => {
        if (!isRecord(value)) {
            if (holdsText(value)) {
                unknown(ctx.where, ctx);
            }
            return;
        }
        for (const [key, entry] of Object.entries(value)) {
            const handler = Object.prototype.hasOwnProperty.call(handlers, key) ? handlers[key] : undefined;
            if (handler) {
                handler(entry, child(ctx, key, value));
            } else if (holdsText(entry)) {
                unknown(`${ctx.where}.${key}`, ctx);
            }
        }
    };
    /** A map keyed by id, or a list: every entry handled the same way. */
    const eachOf = handler => (value, ctx) => {
        if (!value || typeof value !== "object") {
            if (holdsText(value)) {
                unknown(ctx.where, ctx);
            }
            return;
        }
        for (const [key, entry] of Object.entries(value)) {
            handler(entry, child(ctx, Array.isArray(value) ? Number(key) : key, value, "*"));
        }
    };

    // The class of whatever a node's output reaches, following `Concat` through to its own uses.
    const feedsSlot = (graph, nodeId, ctx, seen = new Set()) => {
        if (seen.has(nodeId)) {
            return AMBIGUOUS;
        }
        seen.add(nodeId);
        const found = new Set();
        for (const edge of graph.edges ?? []) {
            if (edge?.from?.nodeId !== nodeId) {
                continue;
            }
            const consumer = graph.nodes?.[edge.to?.nodeId];
            let slot = consumer ? nodeParamSlot(consumer.type, edge.to.port) : undefined;
            if (slot === FEEDS) {
                slot = feedsSlot(graph, consumer.id, ctx, seen);
            } else if (slot === RETURN) {
                slot = returnSlot(ctx.owner);
            } else if (slot === undefined) {
                unknown(`node pin ${consumer?.type ?? "(missing node)"}:${edge.to?.port} (fed a string)`, ctx);
                slot = AMBIGUOUS;
            }
            found.add(slot);
        }
        if (found.size === 0) {
            // Wired into nothing, so read by nothing.
            return VERBATIM;
        }
        return found.size === 1 ? [...found][0] : AMBIGUOUS;
    };

    const pinList = eachOf(shape({ pinId: verbatim, name: word, valueType: verbatim }));
    const params = (graph, node) => (value, ctx) => {
        if (!isRecord(value)) {
            if (holdsText(value)) {
                unknown(ctx.where, ctx);
            }
            return;
        }
        for (const [key, entry] of Object.entries(value)) {
            const paramCtx = child(ctx, key, value);
            // A Call Fn node carries a copy of the function's signature so it can draw its pins
            // without reading the document, and the editor calls the call stale the moment the copy
            // and the head disagree - so the copy is translated exactly as the head is.
            if (key === "__fnSignatureSnapshot") {
                shape({ name: word, params: pinList, returns: pinList })(entry, paramCtx);
                continue;
            }
            if (key === "__fnParamPinLabels" || key === "__fnReturnPinLabels") {
                eachOf(word)(entry, paramCtx);
                continue;
            }
            if (!holdsText(entry)) {
                continue;
            }
            let slot = nodeParamSlot(node.type, key);
            if (slot === FEEDS) {
                slot = feedsSlot(graph, node.id, ctx);
            } else if (slot === RETURN) {
                slot = returnSlot(ctx.owner);
            }
            if (slot === undefined) {
                unknown(`node param ${node.type}:${key}`, ctx);
            } else if (slot === TEXT) {
                word(entry, paramCtx);
            } else if (slot === AMBIGUOUS) {
                ambiguous.push({ where: `${node.type}:${key}`, seenIn: ctx.seenIn, value: entry });
            }
        }
    };
    const graph = (value, ctx) => {
        shape({
            nodes: eachOf((node, nodeCtx) => shape({
                id: verbatim,
                type: verbatim,
                params: params(value, node),
                meta: shape({ editorLayout: verbatim }),
                // Written by the packager, never under `editor/`; asset ids either way.
                assetVariants: verbatim,
            })(node, nodeCtx)),
            edges: verbatim,
            meta: shape({ graphKind: verbatim }),
        })(value, ctx);
    };
    const layer = (value, ctx) => shape({
        id: verbatim,
        name: word,
        graph,
        // A path under `scripts/`, and what the compiler last said about it.
        script: verbatim,
        meta: shape({}),
    })(value, { ...ctx, seenIn: `${ctx.seenIn} / ${isRecord(value) ? value.name ?? value.id : "?"}` });
    const blueprint = (value, ctx) => shape({
        id: verbatim,
        name: word,
        owner: verbatim,
        members: shape({
            variables: eachOf(shape({ id: verbatim, name: word, valueType: verbatim, meta: shape({}) })),
            fields: eachOf(shape({
                id: verbatim,
                name: word,
                kind: verbatim,
                valueSource: verbatim,
                meta: shape({}),
            })),
            functions: eachOf(shape({
                id: verbatim,
                name: word,
                parameters: eachOf(shape({ name: word, valueType: verbatim })),
                returnType: verbatim,
                meta: shape({}),
            })),
        }),
        // Which prop is bound to which field; a `fallback` shown in its place is not described yet.
        bindings: eachOf(shape({
            id: verbatim,
            target: verbatim,
            source: verbatim,
            mode: verbatim,
            status: verbatim,
            brokenReason: verbatim,
        })),
        graphs: shape({
            eventIds: verbatim,
            events: eachOf(layer),
            functionIds: verbatim,
            functions: eachOf(layer),
            macros: eachOf(layer),
        }),
        meta: shape({ valueType: verbatim }),
    })(value, {
        ...ctx,
        owner: isRecord(value) ? value.owner : undefined,
        seenIn: `blueprint ${JSON.stringify(isRecord(value) ? value.name : "?")}`,
    });

    shape({
        schemaVersion: verbatim,
        meta: verbatim,
        blueprintDocument: shape({
            schemaVersion: verbatim,
            meta: verbatim,
            ownerRecords: verbatim,
            blueprints: eachOf(blueprint),
        }),
    })(file, { pointer: [], where: "uigraphs.json", parent: null, key: null });

    return { slots, unclassified, ambiguous };
}

/** FNV-1a over UTF-16 code units — the same hash `shared/utils/localizationText` stamps units with. */
function hashSourceText(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function readJson(file) {
    const raw = readFileSync(file, "utf-8");
    return { value: JSON.parse(raw), trailingNewline: raw.endsWith("\n") };
}

/** Every file here is `JSON.stringify(value, null, 2)`, which is how Studio itself writes them. */
function serialize(value, trailingNewline) {
    return JSON.stringify(value, null, 2) + (trailingNewline ? "\n" : "");
}

function buildVariant(locale) {
    const table = JSON.parse(readFileSync(join(HERE, `gen-skeleton-locale.${locale}.json`), "utf-8"));
    const contentDir = join(TEMPLATE_DIR, "content");
    const strings = table.strings;
    const missing = new Set();
    const asked = new Set();

    /** The table's word for an authored one; a string it does not know is reported, never guessed. */
    const say = text => {
        if (typeof text !== "string" || text === "") {
            return text;
        }
        asked.add(text);
        if (!Object.prototype.hasOwnProperty.call(strings, text)) {
            missing.add(text);
            return text;
        }
        return strings[text];
    };

    const files = [];
    const emit = (relativePath, value, trailingNewline) => {
        files.push({ path: relativePath, content: serialize(value, trailingNewline) });
    };

    // --- The interface: names, labels, screen text, the placeholder rows of list previews.
    const uidocPath = "editor/ui/uidoc.json";
    const uidoc = readJson(join(contentDir, uidocPath));
    const translateElement = element => {
        element.name = say(element.name);
        const props = element.props ?? {};
        for (const key of ["text", "label"]) {
            if (typeof props[key] === "string") {
                props[key] = say(props[key]);
            }
        }
        // A list draws `items` when no graph has written any, so those rows are what an author
        // sees on the canvas and what the choice list shows until the game runs. They are text
        // through and through - the line, the name above it, the body of a notification - so every
        // string in one goes through the table, discriminators (`type: "say"`) and row ids
        // included: a field added later then shows up as a missing entry rather than as English
        // nobody noticed.
        for (const item of props.items ?? []) {
            for (const [key, value] of Object.entries(item ?? {})) {
                if (typeof value === "string") {
                    item[key] = say(value);
                }
            }
        }
        for (const variant of props.appearance?.variants ?? []) {
            variant.name = say(variant.name);
        }
    };
    uidoc.value.name = say(uidoc.value.name);
    for (const surface of uidoc.value.surfaces ?? []) {
        surface.name = say(surface.name);
    }
    // The project's input vocabulary. Only the name: an id is what a surface and a head store, and
    // translating one would leave every reference to it pointing at nothing.
    for (const action of Object.values(uidoc.value.actions ?? {})) {
        action.name = say(action.name);
    }
    for (const component of uidoc.value.components ?? []) {
        component.name = say(component.name);
        for (const element of Object.values(component.elements ?? {})) {
            translateElement(element);
        }
    }
    for (const element of Object.values(uidoc.value.elements ?? {})) {
        translateElement(element);
    }
    emit(uidocPath, uidoc.value, uidoc.trailingNewline);

    // --- The blueprints: the names an author navigates by, and the words their nodes show. Every
    // string in the document is accounted for; see "What a blueprint says" at the top.
    const graphsPath = "editor/ui/uigraphs.json";
    const graphs = readJson(join(contentDir, graphsPath));
    const blueprintText = translateBlueprintDocument(graphs.value, say);
    emit(graphsPath, graphs.value, graphs.trailingNewline);

    // --- The story: its own translation, promoted into the text the author edits.
    const translationsPath = `editor/localization/${table.translations}.json`;
    const translations = readJson(join(contentDir, translationsPath)).value;
    const unitTarget = unitId => {
        const unit = translations.units?.[unitId];
        if (!unit || typeof unit.target !== "string" || unit.target === "") {
            throw new Error(`${translationsPath} has no translation for unit ${unitId}`);
        }
        return unit.target;
    };
    /** Source text before and after, per unit: what the English translation file is made of. */
    const flipped = new Map();

    const storyIndexPath = "editor/story/index.json";
    const storyIndex = readJson(join(contentDir, storyIndexPath));
    for (const story of storyIndex.value.stories ?? []) {
        story.name = say(story.name);
    }
    emit(storyIndexPath, storyIndex.value, storyIndex.trailingNewline);

    // Names above, documents below; `documentPath` is untouched by either.
    for (const story of storyIndex.value.stories ?? []) {
        const documentPath = story.documentPath;
        const document = readJson(join(contentDir, documentPath));
        document.value.name = say(document.value.name);
        for (const chapter of document.value.chapters ?? []) {
            chapter.name = say(chapter.name);
        }
        // A scene name is read by the player on the load screen, so it carries a translation unit of
        // its own - promoted here exactly as a spoken line is, rather than taken from the table. The
        // table is still the answer for a scene that has no unit.
        for (const [sceneId, scene] of Object.entries(document.value.scenes ?? {})) {
            const unitId = `scene:${scene.id ?? sceneId}`;
            if (translations.units?.[unitId]) {
                flipped.set(unitId, { source: scene.name, translated: unitTarget(unitId) });
                scene.name = unitTarget(unitId);
            } else {
                scene.name = say(scene.name);
            }
        }
        // Depth-first over the whole document: a spoken line is `{ textId, value }` wherever it
        // sits, and blocks nest (choices hold branches, branches hold more lines).
        const walk = node => {
            if (Array.isArray(node)) {
                node.forEach(walk);
                return;
            }
            if (!node || typeof node !== "object") {
                return;
            }
            if (typeof node.textId === "string" && typeof node.value === "string") {
                flipped.set(node.textId, { source: node.value, translated: unitTarget(node.textId) });
                node.value = unitTarget(node.textId);
                return;
            }
            // A variable's value can be text a player reads: the skeleton writes the place it is in
            // into a persistent variable, and the save screen shows that string on every slot.
            //
            // Two kinds, and only one of them is text. A value that names a translation unit is a
            // reference, and the same reference in every language - translating it would leave the
            // save screen looking up an id nothing has. Anything else is a string the author typed,
            // which the table answers for, like the interface does.
            if (node.action === "setVariable" && typeof node.value === "string") {
                node.value = translations.units?.[node.value] ? node.value : say(node.value);
                return;
            }
            // An ending's name is text a player reads - wherever the game lists its endings - and it
            // has no translation unit of its own, so the table answers for it as for any other
            // string the author typed.
            if (node.control === "ending" && typeof node.name === "string") {
                node.name = say(node.name);
                return;
            }
            Object.values(node).forEach(walk);
        };
        walk(document.value);
        emit(documentPath, document.value, document.trailingNewline);
    }

    // --- Characters: the nametag a player reads is the name the author typed.
    const charactersPath = "editor/services/character.json";
    const characters = readJson(join(contentDir, charactersPath));
    for (const character of characters.value.characters ?? []) {
        const profile = character.profile;
        const unitId = `char:${profile.id}`;
        if (translations.units?.[unitId]) {
            flipped.set(unitId, { source: profile.name, translated: unitTarget(unitId) });
            profile.name = unitTarget(unitId);
        }
        for (const pose of profile.appearance?.poses ?? []) {
            pose.name = say(pose.name);
        }
    }
    emit(charactersPath, characters.value, characters.trailingNewline);

    // --- Variables and save fields: author-facing names, and the save screen shows the field's value.
    for (const [path, collection] of [["editor/variables.json", "entries"], ["editor/save-schema.json", "fields"]]) {
        const document = readJson(join(contentDir, path));
        for (const entry of Object.values(document.value[collection] ?? {})) {
            entry.name = say(entry.name);
        }
        emit(path, document.value, document.trailingNewline);
    }

    // --- The asset library: the folders an author files things into.
    //
    // Group names only. An asset's own name is what a story line names it by (`@background
    // classroom`), and the line is copied from the English tree unchanged - translating the name
    // would leave every line that uses it pointing at an asset that is not there.
    for (const name of readdirSync(join(contentDir, "assets"))) {
        if (!name.startsWith("assets.groups.") || !name.endsWith(".json")) {
            continue;
        }
        const groupsPath = `assets/${name}`;
        const groups = readJson(join(contentDir, groupsPath));
        for (const group of Object.values(groups.value ?? {})) {
            group.name = say(group.name);
        }
        emit(groupsPath, groups.value, groups.trailingNewline);
    }

    // --- Named keys: their source text is the language the project is written in.
    const keysPath = "editor/localization/keys.json";
    const keys = readJson(join(contentDir, keysPath));
    for (const [name, definition] of Object.entries(keys.value.keys ?? {})) {
        const unitId = `key:${name}`;
        flipped.set(unitId, { source: definition.sourceText, translated: unitTarget(unitId) });
        definition.sourceText = unitTarget(unitId);
    }
    emit(keysPath, keys.value, keys.trailingNewline);

    // --- The English the variant no longer says, as a translation of what it says instead.
    const sourceUnits = {};
    for (const [unitId, { source, translated }] of [...flipped].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (source === translated) {
            // A name that reads the same in both languages (the characters are called Narra and
            // Aoi either way). A unit here would be a translation of a word into itself.
            continue;
        }
        sourceUnits[unitId] = { sourceHash: hashSourceText(translated), status: "translated", target: source };
    }
    emit(`editor/localization/${table.sourceLocale}.json`, {
        locale: table.sourceLocale,
        schemaVersion: translations.schemaVersion,
        units: sourceUnits,
    }, true);

    // --- Every other translation, re-stamped: its targets still hold, its source text moved.
    const localizationDir = join(contentDir, "editor/localization");
    for (const name of readdirSync(localizationDir)) {
        const code = name.endsWith(".json") ? name.slice(0, -".json".length) : null;
        if (!code || code === "keys" || code === table.translations || code === table.sourceLocale) {
            continue;
        }
        const document = readJson(join(localizationDir, name));
        for (const [unitId, unit] of Object.entries(document.value.units ?? {})) {
            const flip = flipped.get(unitId);
            if (flip) {
                unit.sourceHash = hashSourceText(flip.translated);
            }
        }
        emit(`editor/localization/${name}`, document.value, document.trailingNewline);
    }

    const problems = [];
    if (blueprintText.unclassified.size > 0) {
        const list = [...blueprintText.unclassified]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([where, seenIn]) => `  ${where}${seenIn ? `  (in ${seenIn})` : ""}`)
            .join("\n");
        problems.push(
            `${graphsPath} holds strings in ${blueprintText.unclassified.size} place(s) this script has no description of:\n`
            + `${list}\n`
            + "Say what each one is in gen-skeleton-locale.mjs - text a player or an author reads, or something "
            + "the code looks up - before it ships in English or gets translated into a broken reference.",
        );
    }
    if (missing.size > 0) {
        const list = [...missing].sort().map(text => `  ${JSON.stringify(text)}`).join("\n");
        problems.push(
            `gen-skeleton-locale.${locale}.json has no entry for ${missing.size} string(s):\n${list}\n`
            + "Add each one (an unchanged string maps to itself).",
        );
    }
    const unasked = Object.keys(strings).filter(text => !asked.has(text)).sort();
    if (unasked.length > 0) {
        const list = unasked.map(text => `  ${JSON.stringify(text)}`).join("\n");
        problems.push(
            `gen-skeleton-locale.${locale}.json has ${unasked.length} entr${unasked.length === 1 ? "y" : "ies"} `
            + `nothing in the English content asked for:\n${list}\n`
            + "Remove each one whose string the English content no longer has. If it does still have it, this "
            + "script has stopped reading the part it is in - find that before touching the table.",
        );
    }
    if (problems.length > 0) {
        throw new Error(problems.join("\n\n"));
    }
    return { files, graphText: blueprintText.slots, ambiguous: blueprintText.ambiguous };
}

function listFiles(dir, prefix = "") {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.push(...listFiles(join(dir, entry.name), relativePath));
        } else if (entry.isFile()) {
            out.push(relativePath);
        }
    }
    return out;
}

// The places in the blueprint document that hold a word, with the English each one holds - the same
// in every variant, since the structure is copied. `starterLocaleGraphText.test.ts` reads each one
// out of the shipped variants and fails where the word is still the English one.
if (process.argv.includes("--graph-text")) {
    const { graphText } = buildVariant(TABLES[0]);
    process.stdout.write(JSON.stringify({ file: "editor/ui/uigraphs.json", slots: graphText }) + "\n");
    process.exit(0);
}

const check = process.argv.includes("--check");
let failed = false;
for (const locale of TABLES) {
    const { files, ambiguous } = buildVariant(locale);
    for (const { where, seenIn, value } of ambiguous) {
        console.warn(`content.${locale}: left as written, its uses disagree: ${where} = ${JSON.stringify(value)} (in ${seenIn})`);
    }
    const outDir = join(TEMPLATE_DIR, `content.${locale}`);
    const exists = statSync(outDir, { throwIfNoEntry: false })?.isDirectory() ?? false;
    if (check) {
        const onDisk = exists ? listFiles(outDir).sort() : [];
        const expected = files.map(file => file.path).sort();
        const differences = [
            ...expected.filter(path => !onDisk.includes(path)).map(path => `missing: ${path}`),
            ...onDisk.filter(path => !expected.includes(path)).map(path => `unexpected: ${path}`),
            ...files
                .filter(file => onDisk.includes(file.path)
                    && readFileSync(join(outDir, file.path), "utf-8") !== file.content)
                .map(file => `out of date: ${file.path}`),
        ];
        if (differences.length > 0) {
            failed = true;
            console.error(`content.${locale} does not match the English content:\n${differences.map(line => `  ${line}`).join("\n")}`);
        } else {
            console.log(`content.${locale}: up to date (${files.length} files)`);
        }
        continue;
    }
    // Written from scratch: a file that stopped being part of the variant has to stop existing,
    // and every byte here is produced from the English tree anyway.
    if (exists) {
        rmSync(outDir, { recursive: true });
    }
    for (const file of files) {
        const target = join(outDir, file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.content, "utf-8");
    }
    console.log(`content.${locale}: wrote ${files.length} files to ${relative(process.cwd(), outDir)}`);
}
process.exit(failed ? 1 : 0);
