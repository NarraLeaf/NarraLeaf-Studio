import type { UpdateSourcePreference } from "@shared/constants/update";
import { compareVersions } from "./updateVersions";

/**
 * Where an update is downloaded from: GitHub, where every release is published, or GitCode, which
 * holds the same files (`.github/workflows/mirror-gitcode.yml` copies each release there).
 *
 * GitHub is unreachable or crawls from much of mainland China, and putting a proxy in front of it
 * does not help: the Cloudflare one the download page used to offer has no node there, so its
 * requests land in Los Angeles and a 300 MB installer arrives at tens of kilobytes a second.
 * GitCode serves release files from a CDN inside China and is the slow one everywhere else.
 *
 * There is no setting, because nobody can be expected to know which of the two their network
 * favours today. Both are asked for their newest version; when both have it, a few seconds of the
 * installer are downloaded from each at once and the faster one is used. When only one answers,
 * that one. Either way the bytes are checked against the sha512 in the `latest.yml` beside them,
 * so the choice is about speed, never about trust in one host over the other.
 *
 * Both are read as a release *directory* - `.../releases/download/<tag>/` - rather than through
 * electron-updater's GitHub provider, for one reason that matters a great deal on a slow network:
 * the old version's blockmap, which is what turns a full download into a ~15 MB incremental one,
 * is found by replacing the new version number with the old one in the installer's URL. That only
 * lands on a real file when the URL carries the tag.
 */

export type UpdateSourceId = Exclude<UpdateSourcePreference, "auto">;

/** What one source has to offer. */
export interface UpdateOffer {
    source: UpdateSourceId;
    /** The newest version the source holds, without the `v`. */
    version: string;
    /** The release's directory; `latest.yml` and the files it lists sit in it. */
    feedUrl: string;
    /** The installer `latest.yml` points at, used to time a short download. */
    installerUrl: string;
    /** The release's own page, for "Release notes". */
    releaseUrl: string;
}

export type UpdateFetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

const OWNER_REPO = "NarraLeaf/NarraLeaf-Studio";
const GITHUB = `https://github.com/${OWNER_REPO}`;
const GITCODE = `https://gitcode.com/${OWNER_REPO}`;
const GITCODE_LATEST_RELEASE_API = `https://api.gitcode.com/api/v5/repos/${OWNER_REPO}/releases/latest`;

/** Long enough for a slow network to answer a few hundred bytes, short enough not to stall a check. */
const ASK_TIMEOUT_MS = 15_000;
/** How long each source is timed for, and the most it is asked for in that time. */
export const PROBE_WINDOW_MS = 4_000;
export const PROBE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * `version` and `path` from a `latest.yml`. Read by hand rather than with a YAML parser: these two
 * are top-level scalars, and a proxy that answers with an HTML page instead must read as nothing.
 */
export function readFeed(text: string): { version: string; path: string } | null {
    const field = (name: string): string | null => {
        const match = new RegExp(`^${name}:[ \\t]*(.+?)[ \\t]*$`, "m").exec(text);
        return match ? match[1].replace(/^(['"])(.*)\1$/, "$2") : null;
    };
    const version = field("version");
    const file = field("path");
    return version && file ? { version, path: file } : null;
}

function offerFrom(source: UpdateSourceId, origin: string, tag: string, feedText: string): UpdateOffer | null {
    const feed = readFeed(feedText);
    // A feed that disagrees with its own tag is not one to install from.
    if (!feed || feed.version !== tag.replace(/^v/i, "")) {
        return null;
    }
    const feedUrl = `${origin}/releases/download/${tag}`;
    return {
        source,
        version: feed.version,
        feedUrl,
        installerUrl: `${feedUrl}/${encodeURIComponent(feed.path)}`,
        releaseUrl: source === "github" ? `${origin}/releases/tag/${tag}` : `${origin}/releases/${tag}`,
    };
}

async function readText(fetcher: UpdateFetch, url: string, headers?: Record<string, string>): Promise<string | null> {
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(ASK_TIMEOUT_MS) });
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return null;
    }
    return response.text();
}

/**
 * GitHub's newest release, through the `latest/download` redirect rather than the API: the API
 * allows sixty unauthenticated requests an hour per address, and a school or an office shares one.
 */
async function askGitHub(fetcher: UpdateFetch): Promise<UpdateOffer | null> {
    const text = await readText(fetcher, `${GITHUB}/releases/latest/download/latest.yml`);
    const feed = text ? readFeed(text) : null;
    return feed && text ? offerFrom("github", GITHUB, `v${feed.version}`, text) : null;
}

