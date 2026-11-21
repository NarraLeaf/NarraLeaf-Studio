import fs from "fs/promises";
import path from "path";
import { shippedRuntimeFiles, type GameRuntimePluginSource } from "../preview/compiler/gameRuntimeArtifactCompiler";

/**
 * The third-party notice a game ships: the copyright and licence text of every npm package whose
 * code is inside the files that game carries.
 *
 * Studio's build scripts do the reading (project/build/third-party-notices.js): each shipped
 * directory under `dist/` gets a document saying which packages each of its output files contains,
 * with every package's entry already rendered. This side only picks. A desktop game carries the
 * runtime's main.js, preload.js and renderer pair; a web export (and the mobile packages, which
 * serve the same site) carries the renderer pair and web.js instead; and a built-in plugin's runtime
 * entry is in either only when the game ships that plugin. The notice is the union of exactly those,
 * so it names nothing the game does not contain - koffi, copied beside a desktop game's main.js,
 * appears in the desktop notice and not in the web one.
 *
 * Third-party plugins are not read. Their dependencies are their authors' to account for.
 *
 * Nothing here is optional. A runtime without its document, or a built-in plugin without one, is a
 * Studio that was built wrong, and the build stops rather than shipping a game with a notice that
 * leaves packages out.
 */

/** The file beside a game's executable (and at a web export's root). */
export const THIRD_PARTY_NOTICES_FILENAME = "THIRD-PARTY-NOTICES.txt";
/** The per-directory document the build scripts write; see project/build/third-party-notices.js. */
export const THIRD_PARTY_NOTICES_DOCUMENT = "third-party-notices.json";
const DOCUMENT_SCHEMA = 1;

export type ThirdPartyNoticesDocument = {
    schema: typeof DOCUMENT_SCHEMA;
    /** The notice's opening paragraph. Every document carries the same one. */
    header: string;
    /** Every package some output names, by `name@version`, with its entry already rendered. */
    packages: Record<string, { name: string; version: string; license: string | null; block: string }>;
    /** Output file (relative to the document's directory) to the packages it contains. */
    outputs: Record<string, string[]>;
};

/** One document, and which of its outputs the game ships. */
export type ThirdPartyNoticesPart = {
    document: ThirdPartyNoticesDocument;
    outputs: readonly string[];
};

function isDocument(value: unknown): value is ThirdPartyNoticesDocument {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Partial<ThirdPartyNoticesDocument>;
    return candidate.schema === DOCUMENT_SCHEMA
        && typeof candidate.header === "string"
        && !!candidate.packages && typeof candidate.packages === "object"
        && !!candidate.outputs && typeof candidate.outputs === "object";
}

/**
 * Read one document, or throw a sentence saying whose is missing. `owner` names the thing in that
 * sentence ("the game runtime", "the Gallery plugin").
 */
export async function readThirdPartyNoticesDocument(dir: string, owner: string): Promise<ThirdPartyNoticesDocument> {
    const file = path.join(dir, THIRD_PARTY_NOTICES_DOCUMENT);
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(file, "utf-8"));
    } catch (error) {
        const reason = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "is missing" : "cannot be read";
        throw new Error(
            `The third-party notice of ${owner} ${reason} (${file}). Rebuild Studio with its build scripts; ` +
            "a game cannot be packaged without it.",
        );
    }
    if (!isDocument(parsed)) {
        throw new Error(
            `The third-party notice of ${owner} is not in a form this Studio reads (${file}). Rebuild Studio with its build scripts.`,
        );
    }
    return parsed;
}

