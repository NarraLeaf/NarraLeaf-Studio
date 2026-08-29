/**
 * A WebSocket client, in the amount of it a Team session uses.
 *
 * Written here rather than taken from node's own, and the reason is one line of it: the
 * connection has to be made with **the certificate authority the author accepted**, and
 * neither the global `WebSocket` nor anything layered on `fetch` takes one. Node reads
 * the system certificate store once per process and memoises it, so a Team server trusted
 * a moment ago is invisible until Studio restarts - which is exactly the failure
 * `serverApi` already carries the PEMs by hand to avoid. A session that could not be
 * opened until a restart would be the same bug with a longer fuse.
 *
 * Everything else follows from being a client rather than a library:
 *
 *  - **The handshake is a real HTTP request**, so a refusal is a status and a sentence.
 *    A server that will not have this token answers 401 before there is any framing to
 *    read a close code with, and 401 is what an author can be told something about.
 *  - **Every frame this sends is masked**, as the specification requires of a client. The
 *    mask is four random bytes per frame from `crypto`, not a counter: it exists so that
 *    a proxy cannot be made to see attacker-chosen bytes on the wire.
 *  - **Nothing is buffered for later.** A send on a socket that has closed is dropped,
 *    and the layer above reconnects and asks again. Queueing would mean a call answered
 *    against a session that no longer exists.
 *
 * The renderer never reaches any of this. It is main-process code talking to a network,
 * which is where all of Studio's network is.
 */
import crypto from "crypto";
import tls from "tls";

import { TEAM_ANSWER_BYTES_LIMIT } from "@shared/types/team";

import { trustedCertificates } from "../vcs/authorityTrust";

/** The constant every WebSocket handshake is hashed with. Fixed by the specification. */
const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Opcodes, as the specification numbers them. */
const OPCODE = {
    continuation: 0x0,
    text: 0x1,
    close: 0x8,
    ping: 0x9,
    pong: 0xa,
} as const;

/** How long the handshake has before this gives up on the address. */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * The most one message this reads may be, which is the most a server sends in one answer.
 *
 * **A reader is bounded by what arrives, and what arrives is an answer.** The figure a
 * server accepts *from* a client is a different and much smaller one - a suggestion is the
 * largest thing this side sends, and 128 KiB has room for it and the frame around it. Set
 * to that, this refused a page of a project's overlay whose records ran past it, closed
 * the session, and closed it again on the next read after the reconnect.
 *
 * Taken from the contract rather than written out, so that a deployment which raises what
 * it composes cannot leave this client refusing what that deployment sends.
 */
export const MAX_MESSAGE_BYTES = TEAM_ANSWER_BYTES_LIMIT;

/** What reading the front of a buffer as a frame found. */
export type TeamFrameRead =
    /** Not all of it is here. Read again when more has arrived. */
    | { kind: "incomplete" }
    /** Nothing a Team server may send looks like this, and the session ends over it. */
    | { kind: "refused"; detail: string }
    /** One whole frame, and whatever followed it in the same buffer. */
    | { kind: "frame"; opcode: number; final: boolean; payload: Buffer; rest: Buffer };

/**
 * Read one frame off the front of `buffer`, admitting a payload of up to `ceiling` bytes.
 *
 * A server never masks, so there is no mask to strip. A masked frame from one would be a
 * protocol error, and it is refused rather than unmasked out of politeness.
 *
 * **A declared length past the ceiling is refused before anything is held for it**, which
 * is the whole reason the 64-bit case is checked as a `bigint`: a peer saying it is about
 * to send four gigabytes must not first become a number this tries to wait for.
 */
