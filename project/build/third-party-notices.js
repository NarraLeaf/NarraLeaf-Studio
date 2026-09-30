'use strict';

/*
 * Third-party notices: the copyright and licence texts of every npm package whose code ends up in
 * something Studio ships.
 *
 * Almost every package Studio bundles is MIT, BSD, ISC or Apache licensed, and all of those have the
 * same one condition: the copyright notice and the licence text travel with every copy. A bundle is
 * a copy that has lost them - esbuild inlines `node_modules/react/cjs/*.js` and leaves
 * `node_modules/react/LICENSE` behind - so the texts have to be carried separately. This module is
 * what carries them.
 *
 * # What is listed
 *
 * Exactly the packages whose code is in a bundle, read off esbuild's metafile rather than off
 * `package.json` or `node_modules`: an input counts when at least one byte of it survived into an
 * output (`bytesInOutput > 0`), so a package that was imported and then tree-shaken away entirely is
 * not listed, and a transitive dependency nobody declared is. A bundle can also name packages it
 * does not inline but that ship beside it as files and are loaded at run time (`shipsWith` - koffi
 * beside a game's main.js); those carry no licence file of their own either, because only their code
 * is copied.
 *
 * The repository's own source is not third-party and is never listed, and neither are the
 * organisation's own closed packages in FIRST_PARTY_PACKAGES below.
 *
 * # What is written
 *
 * The plugin keeps one document per shipped directory ("scope") under `dist/`:
 *
 *   dist/runtime/third-party-notices.json                the game runtime
 *   dist/main/third-party-notices.json                   Studio's main-process bundles
 *   dist/windows/third-party-notices.json                Studio's renderer apps
 *   dist/builtin-plugins/<name>/third-party-notices.json one built-in plugin, both of its entries
 *
 * Each document says, per output file, which packages are in it, and holds every one of those
 * packages' notice already rendered. That is what lets a game build assemble a notice for exactly
 * the files it ships (a desktop game ships main.js, a web export ships web.js instead, and a
 * built-in plugin's runtime entry only when the game uses the plugin) without a second renderer and
 * without the package directories, which a packaged Studio does not have. The game side of this is
 * `src/main/app/application/managers/build/thirdPartyNotices.ts`.
 *
 * From the documents it writes two text files: `dist/runtime/THIRD-PARTY-NOTICES.txt` (everything
 * the runtime can put into a game) and `dist/THIRD-PARTY-NOTICES.txt` (everything Studio itself
 * ships, which electron-builder puts in the packaged app's resources).
 *
 * Output is deterministic: packages are sorted by name then version by code unit, texts are
 * normalised to LF, and nothing machine-specific (no path, no date) is written. Building twice
 * produces the same bytes.
 *
 * # What fails the build
 *
 * A package that states no licence and ships no licence file, one whose licence is not in
 * ALLOWED_LICENSES, and one that ships a licence file but names no licence (so there is nothing to
 * check the list against). Each is a release blocker a person has to look at, so the bundle fails
 * with the package named rather than shipping without its notice. Adding a licence to the list is a
 * decision about what Studio and every game it builds may contain; the comment on the list says how.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const defaultDistRoot = path.join(rootDir, 'dist');

/** The human-readable notice, beside a game's executable and in Studio's resources. */
const NOTICES_FILENAME = 'THIRD-PARTY-NOTICES.txt';
/** The per-scope document the text files and every game's notice are assembled from. */
const NOTICES_DOCUMENT_FILENAME = 'third-party-notices.json';
/** Bumped when the document's shape changes; readers refuse a schema they do not know. */
const NOTICES_DOCUMENT_SCHEMA = 1;

/**
 * Licences a bundled package may carry, by SPDX identifier.
 *
 * Every one of these is satisfied by what the notice file does - reproduce the copyright notice and
 * the licence text - plus, for MPL-2.0, saying where the source is, which the notice's `Source:` line
 * does. MPL-2.0 is weak copyleft at file level rather than permissive: it is here because the engine
 * (narraleaf-react) and Studio itself are MPL-2.0, and it asks nothing of the rest of a game.
 *
 * To allow another licence: read it, confirm that shipping the notice is all it asks of a bundled,
 * unmodified copy (no source offer for the whole program, no advertising clause, no field-of-use
 * restriction), and add its SPDX identifier here with the package that needed it. A licence that
 * asks for more than that is not something to add to this list; the package has to go instead.
 */