function compareCodeUnits(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The same order the build scripts write in: by name, then by version, by code unit. Never by
 * locale, which differs between machines and would make two builds of one game disagree.
 */
function comparePackageKeys(a: string, b: string): number {
    const at = a.lastIndexOf("@");
    const bt = b.lastIndexOf("@");
    return compareCodeUnits(a.slice(0, at), b.slice(0, bt)) || compareCodeUnits(a.slice(at + 1), b.slice(bt + 1));
}

/**
 * The notice for a set of shipped outputs. A notice is the header followed by each package's
 * entry - the one rule the build scripts' renderer also follows, so a game that ships everything a
 * document names gets that document's text byte for byte.
 */
export function composeThirdPartyNotices(parts: readonly ThirdPartyNoticesPart[]): string {
    if (parts.length === 0) {
        throw new Error("A third-party notice needs at least the runtime's document.");
    }
    const blocks = new Map<string, string>();
    for (const { document, outputs } of parts) {
        for (const output of outputs) {
            for (const key of document.outputs[output] ?? []) {
                const entry = document.packages[key];
                if (!entry) {
                    throw new Error(`The third-party notice names ${key} for ${output} but has no entry for it.`);
                }
                blocks.set(key, entry.block);
            }
        }
    }
    const keys = [...blocks.keys()].sort(comparePackageKeys);
    return parts[0].document.header + keys.map(key => blocks.get(key)).join("");
}

/** Where NarraLeaf Studio's source code is published. */
export const STUDIO_SOURCE_REPOSITORY = "https://github.com/NarraLeaf/NarraLeaf-Studio";

/**
 * The entry for Studio's own code inside a game: the runtime, and the built-in plugins it carries.
 *
 * The build scripts leave the repository's own source out of the documents - it is not third-party -
 * but a game is a copy of it all the same, and MPL-2.0 (section 3.2) asks whoever distributes an
 * executable form to tell its recipients where the source is. A game author never touches this file,
 * so the entry is written for them: name, version, licence, and the release's tag on GitHub.
 * Placed first, after the header, so it is not mistaken for one more npm package.
 */
export function studioRuntimeNoticeBlock(studioVersion: string, builtInPluginNames: readonly string[]): string {
    const parts = builtInPluginNames.length === 0
        ? "The game runtime is"
        : `The game runtime and the built-in plugins ${builtInPluginNames.join(", ")} are`;
    return [
        "",
        "=".repeat(80),
        `NarraLeaf Studio game runtime ${studioVersion}`,
        "License: MPL-2.0",
        `Source: ${STUDIO_SOURCE_REPOSITORY}/tree/v${studioVersion}`,
        "",
        `${parts} part of NarraLeaf Studio and distributed under the`,
        "Mozilla Public License, Version 2.0. Their source code is available at the address above.",
        "The licence text is at https://mozilla.org/MPL/2.0/.",
        "",
    ].join("\n");
}

/**
 * The notice a game compiled for `shell` ships, from the runtime dist it was compiled from and the
 * plugins it carries, opened by the entry for Studio's own code ({@link studioRuntimeNoticeBlock}).
 */
export async function gameThirdPartyNotices(input: {
    runtimeDistDir: string;
    shell: "electron" | "web";
    plugins: readonly GameRuntimePluginSource[];
    /** The Studio version building the game; names the release whose source the game carries. */
    studioVersion: string;
}): Promise<string> {
    const parts: ThirdPartyNoticesPart[] = [{
        document: await readThirdPartyNoticesDocument(input.runtimeDistDir, "the game runtime"),
        outputs: shippedRuntimeFiles(input.shell),
    }];
    const builtIn = input.plugins
        .filter(plugin => plugin.builtIn)
        .sort((a, b) => compareCodeUnits(a.manifest.id, b.manifest.id));
    for (const plugin of builtIn) {
        parts.push({
            document: await readThirdPartyNoticesDocument(plugin.installPath, `the ${plugin.manifest.name} plugin`),
            outputs: [plugin.entry],
        });
    }
    const header = parts[0].document.header;
    const composed = composeThirdPartyNotices(parts);
    const studio = studioRuntimeNoticeBlock(input.studioVersion, builtIn.map(plugin => plugin.manifest.name ?? plugin.manifest.id));
    return header + studio + composed.slice(header.length);
}
