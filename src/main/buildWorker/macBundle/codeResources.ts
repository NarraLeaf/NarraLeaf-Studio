/**
 * A bundle's resource seal, `_CodeSignature/CodeResources`, as codesign writes it.
 *
 * The seal is a property list naming every file in the bundle that is not the main executable,
 * with its hash, so that changing any of them breaks the signature. Its hash goes into the main
 * executable's code directory (special slot -3), which is why it must come out byte for byte the
 * same as codesign's for the signature to match: the same entries, the same rules, the same
 * dictionary order and the same whitespace.
 *
 * It holds two seals made by two rule tables:
 *
 * - `files` (version 1, SHA-1): only what the version 1 rules name, which is `Resources/` and
 *   `version.plist`. Regular files only.
 * - `files2` (version 2, SHA-256): everything else as well. A file is `{hash2}`, a symbolic link
 *   is `{symlink: target}` and nested code is `{cdhash, requirement}`; any of them gains
 *   `optional` under an optional rule.
 *
 * Paths are relative to the bundle's content root (`Contents/` of an app, `Versions/A/` of a
 * framework). Both rule tables are codesign's defaults for a bundle, copied into the seal as
 * `rules` and `rules2`. Which entries are nested code is the walker's business
 * (`adhocSign.ts`); this module only states the seal.
 */

import crypto from "crypto";

type RuleValue = true | { nested?: true; omit?: true; optional?: true; weight?: number };

/** codesign's default version 1 resource rules, exactly as it writes them into the seal. */
export const RESOURCE_RULES: Readonly<Record<string, RuleValue>> = {
    "^Resources/": true,
    "^Resources/.*\\.lproj/": { optional: true, weight: 1000 },
    "^Resources/.*\\.lproj/locversion.plist$": { omit: true, weight: 1100 },
    "^Resources/Base\\.lproj/": { weight: 1010 },
    "^version.plist$": true,
};

/** codesign's default version 2 resource rules, exactly as it writes them into the seal. */
export const RESOURCE_RULES2: Readonly<Record<string, RuleValue>> = {
    ".*\\.dSYM($|/)": { weight: 11 },
    "^(.*/)?\\.DS_Store$": { omit: true, weight: 2000 },
    "^(Frameworks|SharedFrameworks|PlugIns|Plug-ins|XPCServices|Helpers|MacOS|Library/(Automator|Spotlight|LoginItems))/": {
        nested: true,
        weight: 10,
    },
    "^.*": true,
    "^Info\\.plist$": { omit: true, weight: 20 },
    "^PkgInfo$": { omit: true, weight: 20 },
    "^Resources/": { weight: 20 },
    "^Resources/.*\\.lproj/": { optional: true, weight: 1000 },
    "^Resources/.*\\.lproj/locversion.plist$": { omit: true, weight: 1100 },
    "^Resources/Base\\.lproj/": { weight: 1010 },
    "^[^/]+$": { nested: true, weight: 10 },
    "^embedded\\.provisionprofile$": { weight: 20 },
    "^version\\.plist$": { weight: 20 },
};

/** What a rule says about the paths it matches. */
export type ResourceRuleFlags = { omit: boolean; optional: boolean; nested: boolean };

type CompiledRule = ResourceRuleFlags & { pattern: RegExp; weight: number };

/* Highest weight first; a path takes the first rule it matches, as codesign's does. */
function compileRules(rules: Readonly<Record<string, RuleValue>>): CompiledRule[] {
    return Object.entries(rules)
        .map(([pattern, value]) => ({
            pattern: new RegExp(pattern),
            weight: value === true ? 1 : value.weight ?? 1,
            omit: value !== true && value.omit === true,
            optional: value !== true && value.optional === true,
            nested: value !== true && value.nested === true,
        }))
        .sort((a, b) => b.weight - a.weight);
}

const COMPILED_RULES = compileRules(RESOURCE_RULES);
const COMPILED_RULES2 = compileRules(RESOURCE_RULES2);

function findRule(rules: readonly CompiledRule[], path: string): CompiledRule | undefined {
    return rules.find(rule => rule.pattern.test(path));
}

/**
 * The version 2 rule for a path relative to the bundle's content root, which is the rule that
 * says whether something is nested code. Every path matches one: the table ends in `^.*`.
 */
export function resourceRule(path: string): ResourceRuleFlags {
    const { omit, optional, nested } = findRule(COMPILED_RULES2, path) as CompiledRule;
    return { omit, optional, nested };
}

/**
 * One thing a bundle's seal names. A regular file comes either with its bytes or, when it is too
 * large to hold in memory, with the two digests the seals need; it is sealed the same either way.
 */
