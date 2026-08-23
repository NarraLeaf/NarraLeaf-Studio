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
// A string that has no entry in the table fails the run and is named, so English cannot leak into
// the variant by being forgotten.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(HERE, "../resources/templates/skeleton");
const TABLES = ["zh", "ja"];

/** Node params that hold text a player reads, or a name an author reads. Nothing else is touched. */
const TRANSLATED_NODE_PARAMS = new Set([
    "blueprint.layer.confirm:message",
    "blueprint.layer.confirm:button_1_label",
    "blueprint.layer.confirm:button_2_label",
    "blueprint.element.text.setText:text",
    "blueprint.data.stringLiteral:value",
    "blueprint.fn.head:name",
]);

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

    /** The table's word for an authored one; a string it does not know is reported, never guessed. */
    const say = text => {
        if (typeof text !== "string" || text === "") {
            return text;
        }
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
        // A preview row is text through and through - the line, the name above it, the body of a
        // notification - so every string in one goes through the table. A field added later shows
        // up as a missing entry rather than as English nobody noticed.
        for (const item of props.previewItems ?? []) {
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

    // --- The blueprints: the confirm dialogs a player answers, and the names an author navigates by.
    const graphsPath = "editor/ui/uigraphs.json";
    const graphs = readJson(join(contentDir, graphsPath));
    for (const blueprint of Object.values(graphs.value.blueprintDocument?.blueprints ?? {})) {
        blueprint.name = say(blueprint.name);
        const programGraphs = blueprint.program?.graphs ?? {};
        for (const collection of ["events", "functions"]) {
            for (const entry of Object.values(programGraphs[collection] ?? {})) {
                entry.name = say(entry.name);
                for (const node of Object.values(entry.graph?.nodes ?? {})) {
                    for (const [key, value] of Object.entries(node.params ?? {})) {
                        if (TRANSLATED_NODE_PARAMS.has(`${node.type}:${key}`)) {
                            node.params[key] = say(value);
                        }
                    }
                    // A Call Fn node carries a copy of the function's signature so it can draw its
                    // pins without reading the document. It is the same name told twice, and a copy
                    // left in English is what the node would then be labelled with.
                    const snapshot = node.params?.__fnSignatureSnapshot;
                    if (snapshot && typeof snapshot === "object") {
                        snapshot.name = say(snapshot.name);
                        for (const pin of [...(snapshot.params ?? []), ...(snapshot.returns ?? [])]) {
                            pin.name = say(pin.name);
                        }
                    }
                }
            }
        }
    }
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

    if (missing.size > 0) {
        const list = [...missing].sort().map(text => `  ${JSON.stringify(text)}`).join("\n");
        throw new Error(
            `gen-skeleton-locale.${locale}.json has no entry for ${missing.size} string(s):\n${list}\n`
            + "Add each one (an unchanged string maps to itself).",
        );
    }
    return files;
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

const check = process.argv.includes("--check");
let failed = false;
for (const locale of TABLES) {
    const files = buildVariant(locale);
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
