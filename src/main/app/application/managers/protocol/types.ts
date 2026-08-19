/**
 * What `app://` is allowed to do, declared once for every handler bound to it.
 *
 * `registerSchemesAsPrivileged` takes ONE decision per scheme, so these must agree across handlers -
 * a divergent copy would silently win or lose depending on registration order.
 *
 * `stream` is the one that is easy to leave out and impossible to diagnose from the symptom. Without
 * it a `<video>` or `<audio>` can only play a file small enough to arrive in the first response;
 * anything larger fails with a bare `MEDIA_ELEMENT_ERROR: Format error` on a file that `fetch`
 * returns whole and that plays perfectly from a Blob of those same bytes. Measured on this scheme: a
 * 17 KB clip played, a 121 KB clip did not.
 */
export const APP_SCHEME_PRIVILEGES: ProtocolScheme["privileges"] = {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
};

export interface ProtocolScheme {
    scheme: string;
    privileges: {
        standard?: boolean;
        secure?: boolean;
        supportFetchAPI?: boolean;
        corsEnabled?: boolean;
        stream?: boolean;
        allowServiceWorkers?: boolean;
    };
}

export interface ProtocolResponse {
    statusCode: number;
    headers: Record<string, string | string[]>;
    data: string | Buffer | ReadableStream<Uint8Array> | undefined;
}

export interface ProtocolHandler {
    readonly scheme: string;
    readonly privileges: ProtocolScheme["privileges"];
    canHandle(url: URL): boolean;
    handle(request: Request): Promise<ProtocolResponse>;
}

export interface AssetResolver {
    resolve(url: string): AssetResolved | null;
}

export interface AssetResolved {
    path: string;
    noCache: boolean;
}

export interface ProtocolRule {
    include: string | RegExp | ((requested: string) => boolean);
    exclude?: string | RegExp | ((requested: string) => boolean);
    handler: (requested: string) => AssetResolved;
}

export interface ProtocolManager {
    registerHandler(handler: ProtocolHandler): void;
    unregisterHandler(scheme: string): void;
    getHandler(url: URL): ProtocolHandler | undefined;
} 