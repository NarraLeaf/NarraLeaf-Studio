/**
 * The fixed rule that turns an address in a store catalogue into the same file on GitCode.
 *
 * Every catalogue (`index.json` of NarraLeaf/Plugins, NarraLeaf/UI-Templates, NarraLeaf/Dictionaries)
 * is written for GitHub, and GitCode carries each of those repositories in full - branch, tags and
 * the plugin releases' zips - so a GitHub address names a file GitCode has too, at a predictable
 * place. Mapping at the point of download, rather than publishing a second catalogue, keeps one
 * document the single truth for both hosts.
 *
 * The registry repositories copy this rule into `.github/scripts/gitcode-mirror.mjs`, which uses it
 * to check what GitCode serves; a change here is a change there.
 *
 * Measured on GitCode (2026-10):
 * - Repository files go through the raw-file API, `api.gitcode.com/api/v5/repos/<o>/<r>/raw/<path>?ref=<ref>`,
 *   which answers anonymously with the file's bytes for any path and any ref, including a tag with
 *   `@` in it. `raw.gitcode.com` is not used: it answers some files with 403 "暂不支持预览" and
 *   redirects images and archives to a placeholder picture that arrives as a 200.
 * - Release files are at the GitHub path on gitcode.com (`/releases/download/<tag>/<file>`), which
 *   redirects to its CDN. Nothing may be appended to that address: GitCode answers 404 to a release
 *   file asked for with a query string.
 */

const OWNER = "NarraLeaf";

/** The repositories GitCode carries in full, keyed lower-case (GitHub's paths are case-insensitive). */
const MIRRORED_REPOSITORIES: ReadonlyMap<string, string> = new Map([
    ["plugins", "Plugins"],
    ["ui-templates", "UI-Templates"],
    ["dictionaries", "Dictionaries"],
]);

/** encodeURIComponent, except `@`, which a path segment may carry as it is (RFC 3986 `pchar`). */
function encodeSegment(value: string): string {
    return encodeURIComponent(value).replace(/%40/g, "@");
}

function decodeSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * Where GitCode serves the file a GitHub address names, or the address unchanged when it is not a
 * file of a mirrored repository (a plugin's own homepage, a third-party host, Studio's releases).
 *
 * - `raw.githubusercontent.com/NarraLeaf/<repo>/<ref>/<path>` and `github.com/NarraLeaf/<repo>/raw/<ref>/<path>`
 *   become `api.gitcode.com/api/v5/repos/NarraLeaf/<repo>/raw/<path>?ref=<ref>`;
 * - `github.com/NarraLeaf/<repo>/releases/download/<tag>/<file>` becomes the same path on gitcode.com;
 * - `github.com/NarraLeaf/<repo>/releases/tag/<tag>` becomes `gitcode.com/NarraLeaf/<repo>/releases/<tag>`.
 */
export function gitCodeUrlFor(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }
    if (parsed.protocol !== "https:") {
        return url;
    }
    const segments = parsed.pathname.split("/").slice(1);
    if (segments.length < 3 || segments[0].toLowerCase() !== OWNER.toLowerCase()) {
        return url;
    }
    const repo = MIRRORED_REPOSITORIES.get(segments[1].toLowerCase());
    if (!repo) {
        return url;
    }
    const host = parsed.hostname.toLowerCase();
    const rest = segments.slice(2);
    const rawFile = (ref: string | undefined, pathSegments: string[]): string => {
        if (!ref || pathSegments.length === 0 || pathSegments.some(segment => segment === "")) {
            return url;
        }
        return `https://api.gitcode.com/api/v5/repos/${OWNER}/${repo}/raw/${pathSegments.join("/")}?ref=${encodeURIComponent(decodeSegment(ref))}`;
    };
    if (host === "raw.githubusercontent.com") {
        return rawFile(rest[0], rest.slice(1));
    }
    if (host !== "github.com" && host !== "www.github.com") {
        return url;
    }
    if (rest[0] === "raw") {
        return rawFile(rest[1], rest.slice(2));
    }
    if (rest[0] === "releases" && rest[1] === "download" && rest.length === 4 && rest[2] && rest[3]) {
        return `https://gitcode.com/${OWNER}/${repo}/releases/download/${encodeSegment(decodeSegment(rest[2]))}/${rest[3]}`;
    }
    if (rest[0] === "releases" && rest[1] === "tag" && rest.length === 3 && rest[2]) {
        return `https://gitcode.com/${OWNER}/${repo}/releases/${encodeSegment(decodeSegment(rest[2]))}`;
    }
    return url;
}