const ALLOWED_LICENSES = new Set([
    '0BSD',
    'Apache-2.0',
    'BlueOak-1.0.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'CC0-1.0',
    'ISC',
    'MIT',
    'MIT-0',
    'MPL-2.0',
    'Unlicense',
    'Zlib',
]);

/**
 * Packages the NarraLeaf organisation publishes itself and does not license to anyone
 * (`"license": "UNLICENSED"`). They are Studio's own components rather than third-party software,
 * so they are not listed and not checked. Named one by one: a scope prefix would let any package
 * published under it through without anybody having looked.
 */
const FIRST_PARTY_PACKAGES = new Map([
    // The native codec addon, from NarraLeaf/NarraLeaf-Encryption.
    ['@narraleaf/bindings', 'native codec addon'],
]);

/**
 * Licences whose notice must say where the package's source is published (MPL-2.0 §3.2). A package
 * that can only be shipped under one of these, and whose manifest names no repository or homepage,
 * fails like a disallowed licence does.
 */
const SOURCE_REQUIRED_LICENSES = new Set(['MPL-2.0']);

/**
 * Where a package's source is published, for a package whose own manifest does not say. Consulted
 * only after `repository` and `homepage`, so an entry becomes dead weight - and should be removed -
 * as soon as the package's published package.json carries a `repository`.
 */
const SOURCE_OVERRIDES = new Map([
    // The engine's published package.json has no `repository` (narraleaf-react 0.47.0).
    ['narraleaf-react', 'https://github.com/NarraLeaf/narraleaf-react'],
]);

const HEADER = [
    'THIRD-PARTY SOFTWARE NOTICES',
    '',
    'This program includes the open source packages listed below. Each entry names the package',
    'and the version included, the licence it is distributed under, where its source code is',
    'published, and the licence text the package ships with.',
    '',
].join('\n');

const RULE = '='.repeat(80);

// ---------------------------------------------------------------------------------------------
// Reading packages
// ---------------------------------------------------------------------------------------------

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

function isInside(child, parent) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * The package directory a bundled file belongs to, or null when it belongs to none.
 *
 * Under `node_modules` the package is the segment after the last `node_modules` (two for a scoped
 * name), which is right even for files in a package's own nested `package.json` directories
 * (`esm/package.json` saying only `"type": "module"`). Anywhere else - a sibling checkout linked in
 * place of an installed copy - it is the nearest directory whose `package.json` has a name and a
 * version.
 */
function packageRootOf(file) {
    const parts = path.resolve(file).split(path.sep);
    const nodeModules = parts.lastIndexOf('node_modules');
    if (nodeModules !== -1) {
        const scoped = (parts[nodeModules + 1] ?? '').startsWith('@');
        const end = nodeModules + (scoped ? 3 : 2);
        if (end < parts.length) {
            return parts.slice(0, end).join(path.sep);
        }
        return null;
    }
    let dir = path.dirname(path.resolve(file));
    for (;;) {
        const manifest = readJson(path.join(dir, 'package.json'));
        if (manifest && typeof manifest.name === 'string' && typeof manifest.version === 'string') {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}

/** Whether a package directory is this repository's own code rather than something installed. */
function isRepositorySource(dir, repositoryRoot = rootDir) {
    return isInside(dir, repositoryRoot)
        && !path.relative(repositoryRoot, dir).split(path.sep).includes('node_modules');
}

/** The directory of an installed package, resolved the way the bundle resolved it. */
function resolvePackageDir(name, from = rootDir) {
    try {
        return path.dirname(require.resolve(`${name}/package.json`, { paths: [from] }));
    } catch {
        // A package whose `exports` hides its package.json: walk up from its entry instead.
    }
    let dir = path.dirname(require.resolve(name, { paths: [from] }));
    for (;;) {
        const manifest = readJson(path.join(dir, 'package.json'));
        if (manifest && manifest.name === name) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`Could not find the package directory of "${name}".`);
        }
        dir = parent;
    }
}

