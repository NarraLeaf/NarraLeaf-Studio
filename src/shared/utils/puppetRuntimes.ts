/**
 * The 2D model runtimes Studio knows by name.
 *
 * Studio ships none of their code and is not allowed to: the renderers authors want for animated
 * characters are licensed in terms a source-available, freely modifiable application cannot meet
 * (card 2026-07-27-002). What Studio *can* do is stop pretending it has never heard of them. Before
 * this table the only authoring surface was a folder name typed into a free-text field and a menu
 * entry reading "External runtime", which told an author nothing about which runtimes exist or how
 * to get one.
 *
 * So this is a table of *identity only* — what a runtime is called, which folder it lives in, where
 * the author obtains it, and what the author has to agree to. It deliberately holds no recipe: how a
 * particular runtime is turned into a loadable module is the installer's business, and keeping that
 * out of here is what lets this module stay shared between the workspace and the main process
 * without either of them learning anything about a renderer.
 *
 * Naming one is not integrating with it. Nothing here links against, downloads, or vendors a line of
 * anyone's runtime.
 */

/** A runtime Studio can name. Not an exhaustive list of what an author may install. */
export type KnownPuppetRuntimeId = "live2d" | "spine";

export const KNOWN_PUPPET_RUNTIME_IDS: readonly KnownPuppetRuntimeId[] = ["live2d", "spine"];

/**
 * How far Studio can carry the author.
 *
 * - `sdk-zip` — the author supplies the vendor's SDK archive and Studio builds the adapter from it
 *   on this machine. Required rather than chosen for Live2D: the Cubism Framework ships as
 *   TypeScript source and only the Core is redistributable, so no prebuilt adapter can legally be
 *   published by anyone but the author.
 * - `prebuilt` — the author supplies an already-built adapter and Studio validates and files it.
 */
export type PuppetRuntimeInstallMethod = "sdk-zip" | "prebuilt";

export type KnownPuppetRuntime = {
    id: KnownPuppetRuntimeId;
    /**
     * The directory under the project's `runtimes/puppet/` and the name the adapter registers with
     * the engine. These are the same string by convention and the install flow depends on it: a
     * runtime is discovered by its folder and resolved by its backend name.
     */
    backend: string;
    /**
     * The product's own name. A trademark, so it is never translated and never enters the i18n
     * catalogue — the UI reads it from here.
     */
    productName: string;
    /** Where the author gets it. Opened in their browser; Studio never fetches it. */
    vendorUrl: string;
    /** How Studio can install this one. Empty is not a legal value; see {@link PuppetRuntimeInstallMethod}. */
    methods: readonly PuppetRuntimeInstallMethod[];
};

const KNOWN_PUPPET_RUNTIMES: Readonly<Record<KnownPuppetRuntimeId, KnownPuppetRuntime>> = {
    live2d: {
        id: "live2d",
        backend: "live2d",
        productName: "Live2D Cubism",
        vendorUrl: "https://www.live2d.com/en/sdk/download/web/",
        // Only `sdk-zip`: see PuppetRuntimeInstallMethod. `prebuilt` is not offered because there is
        // nowhere legitimate to obtain a prebuilt Cubism adapter from.
        methods: ["sdk-zip"],
    },
    spine: {
        id: "spine",
        backend: "spine",
        productName: "Spine",
        vendorUrl: "https://esotericsoftware.com/spine-purchase",
        // `prebuilt` only. Integrating a Spine runtime requires the *integrator* to hold a Spine
        // Editor licence (Editor License Agreement 2.1(b); a trial does not count), and NarraLeaf
        // holds none — so Studio carries no Spine glue to build from, and the author brings their
        // own adapter. Naming the product and linking to it is not integration.
        methods: ["prebuilt"],
    },
};

export function knownPuppetRuntime(id: KnownPuppetRuntimeId): KnownPuppetRuntime {
    return KNOWN_PUPPET_RUNTIMES[id];
}

export function listKnownPuppetRuntimes(): readonly KnownPuppetRuntime[] {
    return KNOWN_PUPPET_RUNTIME_IDS.map(id => KNOWN_PUPPET_RUNTIMES[id]);
}

export function isKnownPuppetRuntimeId(value: unknown): value is KnownPuppetRuntimeId {
    return typeof value === "string" && KNOWN_PUPPET_RUNTIME_IDS.includes(value as KnownPuppetRuntimeId);
}

/**
 * The runtime a string names, or null when nothing here answers to it.
 *
 * Takes a plain `string` rather than an appearance kind or a backend name on purpose. Both of those
 * resolve through the same table, and typing the parameter as either would force this module to
 * import from the renderer's character model — which would put a shared table downstream of a
 * renderer type and make it unusable from the main process. An unrecognised name is the normal case
 * for a runtime the author wrote themselves, not an error.
 */
export function knownPuppetRuntimeFor(value: string | null | undefined): KnownPuppetRuntime | null {
    return isKnownPuppetRuntimeId(value) ? KNOWN_PUPPET_RUNTIMES[value] : null;
}
