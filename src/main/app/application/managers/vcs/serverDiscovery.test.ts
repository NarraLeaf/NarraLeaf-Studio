import crypto from "crypto";
import fs from "fs/promises";
import https from "https";
import type { IncomingMessage, ServerResponse } from "http";
import type { AddressInfo } from "net";
import net from "net";
import os from "os";
import path from "path";
import tls from "tls";
import type { TLSSocket } from "tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VcsServerDiscovery } from "@shared/types/vcs";
// The certificate builder Studio already carries for signing Android debug builds. A
// certificate is the fixture here and node's crypto cannot mint one; the alternative was a
// second DER encoder in a test file, or a key pasted into the repository and left to expire.
import { buildSelfSignedCertificate } from "../../../../buildWorker/mobile/x509";
import { acceptedDirectory, rememberAcceptedAuthority } from "./authorityTrust";
import {
    parseServerAddress,
    probeVcsServer,
    readDiscoveryDocument,
    serverAddressForAuthUrl,
} from "./serverDiscovery";

/**
 * What one address comes to, against a server that is actually listening.
 *
 * The four answers are the point, and they cannot be told apart by reading code: an
 * untrusted certificate, a port nothing holds, and a web server that is not this one all
 * fail the same fetch. So each is produced here for real - a TLS endpoint on a loopback
 * port, with a certificate minted seconds before it is used - and the probe is asked what
 * it made of it.
 *
 * The certificates are self-signed with no subjectAltName, so the name they answer for is
 * their common name, and `localhost` is the only address the connections use. Reaching one
 * by IP would fail the name check rather than the trust check, which is a different answer
 * from the one under test.
 */

const DOCUMENT: VcsServerDiscovery = {
    protocol: 2,
    name: "team.example.lan",
    auth: { required: true, url: "https://team.example.lan:41402" },
    data: { url: "lore://team.example.lan:41337" },
    authority: { sha256: "3D:38:9F:E6" },
    version: "0.1.0",
    policy: { publishLineage: "merge" },
    capabilities: ["projects"],
};

const DISCOVERY_PATH = "/.well-known/nlteam";

/** A key and a certificate for `commonName`, good for an hour. */
function identity(commonName: string): { key: string; cert: string } {
    const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const der = buildSelfSignedCertificate({
        commonName,
        serialNumber: crypto.randomBytes(8),
        notBefore: new Date(Date.now() - 60_000),
        notAfter: new Date(Date.now() + 60 * 60_000),
        subjectPublicKeyInfoDer: Buffer.from(pair.publicKey.export({ type: "spki", format: "der" })),
        privateKey: pair.privateKey,
    });
    const base64 = der.toString("base64").replace(/(.{64})/g, "$1\n").trim();
    return {
        key: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        cert: `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`,
    };
}

interface Endpoint {
    address: string;
    /** What the endpoint negotiated, recorded while the connection is still up. */
    alpn: () => string;
    close: () => Promise<void>;
}

/**
 * Shut a server down without waiting for a client that has already gone.
 *
 * `close` waits for every connection the server is still counting, and a probe that refuses
 * a certificate hangs up in a way the server never notices - measured, one socket left
 * behind per refused handshake, and a `close` whose callback never comes.
 */
function closer(server: net.Server): () => Promise<void> {
    const open = new Set<net.Socket>();
    server.on("connection", (socket) => {
        open.add(socket);
        socket.on("close", () => open.delete(socket));
    });
    return () => new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
    });
}

/** Put a TLS server on a loopback port and answer with `handler`. */
async function serve(
    who: { key: string; cert: string },
    handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Endpoint> {
    let alpn = "";
    const server = https.createServer({ key: who.key, cert: who.cert }, (request, response) => {
        // Read here rather than after the probe answers: the socket is attached to the
        // exchange, and by the time anything is asserted it is gone.
        alpn = (request.socket as TLSSocket).alpnProtocol || "";
        handler(request, response);
    });
    const close = closer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return { address: `nlteam://localhost:${port}`, alpn: () => alpn, close };
}

/** Answer the discovery path with `body`, and everything else the way a server would. */
function serving(body: string, status = 200) {
    return (request: IncomingMessage, response: ServerResponse): void => {
        if (request.url !== DISCOVERY_PATH) {
            response.writeHead(404, { "content-type": "text/plain" });
            response.end("not found\n");
            return;
        }
        response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
        response.end(body);
    };
}

/** A loopback port with nothing on it: opened to learn a free number, then closed. */
async function silentPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
}