/** The licence a manifest declares, as an SPDX expression, or null when it declares none. */
function declaredLicense(manifest) {
    const license = manifest.license;
    if (typeof license === 'string' && license.trim()) {
        return license.trim();
    }
    if (license && typeof license === 'object' && typeof license.type === 'string' && license.type.trim()) {
        return license.type.trim();
    }
    // The long-deprecated `licenses: [{ type }]` form, which some old packages still carry.
    if (Array.isArray(manifest.licenses)) {
        const types = manifest.licenses
            .map(entry => (typeof entry === 'string' ? entry : entry && entry.type))
            .filter(type => typeof type === 'string' && type.trim())
            .map(type => type.trim());
        if (types.length === 1) {
            return types[0];
        }
        if (types.length > 1) {
            return `(${types.join(' OR ')})`;
        }
    }
    return null;
}

/**
 * The files at a package's root that hold its licence or its notices: LICENSE, LICENCE, COPYING,
 * NOTICE and a third-party notice of its own (monaco-editor's `ThirdPartyNotices.txt` covers the code
 * it bundles from others), in any case, with or without an extension or a qualifier (`LICENSE-MIT`,
 * `LICENSE.md`, `MIT-LICENSE.txt`). Code files that happen to be called `license.js` are not
 * licence texts.
 */
const LICENCE_FILE =
    /^(?:[a-z0-9]+[-_.])?(?:licen[cs]e|copying|notices?|third[-_.]?party[-_.]?notices?)(?:[-_.][a-z0-9-]+)*$/i;
const CODE_FILE = /\.(?:[cm]?js|ts|json|map|html?)$/i;

function licenceFileNames(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(entry => entry.isFile() && LICENCE_FILE.test(entry.name) && !CODE_FILE.test(entry.name))
        .map(entry => entry.name)
        .sort(compareCodeUnits);
}

