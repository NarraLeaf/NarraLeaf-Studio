/**
 * Which addresses a build may request, when the project asks for that to be a shorter list than
 * "anywhere".
 *
 * ## The three states, and why the wide one is the default
 *
 * A project's network setting is off, on, or on-with-a-list. Off is the default and the secure one:
 * the renderer is confined to the app protocol and every remote request is cancelled. Turning it on
 * means "any host", because a blueprint node an author wired up is expected to run - a Studio whose
 * default made authored graphs fail would be teaching authors to switch the safety off before they
 * had a reason to understand it. The list is the third state, chosen by teams who have a reason to
 * bound what their build can reach; nobody else pays for it.
 *
 * ## What is on the list without being written
 *
 * Nothing from the engine. A shipped game never goes to the network for an asset - assets are in
 * the pack, and a remote one was snapshotted into the project at build time - so there is no
 * engine-inferred traffic for an allowlist to have to make room for. The web export's own document
 * and `pack.json` are same-origin loads of the site itself, which is not something a list of remote
 * hosts governs.
 *
 * Plugins are the one addition, and they are not a bypass: a plugin declares the hosts it reaches
 * in `contributes.network`, the author approves them by name at install, and they appear in the
 * project's list attributed to the plugin. The author who writes the list and the author who
 * approves the plugin are the same person, so this adds no authority - but a list that silently
 * omitted them would answer "where does my game connect" wrongly, which is the only thing the list
 * is for.
 *
 * ## What is out of reach of this entirely
 *
 * A plugin sidecar. It is a child process, so it is on the other side of every renderer cage and
 * every check in this file; what bounds it is the install-time permission naming it. Any surface
 * that presents this list has to say so, or it is promising something it does not deliver.
 *
 * ## Matching
 *
 * The entries are patterns in the language `./externalLinkPattern` defines, and the match is that
 * module's - not a second implementation. That matcher exists because prefix matching is wrong here
 * (`https://store.example.com` is a prefix of `https://store.example.com.evil.test`), and writing a
 * second one for this feature would be volunteering to get that wrong again in a new place.
 *
 * Comments in English per project convention.
 */

import { isExternalLinkPatternDeclared, isValidExternalLinkPattern } from "./externalLinkPattern";

/** Schemes an entry may name. The Fetch node reaches no others, so neither does a list of them. */
export const NETWORK_ALLOWLIST_SCHEMES: readonly string[] = ["http:", "https:"];

/**
 * How much of the network a build may reach. One authored value with three positions, because
 * they are three answers to one question and a project can only be in one of them.
 *
 *  - `off` - no remote request of any kind. The secure default, and what every project starts at.
 *  - `allowlist` - only the addresses the project lists, plus what its plugins declared.
 *  - `any` - any host.
 *
 * A pack carries this beside `allowHttp`, which is the same fact split the way the runtime's two
 * enforcement layers already read it. Absent means {@link NETWORK_POLICY_ANY}, which is what every
 * pack written before this existed carries and what those builds shipped with.
 */
export type NetworkAccessPolicy = "off" | "allowlist" | "any";

export const NETWORK_POLICY_OFF: NetworkAccessPolicy = "off";
export const NETWORK_POLICY_ANY: NetworkAccessPolicy = "any";
export const NETWORK_POLICY_ALLOWLIST: NetworkAccessPolicy = "allowlist";

/** The three positions in the order a chooser lists them: least reach first. */
export const NETWORK_ACCESS_POLICIES: readonly NetworkAccessPolicy[] = [
    NETWORK_POLICY_OFF,
    NETWORK_POLICY_ALLOWLIST,
    NETWORK_POLICY_ANY,
];

/**
 * One stored value read back, or the secure position for anything this build does not recognize.
 *
 * A word from a future version reads as `off` rather than as the widest position: a project whose
 * setting cannot be understood is not one this build can vouch for, and refusing requests is the
 * failure an author notices immediately rather than the one that ships.
 */
