import { Provider, type ResolvedUpdateFileInfo, type UpdateInfo } from "electron-updater";
// Not re-exported from the package root. electron-updater is external to the main bundle
// (project/build/main-bundles.js), so this resolves to the same module the root export comes from.
import { parseUpdateInfo, resolveFiles, type ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";

/** What `setFeedURL` is handed to read updates from one release's directory. */
export interface ReleaseDirectoryFeed {
    provider: "custom";
    updateProvider: typeof ReleaseDirectoryProvider;
    /** `.../releases/download/<tag>`, on GitHub or GitCode. */
    url: string;
}

export function releaseDirectoryFeed(url: string): ReleaseDirectoryFeed {
    return { provider: "custom", updateProvider: ReleaseDirectoryProvider, url };
}

/**
 * electron-updater reading one release's directory: `latest.yml` in it, the files it lists beside it.
 *
 * Its own `generic` provider would do, but for two things GitCode will not accept. It appends
 * `?noCache=…` to the feed's URL, and GitCode answers 404 to a release file asked for with any
 * query string. And it asks for several byte ranges in one request, which GitHub has never served;
 * one range per request is what the GitHub provider has always done, so it is what this does on
 * both hosts.
 *
 * Everything else - the sha512 check, the blockmap lookup that makes an update incremental, the
 * staged rollout - is the base class's and the updater's, unchanged.
 */
export class ReleaseDirectoryProvider extends Provider<UpdateInfo> {
    private readonly baseUrl: URL;

    constructor(options: { url: string }, _updater: unknown, runtimeOptions: ProviderRuntimeOptions) {
        super(runtimeOptions);
        this.baseUrl = new URL(options.url.endsWith("/") ? options.url : `${options.url}/`);
    }

    override get isUseMultipleRangeRequest(): boolean {
        return false;
    }

    async getLatestVersion(): Promise<UpdateInfo> {
        const channelFile = `${this.getDefaultChannelName()}.yml`;
        const url = new URL(channelFile, this.baseUrl);
        return parseUpdateInfo(await this.httpRequest(url), channelFile, url);
    }

    resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
        return resolveFiles(updateInfo, this.baseUrl);
    }
}