/** One text as it appears in the notice: no BOM, LF line ends, no trailing blank lines. */
function normaliseText(text) {
    return text
        .replace(/^﻿/, '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(line => line.replace(/[ \t]+$/, ''))
        .join('\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '');
}

/** A repository field as a URL a reader can open, or null when there is none. */
function repositoryUrl(manifest) {
    const repository = manifest.repository;
    let url = typeof repository === 'string'
        ? repository
        : repository && typeof repository.url === 'string' ? repository.url : null;
    if (!url || !url.trim()) {
        return null;
    }
    url = url.trim();
    // npm's shorthands: "github:owner/repo", "gitlab:owner/repo", and a bare "owner/repo".
    const shorthand = /^(github|gitlab|bitbucket):(.+)$/.exec(url);
    if (shorthand) {
        const host = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }[shorthand[1]];
        url = `https://${host}/${shorthand[2]}`;
    } else if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
        url = `https://github.com/${url}`;
    }
    url = url
        .replace(/^git\+/, '')
        .replace(/^git:\/\//, 'https://')
        .replace(/^ssh:\/\/git@/, 'https://')
        .replace(/^git@([^:]+):/, 'https://$1/')
        .replace(/\.git$/, '');
    const directory = repository && typeof repository === 'object' && typeof repository.directory === 'string'
        ? repository.directory.trim().replace(/^\/+|\/+$/g, '')
        : '';
    return directory && /^https:\/\/(github\.com|gitlab\.com)\//.test(url)
        ? `${url}/tree/HEAD/${directory}`
        : url;
}

/**
 * Everything the notice says about one package, read from its directory.
 *
 * @returns {{ name: string, version: string, license: string | null, source: string | null,
 *   files: { name: string, text: string }[] }}
 */
function describePackage(dir) {
    const manifest = readJson(path.join(dir, 'package.json'));
    if (!manifest || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
        throw new Error(`${dir} has no readable package.json with a name and a version.`);
    }
    const homepage = typeof manifest.homepage === 'string' && /^https?:\/\//.test(manifest.homepage.trim())
        ? manifest.homepage.trim()
        : null;
    return {
        name: manifest.name,
        version: manifest.version,
        license: declaredLicense(manifest),
        source: repositoryUrl(manifest) ?? homepage ?? SOURCE_OVERRIDES.get(manifest.name) ?? null,
        files: licenceFileNames(dir)
            .map(name => ({ name, text: normaliseText(fs.readFileSync(path.join(dir, name), 'utf-8')) }))
            .filter(file => file.text),
    };
}

// ---------------------------------------------------------------------------------------------
// Checking licences
// ---------------------------------------------------------------------------------------------

/**
 * Whether an SPDX expression is satisfiable using only allowed licences: `A OR B` needs one of them,
 * `A AND B` needs both, `A WITH exception` is judged on `A`, and `A+` on `A`. Anything that does not
 * parse (`SEE LICENSE IN ...`, `UNLICENSED`, free text) is not allowed - it is exactly the case a
 * person has to read.
 */
function isAllowedExpression(expression, allowed = ALLOWED_LICENSES) {
    const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
    let position = 0;
    const peek = () => tokens[position];
    const take = () => tokens[position++];

    function parseOr() {
        let result = parseAnd();
        while (peek() && peek().toUpperCase() === 'OR') {
            take();
            const right = parseAnd();
            result = result || right;
        }
        return result;
    }
    function parseAnd() {
        let result = parseAtom();
        while (peek() && peek().toUpperCase() === 'AND') {
            take();
            const right = parseAtom();
            result = result && right;
        }
        return result;
    }
    function parseAtom() {
        const token = take();
        if (token === undefined) {
            throw new SyntaxError('unexpected end');
        }
        if (token === '(') {
            const inner = parseOr();
            if (take() !== ')') {
                throw new SyntaxError('unbalanced parenthesis');
            }
            return inner;
        }
        if (token === ')' || ['AND', 'OR', 'WITH'].includes(token.toUpperCase())) {
            throw new SyntaxError(`unexpected "${token}"`);
        }
        if (peek() && peek().toUpperCase() === 'WITH') {
            take();
            if (take() === undefined) {
                throw new SyntaxError('WITH names no exception');
            }
        }
        return allowed.has(token.replace(/\+$/, ''));
    }

    try {
        const result = parseOr();
        return position === tokens.length && result;
    } catch {
        return false;
    }
}

/** Why a described package may not ship, or null when it may. */
function licenceProblem(description, allowed = ALLOWED_LICENSES) {
    const label = `"${description.name}@${description.version}"`;
    if (!description.license && description.files.length === 0) {
        return `${label} declares no licence and ships no licence file.`;
    }
    if (!description.license) {
        return `${label} ships ${description.files.map(file => file.name).join(', ')} but its package.json names ` +
            `no licence, so it cannot be checked against the allowed licences.`;
    }
    if (!isAllowedExpression(description.license, allowed)) {
        return `${label} is licensed "${description.license}", which is not one of the allowed licences.`;
    }
    const withoutSourceOffer = new Set([...allowed].filter(id => !SOURCE_REQUIRED_LICENSES.has(id)));
    if (!description.source && !isAllowedExpression(description.license, withoutSourceOffer)) {
        return `${label} is licensed "${description.license}", which requires the notice to say where its ` +
            'source is published, and its package.json names no repository or homepage (see SOURCE_OVERRIDES).';
    }
    return null;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

function compareCodeUnits(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

function packageKey(description) {
    return `${description.name}@${description.version}`;
}

/** Sorts `name@version` keys by name, then by version, by code unit - never by locale. */
function comparePackageKeys(a, b) {
    const at = a.lastIndexOf('@');
    const bt = b.lastIndexOf('@');
    return compareCodeUnits(a.slice(0, at), b.slice(0, bt)) || compareCodeUnits(a.slice(at + 1), b.slice(bt + 1));
}

/**
 * One package's entry in the notice, including the blank line and rule that open it, so that a
 * notice is always `header + blocks.join('')` - the one rule the game-side assembler repeats.
 */
function renderPackageBlock(description) {
    const lines = ['', RULE, `${description.name} ${description.version}`];
    lines.push(`License: ${description.license ?? 'not stated'}`);
    if (description.source) {
        lines.push(`Source: ${description.source}`);
    }
    lines.push('');
    if (description.files.length === 0) {
        lines.push(
            `This package ships no licence file. Its package.json states the licence as "${description.license}".`,
        );
    } else if (description.files.length === 1) {
        lines.push(description.files[0].text);
    } else {
        description.files.forEach((file, index) => {
            if (index > 0) {
                lines.push('');
            }
            lines.push(file.name, '-'.repeat(file.name.length), file.text);
        });
    }
    return `${lines.join('\n')}\n`;
}

/** A notice from rendered blocks keyed by `name@version`. */
function renderNotices(blocksByKey) {
    const keys = Object.keys(blocksByKey).sort(comparePackageKeys);
    return HEADER + keys.map(key => blocksByKey[key]).join('');
}

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

function emptyDocument() {
    return { schema: NOTICES_DOCUMENT_SCHEMA, header: HEADER, packages: {}, outputs: {} };
}

function readDocument(file) {
    const document = readJson(file);
    if (!document || document.schema !== NOTICES_DOCUMENT_SCHEMA
        || typeof document.packages !== 'object' || typeof document.outputs !== 'object') {
        return null;
    }
    return document;
}

/**
 * The document with every key in a fixed order and every package no output names dropped, so that
 * two builds of the same thing write the same bytes whatever order their bundles finished in.
 */
function canonicalDocument(document) {
    const outputs = {};
    const referenced = new Set();
    for (const output of Object.keys(document.outputs).sort(compareCodeUnits)) {
        const keys = [...new Set(document.outputs[output])].sort(comparePackageKeys);
        outputs[output] = keys;
        keys.forEach(key => referenced.add(key));
    }
    const packages = {};
    for (const key of Object.keys(document.packages).sort(comparePackageKeys)) {
        if (referenced.has(key)) {
            const entry = document.packages[key];
            packages[key] = { name: entry.name, version: entry.version, license: entry.license, block: entry.block };
        }
    }
    return { schema: NOTICES_DOCUMENT_SCHEMA, header: HEADER, packages, outputs };
}

function writeFileIfChanged(file, content) {
    try {
        if (fs.readFileSync(file, 'utf-8') === content) {
            return;
        }
    } catch {
        // Not there yet.
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
}

function serialiseDocument(document) {
    return `${JSON.stringify(canonicalDocument(document), null, 2)}\n`;
}

/** The notice for a document: every package any of its outputs names. */
function renderDocument(document) {
    const blocks = {};
    for (const [key, entry] of Object.entries(document.packages)) {
        blocks[key] = entry.block;
    }
    return renderNotices(blocks);
}

/**
 * The scope an output belongs to: the directory under `dist/` whose document records it, and the
 * output's path inside that directory. Built-in plugins are one scope each, because each travels on
 * its own (into the user's plugin folder, and from there into a game). Null for an output outside
 * `dist/`, which is not something Studio ships.
 */
function scopeOf(outfile, distRoot) {
    if (!isInside(outfile, distRoot)) {
        return null;
    }
    const parts = path.relative(distRoot, outfile).split(path.sep);
    const depth = parts[0] === 'builtin-plugins' ? 2 : 1;
    if (parts.length <= depth) {
        return null;
    }
    return {
        dir: path.join(distRoot, ...parts.slice(0, depth)),
        output: parts.slice(depth).join('/'),
    };
}

/** Every scope document under a dist directory. */
function listScopeDocuments(distRoot) {
    const found = [];
    const visit = (dir, depth) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const child = path.join(dir, entry.name);
            if (fs.existsSync(path.join(child, NOTICES_DOCUMENT_FILENAME))) {
                found.push(path.join(child, NOTICES_DOCUMENT_FILENAME));
            }
            if (depth === 0 && entry.name === 'builtin-plugins') {
                visit(child, 1);
            }
        }
    };
    visit(distRoot, 0);
    return found.sort(compareCodeUnits);
}

/** Rewrites `dist/THIRD-PARTY-NOTICES.txt` from every scope document present. */
function writeStudioNotices(distRoot) {
    const blocks = {};
    for (const file of listScopeDocuments(distRoot)) {
        const document = readDocument(file);
        if (!document) {
            continue;
        }
        for (const [key, entry] of Object.entries(document.packages)) {
            blocks[key] = entry.block;
        }
    }
    writeFileIfChanged(path.join(distRoot, NOTICES_FILENAME), renderNotices(blocks));
}

// ---------------------------------------------------------------------------------------------
// Recording a build
// ---------------------------------------------------------------------------------------------

/** Package descriptions by directory, for the life of the process: a watch rebuild reads nothing. */
const descriptionCache = new Map();

function describeCached(dir) {
    let description = descriptionCache.get(dir);
    if (!description) {
        description = describePackage(dir);
        descriptionCache.set(dir, description);
    }
    return description;
}

/**
 * Packages whose code a transform wrote into a file on its way into a bundle, by that file.
 *
 * The metafile only knows the file esbuild loaded. When a plugin's `onLoad` returns more than that
 * file - Tailwind copying its preflight stylesheet into `styles.css`, postcss-import inlining a
 * stylesheet from a package - the extra code arrives under the loading file's name and would be
 * invisible here. The plugin that does it says so through {@link setInputAttribution}.
 */
const inputAttributions = new Map();

/**
 * Declare the packages whose code the last load of `file` contained besides the file's own. Replaces
 * what an earlier load said, so a watch rebuild that stopped inlining a package stops listing it.
 *
 * @param {string} file Absolute path of the loaded file, as the plugin's `onLoad` received it.
 * @param {string[]} packageDirs Package directories (see {@link resolvePackageDir}, {@link packageRootOf}).
 */
function setInputAttribution(file, packageDirs) {
    const dirs = [...new Set(packageDirs.filter(Boolean))];
    if (dirs.length === 0) {
        inputAttributions.delete(path.resolve(file));
    } else {
        inputAttributions.set(path.resolve(file), dirs);
    }
}

/** An input path from a metafile as a file on disk, or null for one in a plugin's own namespace. */
function inputFile(input, absWorkingDir) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^[a-z]:[\\/]/i.test(input)) {
        return null;
    }
    return path.resolve(absWorkingDir, input);
}

