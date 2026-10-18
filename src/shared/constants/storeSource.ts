/**
 * Where the plugin store, the UI template store and the spelling dictionaries download from.
 *
 * The three stores are three GitHub repositories (NarraLeaf/Plugins, NarraLeaf/UI-Templates,
 * NarraLeaf/Dictionaries), each with a generated `index.json` that names every file the store
 * offers. GitHub is unreachable or crawls from much of mainland China, so each repository is also
 * copied in full to GitCode (https://gitcode.com/NarraLeaf), and Studio knows both: the catalogue
 * is the same document on either side, and `gitCodeUrlFor` (`@shared/utils/storeMirror`) maps the
 * GitHub addresses inside it onto GitCode by a fixed rule.
 *
 * One choice covers all three stores, because what decides it is the author's network, not the
 * store:
 *
 * - `auto` asks both hosts for the catalogue at once and keeps the first valid answer; that host
 *   then serves the packages, icons, template files and dictionaries, and the other one takes over
 *   for any file it fails to serve.
 * - `github` / `gitcode` ask only that host.
 * - `custom` reads the addresses typed into `plugins.registryUrl` and `uiTemplates.registryUrl`,
 *   exactly as those rows always worked; an empty one is the official catalogue on GitHub, and so
 *   are the dictionaries, which have no row of their own.
 *
 * Shaped after `app.updateSource` (`@shared/constants/update`), which makes the same choice for
 * Studio's own updates.
 */

export const STORE_SOURCE_KEY = "network.storeSource";

export const STORE_SOURCE_PREFERENCES = ["auto", "github", "gitcode", "custom"] as const;

export type StoreSourcePreference = (typeof STORE_SOURCE_PREFERENCES)[number];

/** The two hosts Studio knows the stores on. */
export type StoreHost = "github" | "gitcode";

/** What the stored setting means, with anything unrecognised (including nothing) read as `auto`. */
export function readStoreSourcePreference(value: unknown): StoreSourcePreference {
    return (STORE_SOURCE_PREFERENCES as readonly unknown[]).includes(value) ? value as StoreSourcePreference : "auto";
}

/** Everything a store needs to know about where to read: the choice, and its typed address. */
export interface StoreSourceChoice {
    preference: StoreSourcePreference;
    /** The address typed for this store, read only under `custom`; empty is the official catalogue. */
    customUrl: string;
}

/**
 * The store rows whose typed address `custom` reads. Listed here because both the main process (to
 * read them) and the start-up migration below (to recognise an author who typed one) need the set.
 */
export const STORE_CUSTOM_URL_KEYS = ["plugins.registryUrl", "uiTemplates.registryUrl"] as const;

/**
 * The address the plugin registry row used to offer by name as its "China mirror": a Cloudflare
 * Worker in front of GitHub that served `index.json` and nothing else, so the store could be
 * browsed through it while every Install still went to GitHub. GitCode replaces it. Kept only so
 * a profile that chose it can be recognised and moved on; nothing fetches it.
 */
export const RETIRED_PLUGIN_REGISTRY_MIRROR_URL =
    "https://gh-mirror.mewbaka.cn/narraleaf/Plugins/blob/master/index.json";

/**
 * What a profile's stored values say the store source is, for a profile that predates the choice.
 *
 * Run once per launch by the main process, before any window exists, and a no-op once the choice
 * is stored:
 *
 * - The retired "China mirror" is removed from `plugins.registryUrl`. Its author wanted the store to
 *   work from mainland China, which is what `auto` now does for everyone, so the choice is left
 *   unstored and reads as `auto`.
 * - Any other typed registry address means the author points a store somewhere of their own; the
 *   choice is stored as `custom`, so that address keeps being read exactly as it was.
 *
 * The choice is deliberately not in `GLOBAL_STATE_DEFAULTS`: a default is written to disk the first
 * time the store opens, and then "never chosen" could not be told from "chose automatic". The
 * other side of that: resetting the choice while an address is still typed brings `custom` back at
 * the next launch, because the typed address is what this reads as the author's intent.
 */
export function storeSourceMigration(stored: Readonly<Record<string, unknown>>): {
    set: Partial<Record<typeof STORE_SOURCE_KEY, StoreSourcePreference>>;
    remove: string[];
} {
    const remove: string[] = [];
    const typed = (key: string): string => {
        const value = stored[key];
        return typeof value === "string" ? value.trim() : "";
    };
    if (typed("plugins.registryUrl") === RETIRED_PLUGIN_REGISTRY_MIRROR_URL) {
        remove.push("plugins.registryUrl");
    }
    const hasChoice = Object.prototype.hasOwnProperty.call(stored, STORE_SOURCE_KEY);
    const customTyped = STORE_CUSTOM_URL_KEYS.some(key => !remove.includes(key) && typed(key).length > 0);
    return {
        set: !hasChoice && customTyped ? { [STORE_SOURCE_KEY]: "custom" } : {},
        remove,
    };
}