export function normalizeNetworkAccessPolicy(raw: unknown): NetworkAccessPolicy {
    return NETWORK_ACCESS_POLICIES.includes(raw as NetworkAccessPolicy)
        ? raw as NetworkAccessPolicy
        : NETWORK_POLICY_OFF;
}

/** One plugin's declared hosts, kept attributed so a surface can say whose they are. */
export type NetworkPluginAllowlistEntry = {
    pluginId: string;
    patterns: string[];
};

/**
 * Everything a shell needs to decide one address, in the shape it travels in.
 *
 * `entries` and `plugins` are kept apart all the way down rather than merged at compile time: they
 * are removed by different acts (editing the project, uninstalling a plugin), and a merged list
 * could not tell an author which of the two an entry came from.
 */
export type NetworkAllowlist = {
    policy?: NetworkAccessPolicy;
    /** The author's own entries, in the order they were written. */
    entries?: readonly string[];
    /** Contributed by installed plugins and approved at install. */
    plugins?: readonly NetworkPluginAllowlistEntry[];
};

/**
 * One entry as it is stored: a pattern this module will later hand to the matcher, canonicalized so
 * what the author sees in the list is what the build will match.
 *
 * Null for anything that is not usable as an entry, which is what refuses it where it is typed.
 *
 * Two rules beyond "is it a pattern at all":
 *
 *  - **http(s) only.** A list entry that named another scheme would describe traffic the Fetch node
 *    refuses before this is consulted, so it could only ever mislead.
 *  - **A bare authority means the whole host.** `https://api.example.com` is stored as
 *    `https://api.example.com/*`, because an author writing a host into a network allowlist means
 *    the host, and the pattern language's plain path match would otherwise quietly restrict them to
 *    exactly `/`. Canonicalizing rather than special-casing at match time keeps the stored string
 *    and the behaviour the same document.
 *
 * `scheme://*` is refused. It is a valid pattern and it means "all of http", which is a thing this
 * project can say - by choosing {@link NETWORK_POLICY_ANY}. An entry that said it inside a list
 * would read like a restriction while being none.
 */
export function normalizeNetworkAllowlistEntry(raw: unknown): string | null {
    if (typeof raw !== "string" || !raw.trim()) {
        return null;
    }
    const text = raw.trim();
    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch {
        return null;
    }
    if (!NETWORK_ALLOWLIST_SCHEMES.includes(parsed.protocol.toLowerCase())) {
        return null;
    }
    if (!parsed.hostname || parsed.hostname === "*") {
        return null;
    }
    // Refused rather than stripped. `https://api.example.com` is what dropping the credentials from
    // `https://user:pw@api.example.com` produces, so a silent strip would store an entry the author
    // did not write and never show them that it had changed.
    if (parsed.username || parsed.password) {
        return null;
    }
    // Rebuilt from the parsed parts rather than appended to what was typed: `https://host?x=1` has
    // an empty path and a query, and a string append would produce `https://host?x=1/*`, which is a
    // different address wearing the entry's name.
    const authority = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    const namesWholeHost = parsed.pathname === "/" && !parsed.search && !parsed.hash;
    const path = namesWholeHost ? "/*" : parsed.pathname;
    const canonical = `${parsed.protocol.toLowerCase()}//${authority.toLowerCase()}`
        + `${path}${parsed.search}${parsed.hash}`;
    return isValidExternalLinkPattern(canonical) ? canonical : null;
}

/** Every usable entry, duplicates dropped, first spelling wins. */
export function normalizeNetworkAllowlistEntries(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const entries: string[] = [];
    for (const item of raw) {
        const entry = normalizeNetworkAllowlistEntry(item);
        if (entry && !entries.includes(entry)) {
            entries.push(entry);
        }
    }
    return entries;
}

/**
 * Whether this build may request `url`.
 *
 * Fails closed on anything it cannot read: an address that does not parse is not one this can vouch
 * for. The scheme check runs before the policy check so that a `file:` address is refused with the
 * same answer whether or not a list is in force - the list is about which hosts, never about which
 * schemes.
 */
