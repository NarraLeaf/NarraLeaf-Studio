import {
    readStoreSourcePreference,
    STORE_SOURCE_KEY,
    type StoreHost,
    type StoreSourceChoice,
} from "@shared/constants/storeSource";
import type { GlobalStateKeys } from "@shared/types/state/globalState";
import { gitCodeUrlFor } from "@shared/utils/storeMirror";
import { Logger } from "@shared/utils/logger";

/**
 * How the plugin store, the template store and the dictionary download pick a host.
 *
 * Every catalogue is one document on GitHub and the same document on GitCode
 * (`@shared/constants/storeSource` says why there are two). Reading one is a race under `auto`: both
 * hosts are asked at once and the first valid answer is kept, so an author whose network cannot
 * reach GitHub is not made to wait out a timeout first, and one whose network can is not slowed by
 * GitCode. The host that won serves the files the catalogue names; the other one is asked for any
 * file the winner fails to serve.
 *
 * Validity is the caller's: `read` parses and checks the document, so a captive portal or a
 * firewall's block page that answers 200 loses the race instead of winning it.
 *
 * Files are always named by their GitHub address - the one the catalogue carries, or the one a
 * relative path resolves to against the GitHub catalogue - and mapped onto GitCode at the moment of
 * the request (`gitCodeUrlFor`). The trust boundary is unchanged: the renderer still names an entry,
 * never an address, and the mapping is a fixed rule over the catalogue's own addresses.
 */

const logger = new Logger("StoreSource");

const HOST_ORDER: readonly StoreHost[] = ["github", "gitcode"];
const HOST_NAMES: Record<StoreHost, string> = { github: "GitHub", gitcode: "GitCode" };

/** Where one catalogue was read from, and so where the files it names are fetched. */
export interface StoreOrigin {
    /**
     * The catalogue's address as published: what relative paths in it resolve against. The GitHub
     * address for the official catalogue, whichever host served it; the typed one for a custom one.
     */
    readonly catalogueUrl: string;
    /** The address the catalogue was actually read from. */
    readonly servedUrl: string;
    /**
     * The hosts the catalogue's files are fetched from, best first. Empty for a custom catalogue,
     * whose addresses are fetched as written.
     *
     * Reordered in place when a file comes from the second host after the first failed, so the
     * rest of one visit to the store does not wait out the same failure file after file.
     */
    hosts: StoreHost[];
}

/** The address of a catalogue file on one host. */
export function storeUrlOn(host: StoreHost, url: string): string {
    return host === "gitcode" ? gitCodeUrlFor(url) : url;
}

/** An origin for addresses that are fetched exactly as written. */
export function customStoreOrigin(url: string): StoreOrigin {
    return { catalogueUrl: url, servedUrl: url, hosts: [] };
}

/** The store choice as global state holds it; `customKey` is the row a typed address lives in. */
export function storeSourceChoice(
    read: (key: GlobalStateKeys) => unknown,
    customKey?: "plugins.registryUrl" | "uiTemplates.registryUrl",
): StoreSourceChoice {
    const custom = customKey ? read(customKey) : "";
    return {
        preference: readStoreSourcePreference(read(STORE_SOURCE_KEY)),
        customUrl: typeof custom === "string" ? custom.trim() : "",
    };
}

/** A key for memoising a catalogue per choice: the same choice reads the same way. */
export function storeChoiceKey(choice: StoreSourceChoice): string {
    return choice.preference === "custom" ? `custom\n${choice.customUrl}` : choice.preference;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface ReadStoreCatalogueOptions<T> {
    choice: StoreSourceChoice;
    /** The official catalogue's address on GitHub. */
    officialUrl: string;
    /**
     * The catalogue under `custom`: the typed address, or `officialUrl` when none is typed. The
     * caller resolves it with its own `resolve…RegistryUrl`, which is what the row always used.
     */
    customUrl: string;
    /** Read and validate one catalogue; throws for anything that is not a usable one. */
    read: (url: string) => Promise<T>;
}

/** Read a store's catalogue from where the choice says. */
export async function readStoreCatalogue<T>(options: ReadStoreCatalogueOptions<T>): Promise<{ value: T; origin: StoreOrigin }> {
    const { choice, officialUrl, read } = options;
    const single = async (host: StoreHost): Promise<{ value: T; origin: StoreOrigin }> => {
        const url = storeUrlOn(host, officialUrl);
        return { value: await read(url), origin: { catalogueUrl: officialUrl, servedUrl: url, hosts: [host] } };
    };

    if (choice.preference === "custom") {
        const url = options.customUrl.trim() || officialUrl;
        if (url === officialUrl) {
            return single("github");
        }
        return { value: await read(url), origin: customStoreOrigin(url) };
    }
    if (choice.preference === "github" || choice.preference === "gitcode") {
        return single(choice.preference);
    }

    const attempts = HOST_ORDER.map(host => {
        const url = storeUrlOn(host, officialUrl);
        return read(url).then(value => ({ host, url, value }));
    });
    let winner: { host: StoreHost; url: string; value: T };
    try {
        winner = await Promise.any(attempts);
    } catch (error) {
        const reasons = error instanceof AggregateError ? error.errors : [error];
        throw new Error(HOST_ORDER.map((host, index) => `${HOST_NAMES[host]}: ${messageOf(reasons[index])}`).join("; "));
    }
    return {
        value: winner.value,
        origin: {
            catalogueUrl: officialUrl,
            servedUrl: winner.url,
            hosts: [winner.host, ...HOST_ORDER.filter(host => host !== winner.host)],
        },
    };
}

/**
 * Fetch one file a catalogue names, from the catalogue's hosts in order.
 *
 * `fetchOne` does the whole job for one address - download, size checks, parsing, digest - and
 * throws for anything short of a usable file, so a host that answers with the wrong bytes is passed
 * over exactly like one that does not answer. Returns the address that served it.
 */
export async function fetchFromStore<R>(
    origin: StoreOrigin,
    url: string,
    fetchOne: (url: string) => Promise<R>,
): Promise<{ value: R; url: string }> {
    if (origin.hosts.length === 0) {
        return { value: await fetchOne(url), url };
    }
    const tried = new Set<string>();
    let firstError: unknown = null;
    for (const host of [...origin.hosts]) {
        const target = storeUrlOn(host, url);
        // An address the rule leaves alone (a third-party icon) is the same request on both hosts.
        if (tried.has(target)) {
            continue;
        }
        tried.add(target);
        try {
            const value = await fetchOne(target);
            if (origin.hosts[0] !== host) {
                origin.hosts = [host, ...origin.hosts.filter(other => other !== host)];
            }
            return { value, url: target };
        } catch (error) {
            firstError ??= error;
            if (origin.hosts.length > 1) {
                logger.warn(`[Store] ${HOST_NAMES[host]} did not serve ${target}: ${messageOf(error)}`);
            }
        }
    }
    throw firstError;
}

/** A link for the author to open, on the host the catalogue came from. */
export function storeLinkOn(origin: StoreOrigin, url: string): string {
    return origin.hosts[0] === "gitcode" ? gitCodeUrlFor(url) : url;
}