/** The certificate this machine is made to trust for the length of this file. */
const trusted = identity("localhost");
/** One it is not told about, which is every server the first time it is reached. */
const stranger = identity("localhost");
/**
 * One the author accepts partway through. It is its own identity rather than `stranger`
 * because accepting an authority is permanent for the rest of this file, and the tests
 * above it are asserting that the same certificate is refused.
 */
const accepted = identity("localhost");
/** A second one, so that two accepted authorities carry one subject between them. */
const alsoAccepted = identity("localhost");

let userDataDir = "";
let defaultAuthorities: string[] = [];

beforeAll(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-probe-"));
    // Standing in for the trust store an author installs an authority into. The probe reads
    // this list, so setting it is the same act the trust prompt performs, with the same
    // consequence: the answer turns from `untrusted` into `ready`.
    defaultAuthorities = tls.getCACertificates("default");
    tls.setDefaultCACertificates([trusted.cert]);
});

afterAll(async () => {
    tls.setDefaultCACertificates(defaultAuthorities);
    await fs.rm(userDataDir, { recursive: true, force: true });
});

describe("reading an address", () => {
    it("fills in the port a server listens on when the address leaves it out", () => {
        expect(parseServerAddress("nlteam://team.example.lan")).toMatchObject({
            host: "team.example.lan",
            port: 41402,
            address: "nlteam://team.example.lan:41402",
        });
        expect(parseServerAddress("nlteam://team.example.lan:8443")?.port).toBe(8443);
    });

    it("stores one server as one address, however it was typed", () => {
        // A non-special scheme keeps its case through the URL parser, so two authors typing
        // the same server would otherwise add two.
        expect(parseServerAddress("NLTeam://Team.Example.LAN:41402")?.address)
            .toBe("nlteam://team.example.lan:41402");
    });

    it("refuses everything that is not one of these addresses", () => {
        for (const address of [
            "team.example.lan",
            "https://team.example.lan:41402",
            "lore://team.example.lan:41337",
            // Host and port and nothing else: the rest of this is a browser's address bar,
            // and connecting anyway would reach somewhere nobody named.
            "nlteam://team.example.lan/projects",
            "nlteam://team.example.lan?token=x",
            "nlteam://ada@team.example.lan",
            "nlteam://team.example.lan:notaport",
            "nlteam://",
            "",
        ]) {
            expect(parseServerAddress(address), address).toBeNull();
        }
    });

    it("writes back the address of a server that was added before, from where its tokens go", () => {
        // A session records the sign-in endpoint and never the address that was typed, so
        // asking that server anything again means putting the address back together. The
        // result has to be one `parseServerAddress` accepts, or nothing can be asked.
        const address = serverAddressForAuthUrl("https://Team.Example.LAN:41402");
        expect(address).toBe("nlteam://team.example.lan:41402");
        expect(parseServerAddress(address!)).not.toBeNull();
    });

    it("fills in the port for a sign-in address that leaves it out, and refuses what is not one", () => {
        expect(serverAddressForAuthUrl("https://team.example.lan"))
            .toBe("nlteam://team.example.lan:41402");
        expect(serverAddressForAuthUrl("")).toBeNull();
        expect(serverAddressForAuthUrl("team.example.lan:41402")).toBeNull();
    });
});

describe("reading what came back", () => {
    it("says which version a server speaks when it is not this one", () => {
        // A server still on the previous protocol is refused by number, with the remedy
        // named. This build speaks 2, so 1 is the one that no longer fits.
        const answer = readDiscoveryDocument({
            status: 200,
            body: JSON.stringify({ ...DOCUMENT, protocol: 1 }),
        });
        expect(answer).toContain("version 1");
    });

    it("refuses a description with nothing to push to", () => {
        // Never typed and never shown, so a server that omits it leaves a project with
        // nowhere to send revisions and nobody to ask.
        expect(readDiscoveryDocument({
            status: 200,
            body: JSON.stringify({ ...DOCUMENT, data: { url: "  " } }),
        })).toBe("that server's description does not say where its projects live");
    });

    it("reads a description that names no capabilities as offering none", () => {
        // Every server written before the field says nothing here, and none of them is
        // broken. Recording an empty list is what keeps them addable.
        const { capabilities, ...rest } = DOCUMENT;
        expect(capabilities.length).toBeGreaterThan(0);
        expect(readDiscoveryDocument({ status: 200, body: JSON.stringify(rest) }))
            .toEqual({ ...rest, capabilities: [] });
    });

    it("keeps the capability names it does not know, and drops what is not a name", () => {
        expect(readDiscoveryDocument({
            status: 200,
            body: JSON.stringify({ ...DOCUMENT, capabilities: ["projects", 7, "", "  members  ", "projects"] }),
        })).toEqual({ ...DOCUMENT, capabilities: ["projects", "members"] });
    });

    it("refuses a description that asks for a token and does not say where", () => {
        expect(readDiscoveryDocument({
            status: 200,
            body: JSON.stringify({ ...DOCUMENT, auth: { required: true, url: "" } }),
        })).toContain("where to present");
    });
});

