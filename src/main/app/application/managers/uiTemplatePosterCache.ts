import fs from "fs/promises";
import path from "path";
import { CacheNamespace, UserDataNamespace } from "@shared/types/constants";
import type { UIThemeDescriptor } from "@shared/types/uiTemplateRegistry";
import { fetchThemePreviews } from "./uiTemplateRegistryClient";

/**
 * Theme posters from the UI template store, fetched by main and kept on disk.
 *
 * Studio's renderers do not talk to the network, so the renderer never sees the
 * registry's image URL: it names a theme and gets back a `data:` URL. Same shape
 * as {@link import("./pluginIconCache").PluginIconCache}, and for the same two
 * reasons — a hostile index cannot aim an `<img>` anywhere or use one as a
 * per-user beacon, and the second look at the store is free.
 *
 * Keyed `<themeId>@<version>`, so publishing a new version of a theme fetches
 * once and every render after that is free, including across restarts. Writing a
 * version sweeps that theme's older ones, which keeps the directory bounded
 * without a separate eviction pass.
 */
export class UITemplatePosterCache {
    private readonly cacheDir: string;
    /**
     * Themes whose poster is known bad or unreachable this session. Memory-only
     * on purpose: a transient 502 should not be a permanent blank card, and a
     * restart is a cheap enough retry.
     */
    private readonly failures = new Set<string>();
    /** In-flight fetches, so a grid of themes appearing at once makes one request each. */
    private readonly inFlight = new Map<string, Promise<string | null>>();

    constructor(userDataDir: string) {
        this.cacheDir = path.join(userDataDir, UserDataNamespace.Cache, CacheNamespace.UITemplatePosters);
    }

    /**
     * Posters for these themes as `data:` URLs, skipping any the registry does
     * not give one for. One theme failing costs its own card, never the grid.
     */
    public async getMany(
        themes: UIThemeDescriptor[],
        registryUrl: string,
    ): Promise<{ id: string; dataUrl: string }[]> {
        const results = await Promise.all(
            themes.map(async theme => {
                const dataUrl = await this.get(theme, registryUrl);
                return dataUrl ? { id: theme.id, dataUrl } : null;
            }),
        );
        return results.filter((entry): entry is { id: string; dataUrl: string } => entry !== null);
    }

    private get(theme: UIThemeDescriptor, registryUrl: string): Promise<string | null> {
        const key = cacheKey(theme);
        if (this.failures.has(key)) {
            return Promise.resolve(null);
        }
        const existing = this.inFlight.get(key);
        if (existing) {
            return existing;
        }
        const pending = this.load(theme, key, registryUrl).finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, pending);
        return pending;
    }

    private async load(theme: UIThemeDescriptor, key: string, registryUrl: string): Promise<string | null> {
        if (!theme.preview) {
            return null;
        }
        const cached = await this.readCached(key);
        if (cached) {
            return cached;
        }
        const [fetched] = await fetchThemePreviews([theme], registryUrl);
        if (!fetched) {
            this.failures.add(key);
            return null;
        }
        await this.write(key, fetched.mime, fetched.dataBase64);
        return `data:${fetched.mime};base64,${fetched.dataBase64}`;
    }

    private async readCached(key: string): Promise<string | null> {
        for (const entry of await this.list()) {
            if (entry.startsWith(`${key}.`)) {
                const mime = MIME_BY_EXTENSION[path.extname(entry).slice(1).toLowerCase()];
                if (!mime) {
                    continue;
                }
                try {
                    const bytes = await fs.readFile(path.join(this.cacheDir, entry));
                    return `data:${mime};base64,${bytes.toString("base64")}`;
                } catch {
                    // A half-written or removed file is a miss, not an error.
                    return null;
                }
            }
        }
        return null;
    }

    private async write(key: string, mime: string, dataBase64: string): Promise<void> {
        const extension = EXTENSION_BY_MIME[mime];
        if (!extension) {
            return;
        }
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
            await this.sweepOlderVersions(key);
            await fs.writeFile(path.join(this.cacheDir, `${key}.${extension}`), Buffer.from(dataBase64, "base64"));
        } catch (error) {
            // A cache that cannot be written still serves; it just re-fetches.
            console.warn("[uiTemplatePosters] could not write poster", error);
        }
    }

    /** Drop this theme's other versions, so the directory tracks the registry. */
    private async sweepOlderVersions(key: string): Promise<void> {
        const themeId = key.slice(0, key.lastIndexOf("@"));
        for (const entry of await this.list()) {
            if (entry.startsWith(`${themeId}@`) && !entry.startsWith(`${key}.`)) {
                await fs.rm(path.join(this.cacheDir, entry), { force: true }).catch(() => undefined);
            }
        }
    }

    private list(): Promise<string[]> {
        return fs.readdir(this.cacheDir).catch(() => []);
    }
}

/** `<themeId>@<version>`, with anything that is not a safe file name flattened. */
function cacheKey(theme: UIThemeDescriptor): string {
    const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `${safe(theme.id)}@${safe(theme.version || "0")}`;
}

const MIME_BY_EXTENSION: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
};

const EXTENSION_BY_MIME: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
};