/**
 * Record one finished build: which packages each of its outputs contains, into the documents of the
 * scopes those outputs belong to, then rewrite the text files.
 *
 * @param {{ metafile: import('esbuild').Metafile, absWorkingDir: string, distRoot?: string,
 *   shipsWith?: string[], repositoryRoot?: string, allowed?: Set<string> }} options
 * @returns {string[]} Why the build may not ship; empty when it may. Nothing is written unless empty.
 */
function recordBuild(options) {
    const {
        metafile,
        absWorkingDir,
        distRoot = defaultDistRoot,
        shipsWith = [],
        repositoryRoot = rootDir,
        allowed = ALLOWED_LICENSES,
    } = options;

    /** @type {Map<string, { dir: string, outputs: Map<string, Set<string>> }>} */
    const scopes = new Map();
    const descriptions = new Map();
    const problems = [];

    const include = (packageDir, output, scope) => {
        if (!packageDir || isRepositorySource(packageDir, repositoryRoot)) {
            return;
        }
        let description;
        try {
            description = describeCached(packageDir);
        } catch (error) {
            problems.push(`${output}: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        if (FIRST_PARTY_PACKAGES.has(description.name)) {
            return;
        }
        const key = packageKey(description);
        if (!descriptions.has(key)) {
            descriptions.set(key, description);
            const problem = licenceProblem(description, allowed);
            if (problem) {
                problems.push(`${output} includes ${problem}`);
            }
        }
        scope.outputs.get(output).add(key);
    };

    for (const [outputPath, output] of Object.entries(metafile.outputs)) {
        if (outputPath.endsWith('.map')) {
            continue;
        }
        const location = scopeOf(path.resolve(absWorkingDir, outputPath), distRoot);
        if (!location) {
            continue;
        }
        let scope = scopes.get(location.dir);
        if (!scope) {
            scope = { dir: location.dir, outputs: new Map() };
            scopes.set(location.dir, scope);
        }
        scope.outputs.set(location.output, new Set());
        for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
            const file = bytesInOutput > 0 ? inputFile(input, absWorkingDir) : null;
            if (file) {
                include(packageRootOf(file), location.output, scope);
                for (const dir of inputAttributions.get(file) ?? []) {
                    include(dir, location.output, scope);
                }
            }
        }
        if (output.entryPoint) {
            for (const name of shipsWith) {
                let dir;
                try {
                    dir = resolvePackageDir(name, repositoryRoot);
                } catch (error) {
                    problems.push(`${location.output} ships "${name}", which cannot be resolved: ${error.message}`);
                    continue;
                }
                include(dir, location.output, scope);
            }
        }
    }

    if (problems.length > 0) {
        return problems;
    }

    for (const scope of scopes.values()) {
        const file = path.join(scope.dir, NOTICES_DOCUMENT_FILENAME);
        const document = readDocument(file) ?? emptyDocument();
        for (const [output, keys] of scope.outputs) {
            document.outputs[output] = [...keys];
            for (const key of keys) {
                const description = descriptions.get(key);
                document.packages[key] = {
                    name: description.name,
                    version: description.version,
                    license: description.license,
                    block: renderPackageBlock(description),
                };
            }
        }
        const canonical = canonicalDocument(document);
        writeFileIfChanged(file, serialiseDocument(canonical));
        if (path.basename(scope.dir) === 'runtime' && path.dirname(scope.dir) === distRoot) {
            writeFileIfChanged(path.join(scope.dir, NOTICES_FILENAME), renderDocument(canonical));
        }
    }
    if (scopes.size > 0) {
        writeStudioNotices(distRoot);
    }
    return [];
}

/**
 * The esbuild plugin every shipped bundle carries.
 *
 * It turns the metafile on and records the finished build. A build that would ship a package it may
 * not fails with the reason, in watch mode as in a one-off build. A build that writes nothing
 * (`write: false`, which is how the tests bundle) records nothing.
 *
 * @param {{ shipsWith?: string[], distRoot?: string, repositoryRoot?: string }} [options]
 *   `shipsWith` names packages the bundle's entry loads at run time from files shipped beside it,
 *   rather than inlining. `distRoot` and `repositoryRoot` default to this repository's and exist
 *   for the tests.
 * @returns {import('esbuild').Plugin}
 */
function thirdPartyNoticesPlugin(options = {}) {
    return {
        name: 'third-party-notices',
        setup(build) {
            build.initialOptions.metafile = true;
            build.onEnd(result => {
                if (build.initialOptions.write === false || result.errors.length > 0 || !result.metafile) {
                    return undefined;
                }
                const problems = recordBuild({
                    metafile: result.metafile,
                    absWorkingDir: build.initialOptions.absWorkingDir ?? process.cwd(),
                    distRoot: options.distRoot ?? defaultDistRoot,
                    shipsWith: options.shipsWith ?? [],
                    repositoryRoot: options.repositoryRoot ?? rootDir,
                });
                if (problems.length === 0) {
                    return undefined;
                }
                return {
                    errors: problems.map(problem => ({
                        text: `${problem} A person has to decide whether it may ship; ` +
                            'see ALLOWED_LICENSES in project/build/third-party-notices.js.',
                    })),
                };
            });
        },
    };
}

/**
 * Throws unless every part of Studio has recorded its notice, which is what a packaged Studio needs
 * before electron-builder copies `dist/THIRD-PARTY-NOTICES.txt` into it. A missing part means one of
 * the build scripts did not run with this plugin, and the notice would be silently incomplete.
 */
function assertStudioNoticesComplete(distRoot = defaultDistRoot) {
    const expected = ['runtime', 'main', 'windows'].map(scope => path.join(distRoot, scope));
    const pluginsDir = path.join(distRoot, 'builtin-plugins');
    if (fs.existsSync(pluginsDir)) {
        for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                expected.push(path.join(pluginsDir, entry.name));
            }
        }
    }
    const missing = expected.filter(dir => !readDocument(path.join(dir, NOTICES_DOCUMENT_FILENAME)));
    if (missing.length > 0 || !fs.existsSync(path.join(distRoot, NOTICES_FILENAME))) {
        throw new Error(
            `Third-party notices are incomplete: no ${NOTICES_DOCUMENT_FILENAME} in ` +
            `${missing.map(dir => path.relative(rootDir, dir)).join(', ') || '(none missing)'}` +
            `${fs.existsSync(path.join(distRoot, NOTICES_FILENAME)) ? '' : `, and no ${NOTICES_FILENAME}`}. ` +
            'Run the four build scripts before packaging.',
        );
    }
}

module.exports = {
    ALLOWED_LICENSES,
    FIRST_PARTY_PACKAGES,
    NOTICES_DOCUMENT_FILENAME,
    NOTICES_DOCUMENT_SCHEMA,
    NOTICES_FILENAME,
    assertStudioNoticesComplete,
    declaredLicense,
    describePackage,
    isAllowedExpression,
    licenceProblem,
    packageRootOf,
    recordBuild,
    renderNotices,
    renderPackageBlock,
    repositoryUrl,
    resolvePackageDir,
    setInputAttribution,
    thirdPartyNoticesPlugin,
};