describe("probing an address", () => {
    it("answers ready, over HTTP/1.1, for a server this machine trusts", { timeout: 30_000 }, async () => {
        const endpoint = await serve(trusted, serving(JSON.stringify(DOCUMENT)));
        try {
            const probe = await probeVcsServer(endpoint.address, { userDataDir });
            expect(probe.kind).toBe("ready");
            if (probe.kind !== "ready") return;
            expect(probe.discovery).toEqual(DOCUMENT);
            expect(probe.address).toBe(endpoint.address);
            // The endpoint speaks gRPC over h2 on this same listener and this same
            // certificate. Negotiating h2 by default would reach that side and read nothing.
            expect(endpoint.alpn()).toBe("http/1.1");
        } finally {
            await endpoint.close();
        }
    });

    it("answers untrusted, carrying the authority and the description", { timeout: 30_000 }, async () => {
        const endpoint = await serve(stranger, serving(JSON.stringify(DOCUMENT)));
        try {
            const probe = await probeVcsServer(endpoint.address, { userDataDir });
            expect(probe.kind).toBe("untrusted");
            if (probe.kind !== "untrusted") return;

            // The fingerprint on screen has to be the one belonging to the certificate that
            // was written, because that file is what the author is offered a button to install.
            const presented = new crypto.X509Certificate(stranger.cert);
            expect(probe.authority.fingerprint).toBe(presented.fingerprint256);
            expect(probe.authority.subject).toContain("CN=localhost");
            // Nothing has vouched for it: a token names an authority and no token exists yet.
            expect(probe.authority.expected).toBe("");
            expect(await fs.readFile(probe.authority.path, "utf-8")).toBe(presented.toString());
            expect(path.dirname(probe.authority.path)).toBe(path.join(userDataDir, "vcs-authorities"));

            // Read over the connection whose certificate is the question, which is what lets
            // the prompt name the deployment rather than only the fingerprint.
            expect(probe.discovery).toEqual(DOCUMENT);
        } finally {
            await endpoint.close();
        }
    });

    it("goes on answering untrusted for an authority that was met and not accepted", { timeout: 30_000 }, async () => {
        // The first probe writes the certificate to disk, because the prompt has to name a
        // file before anybody has answered anything. Nothing may read that as an answer:
        // an author who looks at a fingerprint and refuses it must be asked again.
        const endpoint = await serve(stranger, serving(JSON.stringify(DOCUMENT)));
        try {
            expect((await probeVcsServer(endpoint.address, { userDataDir })).kind).toBe("untrusted");
            expect((await probeVcsServer(endpoint.address, { userDataDir })).kind).toBe("untrusted");
        } finally {
            await endpoint.close();
        }
    });

    it("answers ready once the author has accepted the authority, without a restart", { timeout: 30_000 }, async () => {
        // The whole of what happens when somebody presses the button, in order. What makes
        // this worth a test is the step in the middle: the platform's store is where the
        // authority actually goes, and node read that store before any of this and will
        // answer from that reading until Studio is restarted. So the answer has to come
        // from the copy Studio keeps, or a probe run a second after the press says the
        // same thing it said a second before it.
        const endpoint = await serve(accepted, serving(JSON.stringify(DOCUMENT)));
        try {
            const first = await probeVcsServer(endpoint.address, { userDataDir });
            expect(first.kind).toBe("untrusted");
            if (first.kind !== "untrusted") return;

            await rememberAcceptedAuthority(userDataDir, first.authority.path);

            const second = await probeVcsServer(endpoint.address, { userDataDir });
            expect(second.kind).toBe("ready");
            if (second.kind !== "ready") return;
            expect(second.discovery).toEqual(DOCUMENT);

            // Kept apart from the certificates every probe writes, which is what lets the
            // one above go on being refused while this one is not.
            const kept = path.join(acceptedDirectory(userDataDir), path.basename(first.authority.path));
            expect(await fs.readFile(kept, "utf-8")).toBe(new crypto.X509Certificate(accepted.cert).toString());
        } finally {
            await endpoint.close();
        }
    });

    it("keeps every authority usable where they carry one subject between them", { timeout: 30_000 }, async () => {
        // An authority here is named after the machine its server runs on, so two servers
        // on two machines called the same thing are two different keys under one name -
        // and so is a server whose storage root was made twice. Offered in one list, the
        // last of them wins the lookup and the others report themselves as never trusted:
        // measured, `DEPTH_ZERO_SELF_SIGNED_CERT`, which reads as a server nobody accepted.
        // Each store is therefore put the question on its own.
        const second = await serve(alsoAccepted, serving(JSON.stringify(DOCUMENT)));
        try {
            const first = await probeVcsServer(second.address, { userDataDir });
            expect(first.kind).toBe("untrusted");
            if (first.kind !== "untrusted") return;
            await rememberAcceptedAuthority(userDataDir, first.authority.path);
            expect((await probeVcsServer(second.address, { userDataDir })).kind).toBe("ready");
        } finally {
            await second.close();
        }

        // The one accepted before it, under the same subject, still answers.
        const earlier = await serve(accepted, serving(JSON.stringify(DOCUMENT)));
        try {
            expect((await probeVcsServer(earlier.address, { userDataDir })).kind).toBe("ready");
        } finally {
            await earlier.close();
        }

        // And so does a server the machine itself trusts, which is the one an accepted
        // authority would take down with it if the two lists were merged into one.
        const platform = await serve(trusted, serving(JSON.stringify(DOCUMENT)));
        try {
            expect((await probeVcsServer(platform.address, { userDataDir })).kind).toBe("ready");
        } finally {
            await platform.close();
        }
    });

    it("still answers untrusted where the description cannot be read", { timeout: 30_000 }, async () => {
        // TLS and nothing above it. The authority is still a decision that can be put to
        // somebody - it is the certificate that is in question, and it was presented.
        const server = tls.createServer(
            { key: stranger.key, cert: stranger.cert },
            (socket) => socket.end("not http\n"),
        );
        const close = closer(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;
        try {
            const probe = await probeVcsServer(`nlteam://localhost:${port}`, { userDataDir });
            expect(probe.kind).toBe("untrusted");
            if (probe.kind !== "untrusted") return;
            expect(probe.authority.fingerprint).toBe(new crypto.X509Certificate(stranger.cert).fingerprint256);
            expect(probe.discovery).toBeNull();
        } finally {
            await close();
        }
    });

    it("answers unreachable for a port nothing holds", { timeout: 30_000 }, async () => {
        const port = await silentPort();
        const probe = await probeVcsServer(`nlteam://localhost:${port}`, { userDataDir });
        expect(probe.kind).toBe("unreachable");
        if (probe.kind !== "unreachable") return;
        expect(probe.detail).toContain(String(port));
    });

    it("answers unreachable for a port that takes the connection and says nothing", { timeout: 30_000 }, async () => {
        // The failure with no error behind it: something accepts and never speaks, so the
        // only thing that ends this is the probe's own patience. Left unbounded it is the
        // wizard waiting forever, which is why the wait is asserted rather than assumed.
        const server = net.createServer(() => { /* accept, and answer nothing at all */ });
        const close = closer(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;
        try {
            const started = Date.now();
            const probe = await probeVcsServer(`nlteam://localhost:${port}`, { userDataDir });
            expect(probe.kind).toBe("unreachable");
            if (probe.kind !== "unreachable") return;
            expect(probe.detail).toContain("ETIMEDOUT");
            // One wait, not two: an inactivity timer restarted by the handshake spends twice
            // as long here, and the difference is what the author is sitting through.
            expect(Date.now() - started).toBeLessThan(9_000);
        } finally {
            await close();
        }
    });

    it("answers not-a-server for something that answers and is not one", { timeout: 30_000 }, async () => {
        const endpoint = await serve(trusted, serving("<!doctype html><title>hello</title>"));
        try {
            const probe = await probeVcsServer(endpoint.address, { userDataDir });
            expect(probe.kind).toBe("not-a-server");
        } finally {
            await endpoint.close();
        }
    });

    it("answers not-a-server for a TLS server with no document at that path", { timeout: 30_000 }, async () => {
        // A trusted certificate and a 404: something is there, it is simply not this.
        const endpoint = await serve(trusted, (request, response) => {
            expect(request.url).toBe(DISCOVERY_PATH);
            response.writeHead(404, { "content-type": "text/plain" });
            response.end("not found\n");
        });
        try {
            const probe = await probeVcsServer(endpoint.address, { userDataDir });
            expect(probe.kind).toBe("not-a-server");
            if (probe.kind !== "not-a-server") return;
            expect(probe.detail).toContain("404");
        } finally {
            await endpoint.close();
        }
    });

    it("refuses an address that is not one without opening anything", async () => {
        const probe = await probeVcsServer("team.example.lan:41402", { userDataDir });
        expect(probe.kind).toBe("not-a-server");
        if (probe.kind !== "not-a-server") return;
        expect(probe.detail).toContain("nlteam://");
    });
});
