/**
 * Reading one account's avatar off a NarraLeaf Team server.
 *
 * A server serves avatars only to a signed-in caller (`GET /api/team/v1/avatars/{username}/{file}`),
 * and a renderer holds neither the token nor a way onto the network. So the image is read here with
 * the session's token and handed back as a `data:` URL, which an `<img>` can draw with nothing else
 * granted.
 *
 * **The path is checked before anything is fetched.** It arrives from a renderer, which took it out
 * of a profile a server sent, so it is held to the one shape avatars are served under - a username
 * and a content-addressed file name - and anything else is never requested. That also keeps this
 * from being a way to make an authenticated GET to any path on the server.
 *
 * **And the answer is checked before it is handed on.** Small, one of three image types, and its
 * bytes have to start the way that type starts: the server re-encodes what it stores, but this
 * build has no business trusting that a reply it did not ask for in that shape is an image.
 */
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type tls from "node:tls";

import { trustedCertificates } from "../vcs/authorityTrust";
import { endpointOf } from "./TeamClient";

/** The one shape an avatar is served under. The file is `<sha256>.<ext>`. */
const AVATAR_PATH = /^\/api\/team\/v1\/avatars\/[^/?#]+\/[0-9a-f]{64}\.(png|jpg|webp)$/;

/** Bigger than any avatar a server stores (it caps uploads at 2 MB before re-encoding). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const TIMEOUT_MS = 15_000;

/** Whether a path is one an avatar is served under. */
export function isAvatarPath(path: string): boolean {
    return AVATAR_PATH.test(path);
}

/** The image type the bytes themselves say they are, or null for anything else. */
export function sniffAvatarType(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 12
        && bytes.subarray(0, 4).toString("latin1") === "RIFF"
        && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
        return "image/webp";
    }
    return null;
}

export interface AvatarTarget {
    /** The server's `https://host:port`, as the session list records it. */
    readonly authUrl: string;
    readonly token: string;
    /** Where the certificate authorities the author accepted are kept. */
    readonly userDataDir: string;
    /** The profile's `avatarUrl`. Checked with {@link isAvatarPath} before anything is sent. */
    readonly path: string;
}

/** Read one avatar. Null for a path of the wrong shape, a refusal, or anything that is not an image. */
export async function fetchAvatar(target: AvatarTarget): Promise<string | null> {
    if (!isAvatarPath(target.path)) {
        return null;
    }
    const endpoint = endpointOf(target.authUrl);
    if (endpoint === null) {
        return null;
    }
    const settings: https.RequestOptions & tls.ConnectionOptions = {
        host: endpoint.host,
        port: endpoint.port,
        path: target.path,
        method: "GET",
        headers: { authorization: `Bearer ${target.token}` },
        // The same connection settings as every other request Studio makes to a Team server: the
        // certificate authorities the author accepted, and nothing from the system's store.
        rejectUnauthorized: true,
        ca: trustedCertificates(target.userDataDir),
        ALPNProtocols: ["http/1.1"],
        servername:
            /^[\d.]+$/.test(endpoint.host) || endpoint.host.includes(":") ? undefined : endpoint.host,
        agent: false,
    };

    const bytes = await new Promise<Buffer | null>((settle) => {
        const request = https.request(settings);
        request.on("error", () => settle(null));
        request.setTimeout(TIMEOUT_MS, () => {
            request.destroy();
            settle(null);
        });
        request.on("response", (response: IncomingMessage) => {
            if (response.statusCode !== 200) {
                response.resume();
                settle(null);
                return;
            }
            const pieces: Buffer[] = [];
            let length = 0;
            response.on("data", (piece: Buffer) => {
                length += piece.length;
                if (length > AVATAR_MAX_BYTES) {
                    request.destroy();
                    settle(null);
                    return;
                }
                pieces.push(piece);
            });
            response.on("end", () => settle(Buffer.concat(pieces)));
            response.on("error", () => settle(null));
        });
        request.end();
    });

    if (bytes === null || bytes.length === 0) {
        return null;
    }
    const type = sniffAvatarType(bytes);
    return type === null ? null : `data:${type};base64,${bytes.toString("base64")}`;
}