/**
 * GitCode's newest release. It has no `latest/download` redirect, so the tag comes from its API
 * (which answers without a token), and then the feed from the tag. A release whose feed is not
 * there yet is one still being copied, and counts as not having the version.
 */
export async function askGitCode(fetcher: UpdateFetch): Promise<UpdateOffer | null> {
    const latest = await readText(fetcher, GITCODE_LATEST_RELEASE_API);
    let tag = "";
    try {
        const payload = latest ? JSON.parse(latest) as { tag_name?: unknown } : null;
        tag = typeof payload?.tag_name === "string" ? payload.tag_name : "";
    } catch {
        return null;
    }
    if (!/^v\d+\.\d+\.\d+/.test(tag)) {
        return null;
    }
    // GitCode answers 404 to a release file asked for with any query string, so none is added.
    const text = await readText(fetcher, `${GITCODE}/releases/download/${tag}/latest.yml`);
    return text ? offerFrom("gitcode", GITCODE, tag, text) : null;
}

/**
 * Bytes per second over a short download from the start of `url`, or 0 when nothing arrived.
 *
 * Measured from the request rather than the first byte, so a source that takes seconds to connect
 * is charged for it - which is what the download would be charged too.
 */
export async function timeDownload(fetcher: UpdateFetch, url: string, windowMs = PROBE_WINDOW_MS, maxBytes = PROBE_MAX_BYTES): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), windowMs);
    const started = Date.now();
    let bytes = 0;
    try {
        const response = await fetcher(url, { headers: { Range: `bytes=0-${maxBytes - 1}` }, signal: controller.signal });
        if (!response.ok || !response.body) {
            return 0;
        }
        const reader = response.body.getReader();
        try {
            while (bytes < maxBytes) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                bytes += value.byteLength;
            }
        } finally {
            reader.cancel().catch(() => undefined);
        }
    } catch {
        // The window closing aborts the read; what arrived until then is the measurement.
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
    return (bytes * 1000) / Math.max(Date.now() - started, 1);
}

export interface ChooseUpdateSourceOptions {
    fetch: UpdateFetch;
    currentVersion: string;
    log: (message: string) => void;
    /** The source this session already settled on for a version, so a recheck does not time again. */
    remembered?: { version: string; source: UpdateSourceId } | null;
    timeDownload?: (url: string) => Promise<number>;
    /** The author's choice in Settings; `auto` or absent asks both. */
    preference?: UpdateSourcePreference;
}

/**
 * The source to update from, or null when none answered. A source chosen in Settings is the only
 * one asked: whoever picked it knows something about their network that a few seconds of timing
 * might not.
 *
 * The newest version wins: a release being copied to GitCode is briefly missing there, and an
 * update should not wait for the copy when GitHub can serve it. Only when both hold the newest
 * version, and it is newer than this one, are they timed.
 */
export async function chooseUpdateSource(options: ChooseUpdateSourceOptions): Promise<UpdateOffer | null> {
    const ask = (source: UpdateSourceId, run: () => Promise<UpdateOffer | null>) => run().catch(error => {
        options.log(`${source} did not answer: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    });
    const preference = options.preference ?? "auto";
    const offers = (await Promise.all([
        preference !== "gitcode" ? ask("github", () => askGitHub(options.fetch)) : null,
        preference !== "github" ? ask("gitcode", () => askGitCode(options.fetch)) : null,
    ])).filter((offer): offer is UpdateOffer => offer !== null);
    if (offers.length === 0) {
        return null;
    }

    const newest = offers.reduce((best, offer) => compareVersions(offer.version, best.version) > 0 ? offer : best).version;
    const holders = offers.filter(offer => compareVersions(offer.version, newest) === 0);
    if (holders.length === 1 || compareVersions(newest, options.currentVersion) <= 0) {
        return holders[0];
    }
    if (options.remembered?.version === newest) {
        const again = holders.find(offer => offer.source === options.remembered?.source);
        if (again) {
            return again;
        }
    }

    const time = options.timeDownload ?? ((url: string) => timeDownload(options.fetch, url));
    const rates = await Promise.all(holders.map(offer => time(offer.installerUrl)));
    let pick = 0;
    rates.forEach((rate, index) => {
        if (rate > rates[pick]) {
            pick = index;
        }
    });
    options.log(`${newest} from ${holders[pick].source} (${holders.map((offer, index) => `${offer.source} ${formatRate(rates[index])}`).join(", ")})`);
    return holders[pick];
}

function formatRate(bytesPerSecond: number): string {
    return bytesPerSecond >= 1024 * 1024
        ? `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
        : `${Math.round(bytesPerSecond / 1024)} KB/s`;
}
