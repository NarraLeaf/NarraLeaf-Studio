import { describe, expect, it, vi } from "vitest";
import {
    applyProxyUrlToEnv,
    currentUseSystemProxy,
    envForDownloadWorker,
    proxyUrlFromPac,
    setUseSystemProxySource,
    stripProxyEnv,
    studioFetch,
} from "./downloadProxy";

describe("proxyUrlFromPac", () => {
    it("returns null for DIRECT", () => {
        expect(proxyUrlFromPac("DIRECT")).toBeNull();
    });

    it("reads the first PROXY hop as http", () => {
        expect(proxyUrlFromPac("PROXY 127.0.0.1:7897")).toBe("http://127.0.0.1:7897");
        expect(proxyUrlFromPac("PROXY 127.0.0.1:7897; DIRECT")).toBe("http://127.0.0.1:7897");
    });

    it("reads SOCKS as socks5", () => {
        expect(proxyUrlFromPac("SOCKS5 127.0.0.1:7897")).toBe("socks5://127.0.0.1:7897");
        expect(proxyUrlFromPac("SOCKS 127.0.0.1:7897")).toBe("socks5://127.0.0.1:7897");
    });

    it("returns null when the string is not a hop", () => {
        expect(proxyUrlFromPac("")).toBeNull();
        expect(proxyUrlFromPac("something else")).toBeNull();
    });
});

describe("worker env", () => {
    it("strips proxy variables so the system proxy replaces a shell's", () => {
        const stripped = stripProxyEnv({
            PATH: "/bin",
            HTTP_PROXY: "http://127.0.0.1:9",
            https_proxy: "http://127.0.0.1:9",
            ALL_PROXY: "socks5://127.0.0.1:9",
        });
        expect(stripped.PATH).toBe("/bin");
        expect(stripped.HTTP_PROXY).toBeUndefined();
        expect(stripped.https_proxy).toBeUndefined();
        expect(stripped.ALL_PROXY).toBeUndefined();
    });

    it("writes HTTP_PROXY when a proxy URL is applied", () => {
        const env = applyProxyUrlToEnv({ PATH: "/bin", HTTP_PROXY: "http://old" }, "http://127.0.0.1:7897");
        expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7897");
        expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7897");
        expect(env.NODE_USE_ENV_PROXY).toBe("1");
        expect(env.PATH).toBe("/bin");
    });

    it("does not point Node's fetch at a SOCKS proxy it cannot speak", () => {
        // undici throws on a socks5: URL in HTTPS_PROXY once NODE_USE_ENV_PROXY is set, so every
        // fetch in the worker would fail. app-builder still reads the variables and speaks SOCKS.
        const env = applyProxyUrlToEnv({ PATH: "/bin" }, "socks5://127.0.0.1:7897");
        expect(env.HTTPS_PROXY).toBe("socks5://127.0.0.1:7897");
        expect(env.NODE_USE_ENV_PROXY).toBeUndefined();
    });
});

describe("currentUseSystemProxy", () => {
    it("is off when nothing is wired", () => {
        setUseSystemProxySource(null);
        expect(currentUseSystemProxy()).toBe(false);
    });

    it("is on only for an explicit true", () => {
        setUseSystemProxySource(() => true);
        expect(currentUseSystemProxy()).toBe(true);
        setUseSystemProxySource(() => false);
        expect(currentUseSystemProxy()).toBe(false);
        setUseSystemProxySource(() => "yes");
        expect(currentUseSystemProxy()).toBe(false);
        setUseSystemProxySource(null);
    });
});

describe("studioFetch", () => {
    it("uses global fetch when the switch is off", async () => {
        setUseSystemProxySource(() => false);
        const fetchMock = vi.fn(async () => new Response("ok"));
        vi.stubGlobal("fetch", fetchMock);
        try {
            const response = await studioFetch("https://example.com/");
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(await response.text()).toBe("ok");
        } finally {
            vi.unstubAllGlobals();
            setUseSystemProxySource(null);
        }
    });
});

describe("envForDownloadWorker", () => {
    it("leaves a shell's proxy alone when the switch is off", async () => {
        // Off is what builds did before the switch existed: an exported HTTPS_PROXY reached them.
        setUseSystemProxySource(() => false);
        try {
            const env = await envForDownloadWorker({
                PATH: "/bin",
                HTTP_PROXY: "http://127.0.0.1:9",
            });
            expect(env.PATH).toBe("/bin");
            expect(env.HTTP_PROXY).toBe("http://127.0.0.1:9");
        } finally {
            setUseSystemProxySource(null);
        }
    });
});