export function isNetworkAddressAllowed(url: string, allowlist: NetworkAllowlist | undefined): boolean {
    let parsed: URL;
    try {
        parsed = new URL(String(url ?? "").trim());
    } catch {
        return false;
    }
    if (!NETWORK_ALLOWLIST_SCHEMES.includes(parsed.protocol.toLowerCase())) {
        return false;
    }
    if ((allowlist?.policy ?? NETWORK_POLICY_ANY) !== NETWORK_POLICY_ALLOWLIST) {
        return true;
    }
    if (isExternalLinkPatternDeclared(allowlist?.entries, parsed.href)) {
        return true;
    }
    return (allowlist?.plugins ?? []).some(
        plugin => isExternalLinkPatternDeclared(plugin.patterns, parsed.href),
    );
}

/**
 * The line every shell writes when the list is what refused a request.
 *
 * Names the list rather than the network, because an author who reads "the network is off" while
 * looking at a project whose network is plainly on goes to the wrong setting.
 */
export function networkAllowlistRefusalMessage(url: string): string {
    return `${url.trim() || "(none)"} is not on this project's network allowlist.`;
}

/**
 * The origins to put in a `connect-src`, from the same list the matcher reads.
 *
 * **Origins, not patterns.** A CSP source expression is matched by the browser, and paths in one do
 * not survive a redirect; the finer path half of an entry is enforced where the request is actually
 * made. So on the desktop shell this is the coarse outer layer of two, and on the web export - which
 * has no process behind it to hold the finer one - an entry's path scoping degrades to its host.
 * That is permissive only within a host the author already wrote down, and it is stated here because
 * a reader comparing the two shells deserves to find the difference written rather than infer it.
 *
 * Returns null when there is nothing to narrow to, i.e. the policy is not the list.
 */
export function networkAllowlistCspSources(allowlist: NetworkAllowlist | undefined): string[] | null {
    if ((allowlist?.policy ?? NETWORK_POLICY_ANY) !== NETWORK_POLICY_ALLOWLIST) {
        return null;
    }
    const sources: string[] = [];
    const all = [
        ...(allowlist?.entries ?? []),
        ...(allowlist?.plugins ?? []).flatMap(plugin => plugin.patterns),
    ];
    for (const pattern of all) {
        const source = cspSourceForPattern(pattern);
        if (source && !sources.includes(source)) {
            sources.push(source);
        }
    }
    return sources;
}

/**
 * `https://*.example.com/v1/*` -> `https://*.example.com`.
 *
 * The wildcard host label is carried through unchanged because CSP spells it the same way and means
 * the same thing by it. Null for a pattern the browser could not be handed, which is dropped rather
 * than widened: a source expression nobody can write is not one worth guessing at.
 */
function cspSourceForPattern(pattern: string): string | null {
    const text = String(pattern ?? "").trim();
    const match = /^(https?:)\/\/([^/?#]+)/i.exec(text);
    if (!match) {
        return null;
    }
    const authority = match[2];
    if (authority.includes("@")) {
        return null;
    }
    return `${match[1].toLowerCase()}//${authority.toLowerCase()}`;
}

/**
 * Just enough of a pack to answer "what may this build reach".
 *
 * Structural rather than an import of the pack type, so `@shared/types/gameRuntime` can keep
 * importing this module for its own field types without the two importing each other. Every field
 * is optional because a pack written before any of this existed has none of them, and all three
 * absences mean the same thing: the wide policy those builds shipped with.
 */
export type NetworkAllowlistDeclaringPack = {
    network?: {
        policy?: NetworkAccessPolicy;
        allowlist?: string[];
        pluginAllowlist?: NetworkPluginAllowlistEntry[];
    };
};

/** The allowlist a pack states, in the shape every decision in this module takes. */
export function packNetworkAllowlist(pack: NetworkAllowlistDeclaringPack | undefined): NetworkAllowlist {
    return {
        policy: pack?.network?.policy === NETWORK_POLICY_ALLOWLIST ? NETWORK_POLICY_ALLOWLIST : NETWORK_POLICY_ANY,
        entries: pack?.network?.allowlist ?? [],
        plugins: pack?.network?.pluginAllowlist ?? [],
    };
}