export function readTeamFrame(buffer: Buffer, ceiling: number): TeamFrameRead {
    if (buffer.length < 2) return { kind: "incomplete" };

    const first = buffer[0] ?? 0;
    const second = buffer[1] ?? 0;
    const final = (first & 0b1000_0000) !== 0;
    const opcode = first & 0b0000_1111;
    const masked = (second & 0b1000_0000) !== 0;
    let length = second & 0b0111_1111;
    let offset = 2;

    if (masked || (first & 0b0111_0000) !== 0) {
        return { kind: "refused", detail: "that server sent a frame this cannot read" };
    }
    if (length === 126) {
        if (buffer.length < offset + 2) return { kind: "incomplete" };
        length = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (length === 127) {
        if (buffer.length < offset + 8) return { kind: "incomplete" };
        const big = buffer.readBigUInt64BE(offset);
        if (big > BigInt(ceiling)) {
            return { kind: "refused", detail: "that server sent more than this will hold" };
        }
        length = Number(big);
        offset += 8;
    }
    if (length > ceiling) {
        return { kind: "refused", detail: "that server sent more than this will hold" };
    }
    if (buffer.length < offset + length) return { kind: "incomplete" };

    return {
        kind: "frame",
        opcode,
        final,
        payload: buffer.subarray(offset, offset + length),
        rest: buffer.subarray(offset + length),
    };
}

/** Why a socket ended. */
export interface TeamSocketClosed {
    /** One sentence, in English, for a log. */
    detail: string;
    /**
     * The HTTP status the handshake was refused with, where it got that far.
     *
     * Present only for a refusal before the upgrade. 401 is the one that matters: it says
     * the token is no longer good, and reconnecting with the same one is pointless.
     */
    status?: number;
}

export interface TeamSocketHandlers {
    /** The upgrade completed. Nothing has been said yet. */
    onOpen: () => void;
    onMessage: (text: string) => void;
    /** Called exactly once, whatever ended it - including a handshake that never opened. */
    onClose: (closed: TeamSocketClosed) => void;
}

export interface TeamSocketOptions {
    host: string;
    port: number;
    path: string;
    token: string;
    /** Where the authorities the author accepted are kept. */
    userDataDir: string;
    /** How often to ping when nothing else is being said. */
    heartbeatMs: number;
    handlers: TeamSocketHandlers;
}

/** One session's socket. */
export class TeamSocket {
    private readonly options: TeamSocketOptions;
    private socket: tls.TLSSocket | null = null;
    private pending: Buffer = Buffer.alloc(0);

    /** Set once the 101 has been read; before that everything arriving is HTTP. */
    private upgraded = false;

    /** Fragments of a message that is not finished, and how much they total. */
    private fragments: Buffer[] = [];
    private fragmentBytes = 0;

    private heartbeat: NodeJS.Timeout | undefined;
    private handshakeDeadline: NodeJS.Timeout | undefined;
    private ended = false;

    private constructor(options: TeamSocketOptions) {
        this.options = options;
    }

    /** Open one. The handlers are called as it gets anywhere. */
    static open(options: TeamSocketOptions): TeamSocket {
        const socket = new TeamSocket(options);
        socket.start();
        return socket;
    }

    get closed(): boolean {
        return this.ended;
    }

    /** Send one text message, or drop it because there is nowhere to send it. */
    send(text: string): void {
        if (this.ended || !this.upgraded) return;
        this.write(OPCODE.text, Buffer.from(text, "utf-8"));
    }

    /** Close tidily, saying why. */
    close(detail = "closed"): void {
        if (this.ended) return;
        if (this.upgraded) {
            const payload = Buffer.alloc(2);
            payload.writeUInt16BE(1000, 0);
            this.write(OPCODE.close, payload);
        }
        this.finish({ detail });
        this.socket?.end();
        this.socket?.destroy();
    }

    private start(): void {
        const key = crypto.randomBytes(16).toString("base64");
        const socket = tls.connect({
            host: this.options.host,
            port: this.options.port,
            ca: trustedCertificates(this.options.userDataDir),
            rejectUnauthorized: true,
            ALPNProtocols: ["http/1.1"],
            // An IP address is not a valid SNI name, the same reasoning as every other
            // connection Studio makes to one of these.
            servername: /^[\d.]+$/.test(this.options.host) || this.options.host.includes(":")
                ? undefined
                : this.options.host,
        });
        this.socket = socket;

        this.handshakeDeadline = setTimeout(() => {
            this.finish({ detail: `${this.options.host}:${this.options.port} did not answer` });
            socket.destroy();
        }, HANDSHAKE_TIMEOUT_MS);

        socket.setNoDelay(true);
        socket.on("secureConnect", () => {
            socket.write(
                `GET ${this.options.path} HTTP/1.1\r\n` +
                    `host: ${this.options.host}:${this.options.port}\r\n` +
                    "upgrade: websocket\r\n" +
                    "connection: Upgrade\r\n" +
                    "sec-websocket-version: 13\r\n" +
                    `sec-websocket-key: ${key}\r\n` +
                    `authorization: Bearer ${this.options.token}\r\n\r\n`,
            );
        });
        socket.on("data", (chunk: Buffer) => {
            this.pending = Buffer.concat([this.pending, chunk]);
            if (!this.upgraded) {
                if (!this.readHandshake(key)) return;
            }
            this.drain();
        });
        socket.on("error", (error: Error) => {
            this.finish({ detail: error.message });
        });
        socket.on("close", () => {
            this.finish({ detail: "the connection closed" });
        });
    }

    /**
     * Read the answer to the handshake, and say whether the upgrade happened.
     *
     * False means either "not all of it is here yet" or "it will not happen", and the
     * second of those has already ended this. The caller only has to know not to go on
     * reading frames.
     */
    private readHandshake(key: string): boolean {
        const end = this.pending.indexOf("\r\n\r\n");
        if (end === -1) {
            // A server that answers a handshake with an unbounded stream of headers is
            // one this must not hold in memory for.
            if (this.pending.length > 64 * 1024) {
                this.finish({ detail: "that server's answer to the handshake was not one" });
                this.socket?.destroy();
            }
            return false;
        }

        const head = this.pending.subarray(0, end).toString("latin1");
        this.pending = this.pending.subarray(end + 4);
        const status = Number(/^HTTP\/1\.\d (\d{3})/.exec(head)?.[1] ?? 0);

        if (status !== 101) {
            // What follows a refusal is a body, and the sentence in it is the server's
            // own. It is short by construction - see how a refusal is written on the
            // other side - so taking what has arrived is taking the whole of it.
            const said = this.pending.toString("utf-8").trim();
            this.finish({
                status,
                detail: said === "" ? `that server answered ${status}` : said,
            });
            this.socket?.destroy();
            return false;
        }

        const accepted = /sec-websocket-accept:\s*(\S+)/i.exec(head)?.[1];
        const expected = crypto.createHash("sha1").update(key + HANDSHAKE_GUID).digest("base64");
        if (accepted !== expected) {
            // Not pedantry: the accept value is the whole of the proof that what answered
            // understood the request as a WebSocket handshake rather than reflecting
            // something back at it.
            this.finish({ detail: "that server's handshake answer did not match the request" });
            this.socket?.destroy();
            return false;
        }

        clearTimeout(this.handshakeDeadline);
        this.handshakeDeadline = undefined;
        this.upgraded = true;
        this.heartbeat = setInterval(() => {
            this.write(OPCODE.ping, Buffer.alloc(0));
        }, this.options.heartbeatMs);
        this.heartbeat.unref?.();
        this.options.handlers.onOpen();
        return true;
    }

    private drain(): void {
        while (!this.ended) {
            const frame = this.readFrame();
            if (frame === undefined) return;
            this.handle(frame);
        }
    }

    /**
     * One frame, or undefined because not all of it is here or because it ended this.
     *
     * The reading itself is {@link readTeamFrame}; what is left here is what only a live
     * socket can do - move the buffer on, and end the connection over a frame that has no
     * business arriving on it.
     */
    private readFrame(): { opcode: number; payload: Buffer; final: boolean } | undefined {
        const read = readTeamFrame(this.pending, MAX_MESSAGE_BYTES);
        if (read.kind === "incomplete") return undefined;
        if (read.kind === "refused") {
            this.finish({ detail: read.detail });
            this.socket?.destroy();
            return undefined;
        }
        this.pending = read.rest;
        return { opcode: read.opcode, payload: read.payload, final: read.final };
    }

    private handle(frame: { opcode: number; payload: Buffer; final: boolean }): void {
        switch (frame.opcode) {
            case OPCODE.ping:
                this.write(OPCODE.pong, frame.payload);
                return;
            case OPCODE.pong:
                return;
            case OPCODE.close:
                this.finish({ detail: this.closeReason(frame.payload) });
                this.socket?.end();
                this.socket?.destroy();
                return;
            case OPCODE.text:
            case OPCODE.continuation: {
                this.fragmentBytes += frame.payload.length;
                if (this.fragmentBytes > MAX_MESSAGE_BYTES) {
                    this.finish({ detail: "that server sent more than this will hold" });
                    this.socket?.destroy();
                    return;
                }
                this.fragments.push(frame.payload);
                if (!frame.final) return;
                const text = Buffer.concat(this.fragments).toString("utf-8");
                this.fragments = [];
                this.fragmentBytes = 0;
                this.options.handlers.onMessage(text);
                return;
            }
            default:
                this.finish({ detail: `that server sent a frame of kind ${frame.opcode}` });
                this.socket?.destroy();
        }
    }

    /** What a close frame said, or the code alone when it said nothing. */
    private closeReason(payload: Buffer): string {
        if (payload.length < 2) return "that server closed the session";
        const said = payload.subarray(2).toString("utf-8").trim();
        return said === "" ? `that server closed the session (${payload.readUInt16BE(0)})` : said;
    }

    /** Write one frame, masked, because that is what a client does. */
    private write(opcode: number, payload: Buffer): void {
        const socket = this.socket;
        if (socket === null || socket.destroyed || socket.writableEnded) return;

        const mask = crypto.randomBytes(4);
        const masked = Buffer.allocUnsafe(payload.length);
        for (let index = 0; index < payload.length; index += 1) {
            masked[index] = (payload[index] as number) ^ (mask[index % 4] as number);
        }

        let header: Buffer;
        if (payload.length < 126) {
            header = Buffer.from([0b1000_0000 | opcode, 0b1000_0000 | payload.length]);
        } else if (payload.length < 0x1_0000) {
            header = Buffer.alloc(4);
            header[0] = 0b1000_0000 | opcode;
            header[1] = 0b1000_0000 | 126;
            header.writeUInt16BE(payload.length, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0b1000_0000 | opcode;
            header[1] = 0b1000_0000 | 127;
            header.writeBigUInt64BE(BigInt(payload.length), 2);
        }
        socket.write(Buffer.concat([header, mask, masked]));
    }

    /** Say it is over, once, whatever route got here. */
    private finish(closed: TeamSocketClosed): void {
        if (this.ended) return;
        this.ended = true;
        if (this.heartbeat !== undefined) {
            clearInterval(this.heartbeat);
            this.heartbeat = undefined;
        }
        if (this.handshakeDeadline !== undefined) {
            clearTimeout(this.handshakeDeadline);
            this.handshakeDeadline = undefined;
        }
        this.options.handlers.onClose(closed);
    }
}
