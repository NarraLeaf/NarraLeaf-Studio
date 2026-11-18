/**
 * Telling a server that turned the account away from a server that is not there.
 *
 * Against real sockets on loopback: the whole question is whether a connection is accepted.
 */
import net from "net";

import { afterEach, describe, expect, it } from "vitest";

import { dataPortOf, portAnswers } from "./portAnswers";

let server: net.Server | null = null;

afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
});

function listen(): Promise<number> {
    return new Promise((resolve) => {
        server = net.createServer((socket) => socket.destroy());
        server.listen(0, "127.0.0.1", () => resolve((server!.address() as net.AddressInfo).port));
    });
}

describe("reading the data port from an origin", () => {
    it("reads host and port from a lore origin", () => {
        expect(dataPortOf("lore://studio.example.lan:41337")).toEqual({ host: "studio.example.lan", port: 41337 });
        expect(dataPortOf("lore://[::1]:41337")).toEqual({ host: "::1", port: 41337 });
    });

    it("names nothing for an origin without a port or one that does not parse", () => {
        expect(dataPortOf("lore://studio.example.lan")).toBeNull();
        expect(dataPortOf("not an origin")).toBeNull();
    });
});

describe("asking whether the port answers", () => {
    it("says yes where something accepts the connection", async () => {
        const port = await listen();
        await expect(portAnswers(`lore://127.0.0.1:${port}`)).resolves.toBe(true);
    });

    it("says no where nothing is listening", async () => {
        const port = await listen();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
        await expect(portAnswers(`lore://127.0.0.1:${port}`)).resolves.toBe(false);
    });

    it("says no for an origin it cannot read, without trying", async () => {
        await expect(portAnswers("lore://nowhere")).resolves.toBe(false);
    });
});