export type SealedResource =
    | { path: string; kind: "file"; data: Buffer }
    | { path: string; kind: "hashedFile"; sha1: Buffer; sha256: Buffer }
    | { path: string; kind: "symlink"; target: string }
    | { path: string; kind: "nested"; cdhash: Buffer; requirement: string };

/**
 * The CodeResources document sealing `resources`.
 *
 * Pass every regular file (`file` or `hashedFile`) and symbolic link in the bundle except the
 * main executable and `_CodeSignature/`, whatever the rules say about them - each seal applies
 * its own rules, and a file one table omits (a `.DS_Store` under `Resources/`) can still be in
 * the other - plus one `nested` entry per piece of nested code, already signed.
 */
export function codeResources(resources: readonly SealedResource[]): Buffer {
    const files: PlistDictionary = {};
    const files2: PlistDictionary = {};
    for (const resource of resources) {
        const rule2 = findRule(COMPILED_RULES2, resource.path) as CompiledRule;
        if (resource.kind === "nested") {
            const { cdhash, requirement } = resource;
            files2[resource.path] = withOptional({ cdhash, requirement }, rule2.optional);
            continue;
        }
        if (resource.kind === "symlink") {
            if (!rule2.omit) {
                files2[resource.path] = withOptional({ symlink: resource.target }, rule2.optional);
            }
            continue;
        }
        if (!rule2.omit) {
            const hash2 = resource.kind === "file" ? sha256(resource.data) : resource.sha256;
            files2[resource.path] = withOptional({ hash2 }, rule2.optional);
        }
        const rule1 = findRule(COMPILED_RULES, resource.path);
        if (rule1 && !rule1.omit) {
            const hash = resource.kind === "file" ? crypto.createHash("sha1").update(resource.data).digest() : resource.sha1;
            files[resource.path] = rule1.optional ? { hash, optional: true } : hash;
        }
    }
    return Buffer.from(writeXmlPlist({
        files,
        files2,
        rules: RESOURCE_RULES as PlistDictionary,
        rules2: RESOURCE_RULES2 as PlistDictionary,
    }), "utf8");
}

function withOptional(seal: PlistDictionary, optional: boolean): PlistDictionary {
    return optional ? { ...seal, optional: true } : seal;
}

const sha256 = (data: Buffer): Buffer => crypto.createHash("sha256").update(data).digest();

/* ------------------------------------------------------------------ the XML writer */

/**
 * The values the writer knows: what a resource seal is made of. Numbers are written as `<real>`,
 * because the only numbers in a seal are rule weights and codesign stores those as reals.
 */
export type PlistWriteValue = boolean | string | number | Buffer | PlistDictionary;
export type PlistDictionary = { [key: string]: PlistWriteValue };

/*
 * Apple's writer breaks base64 across lines once it passes a width that shrinks with the
 * indentation (a tab counting as eight columns, out of 76, but never below 32 columns). A seal
 * only holds hashes, which never reach it, so rather than reproduce the wrapping the writer
 * refuses anything that would need it.
 */
const BASE64_LINE_COLUMNS = 76;
const TAB_COLUMNS = 8;
const MIN_BASE64_LINE_COLUMNS = 32;

/**
 * An XML property list laid out the way Core Foundation lays it out: tab indentation, keys in
 * order of their UTF-16 code units, `<data>` on lines of its own at the same indentation as its
 * tags, empty dictionaries as `<dict/>`, and only `&`, `<` and `>` escaped.
 */
export function writeXmlPlist(root: PlistWriteValue): string {
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        + '<plist version="1.0">\n'
        + plistValue(root, 0)
        + "</plist>\n";
}

const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function plistValue(value: PlistWriteValue, depth: number): string {
    const indent = "\t".repeat(depth);
    if (typeof value === "boolean") {
        return `${indent}<${value}/>\n`;
    }
    if (typeof value === "string") {
        return `${indent}<string>${escapeXml(value)}</string>\n`;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`${value} cannot be written to a property list`);
        }
        return `${indent}<real>${value}</real>\n`;
    }
    if (Buffer.isBuffer(value)) {
        const encoded = value.toString("base64");
        const columns = Math.max(BASE64_LINE_COLUMNS - TAB_COLUMNS * depth, MIN_BASE64_LINE_COLUMNS);
        if (value.length > Math.floor(columns / 4) * 3) {
            throw new Error(`${value.length} bytes of data would be wrapped across lines, which this writer does not do`);
        }
        return `${indent}<data>\n${indent}${encoded}\n${indent}</data>\n`;
    }
    // Plain `sort()` compares UTF-16 code units, which is how Core Foundation orders the keys.
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
        return `${indent}<dict/>\n`;
    }
    const entries = keys.map(key => `${indent}\t<key>${escapeXml(key)}</key>\n${plistValue(value[key], depth + 1)}`);
    return `${indent}<dict>\n${entries.join("")}${indent}</dict>\n`;
}
