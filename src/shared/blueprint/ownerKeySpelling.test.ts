import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Nothing builds an owner key out of string pieces.
 *
 * The format is a hash input and a document key at once, so a second place that spells it is a
 * second place that can be wrong about it - and this has already happened twice over. First as three
 * decoders that each read the built-in surface's widgets differently. Then, the moment the format
 * was fixed, as three *encoders* hiding in plain sight: `widgetMain:${surfaceId}:${elementId}` in the
 * runtime's flush targets, and two prefix tests - `k.startsWith(\`widgetMain:${surfaceId}:\`)` - used
 * to decide which blueprints a deleted surface takes with it and which belong to a history snapshot.
 *
 * A prefix test reads as a search rather than as an encoding, which is exactly why it survived
 * review. It was wrong twice even before the escaping changed under it: it would have matched a
 * different surface whose id merely begins with this one's.
 *
 * So the rule is mechanical: `encodeBlueprintOwnerKey` writes them, `decodeBlueprintOwnerKey` and
 * `ownerKeyBelongsToSurface` read them, and no source file assembles one from a literal. Test
 * fixtures included - a fixture that spells its own keys drifts from the encoder silently, and three
 * lint tests did exactly that, reporting every wired button as unwired.
 */

const SRC = path.resolve(__dirname, "../..");

/** The kinds that take an id, so a bare `globalMain` string is not a false positive. */
const KINDS = ["surfaceMain", "widgetMain", "widgetValue", "componentWidgetMain", "storyAction"];

/** Where the format is allowed to be written out: the module that defines it, and its own tests. */
const OWNS_THE_FORMAT = ["blueprint/ownerKey.ts", "blueprint/ownerKey.test.ts", "blueprint/ownerKeySpelling.test.ts"];

/**
 * A key being built from pieces: a template literal with an interpolation, or a concatenation.
 *
 * Matches the opening only - `\`widgetMain:${` or `"widgetMain:" +` - because that is the part that
 * commits to the format. A whole literal key with no interpolation is a fixed string, which the
 * decoder reads or does not; it cannot silently mean a different slot for a different surface.
 */
const ASSEMBLED = new RegExp(
    `(\`(${KINDS.join("|")}):[^\`]*\\$\\{)|(["'](${KINDS.join("|")}):["']\\s*\\+)`,
);

function withoutCommentsAndStrings(source: string): string {
    // Comments are stripped because this file's own explanations, and the doc comments on the owner
    // key module, quote the very shapes being banned.
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sources(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== "dist") {
                sources(full, out);
            }
        } else if (/\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe("owner key spelling", () => {
    it("is nowhere but the module that owns it", () => {
        // Failing here means a file is assembling an owner key. Call `encodeBlueprintOwnerKey`; if
        // what you actually want is "does this key belong to X", call the predicate rather than
        // rebuilding the key's opening to compare against.
        const offenders = sources(SRC)
            .map(file => ({ file: path.relative(SRC, file).replaceAll(path.sep, "/"), text: fs.readFileSync(file, "utf-8") }))
            .filter(entry => !OWNS_THE_FORMAT.includes(entry.file))
            .filter(entry => ASSEMBLED.test(withoutCommentsAndStrings(entry.text)))
            .map(entry => entry.file);

        expect(offenders).toEqual([]);
    });
});
