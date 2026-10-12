import { createHash } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreSourceChoice } from "@shared/constants/storeSource";
import {
    customStoreOrigin,
    fetchFromStore,
    readStoreCatalogue,
    storeSourceChoice,
    type StoreOrigin,
} from "./storeSource";
import { downloadDictionary, fetchDictionaryCatalogue } from "./spellcheck/dictionaryRegistryClient";
import { fetchTemplateBundle, fetchTemplateCatalogue } from "./uiTemplateRegistryClient";
import { fetchPluginCatalogue, presentPluginCatalogue } from "./pluginRegistryClient";

const OFFICIAL = "https://raw.githubusercontent.com/NarraLeaf/Plugins/master/index.json";
const ON_GITCODE = "https://api.gitcode.com/api/v5/repos/NarraLeaf/Plugins/raw/index.json?ref=master";

const choice = (preference: StoreSourceChoice["preference"], customUrl = ""): StoreSourceChoice => ({ preference, customUrl });

/** A read that answers per address after a delay, or throws. */
function scriptedRead(script: Record<string, { after: number; value?: string; error?: string }>) {
    const calls: string[] = [];
    const read = (url: string) => {
        calls.push(url);
        const step = script[url];
        if (!step) {
            return Promise.reject(new Error(`unexpected ${url}`));
        }
        return new Promise<string>((resolve, reject) => setTimeout(
            () => (step.error ? reject(new Error(step.error)) : resolve(step.value!)),
            step.after,
        ));
    };
    return { read, calls };
}

describe("readStoreCatalogue", () => {
    it("asks both hosts at once under automatic and keeps the first valid answer", async () => {
        const { read, calls } = scriptedRead({
            [OFFICIAL]: { after: 40, value: "github" },
            [ON_GITCODE]: { after: 5, value: "gitcode" },
        });
        const { value, origin } = await readStoreCatalogue({ choice: choice("auto"), officialUrl: OFFICIAL, customUrl: OFFICIAL, read });
        expect(calls).toEqual([OFFICIAL, ON_GITCODE]);
        expect(value).toBe("gitcode");
        expect(origin).toEqual({ catalogueUrl: OFFICIAL, servedUrl: ON_GITCODE, hosts: ["gitcode", "github"] });
    });

    it("does not let an invalid answer win, however fast it arrives", async () => {
        // A firewall's block page answers first; `read` refuses it, so GitHub's slower answer wins.
        const { read } = scriptedRead({
            [OFFICIAL]: { after: 30, value: "github" },
            [ON_GITCODE]: { after: 1, error: "Registry index is not valid JSON" },
        });
        const { value, origin } = await readStoreCatalogue({ choice: choice("auto"), officialUrl: OFFICIAL, customUrl: OFFICIAL, read });
        expect(value).toBe("github");
        expect(origin.hosts).toEqual(["github", "gitcode"]);
    });

    it("says what each host answered when neither can be read", async () => {
        const { read } = scriptedRead({
            [OFFICIAL]: { after: 1, error: "This operation was aborted" },
            [ON_GITCODE]: { after: 2, error: "Registry request failed (404 Not Found)" },
        });
        await expect(readStoreCatalogue({ choice: choice("auto"), officialUrl: OFFICIAL, customUrl: OFFICIAL, read }))
            .rejects.toThrow("GitHub: This operation was aborted; GitCode: Registry request failed (404 Not Found)");
    });

    it("asks only the named host, and keeps to it", async () => {
        for (const [preference, url] of [["github", OFFICIAL], ["gitcode", ON_GITCODE]] as const) {
            const { read, calls } = scriptedRead({ [url]: { after: 1, value: preference } });
            const { origin } = await readStoreCatalogue({ choice: choice(preference), officialUrl: OFFICIAL, customUrl: OFFICIAL, read });
            expect(calls).toEqual([url]);
            expect(origin.hosts).toEqual([preference]);
        }
        const { read } = scriptedRead({ [ON_GITCODE]: { after: 1, error: "down" } });
        await expect(readStoreCatalogue({ choice: choice("gitcode"), officialUrl: OFFICIAL, customUrl: OFFICIAL, read }))
            .rejects.toThrow("down");
    });

    it("reads a typed address as written under custom, and the official catalogue when none is typed", async () => {
        const typed = "http://127.0.0.1:8123/index.json";
        const first = scriptedRead({ [typed]: { after: 1, value: "local" } });
        const custom = await readStoreCatalogue({ choice: choice("custom", typed), officialUrl: OFFICIAL, customUrl: typed, read: first.read });
        expect(first.calls).toEqual([typed]);
        expect(custom.origin).toEqual(customStoreOrigin(typed));

        const second = scriptedRead({ [OFFICIAL]: { after: 1, value: "github" } });
        const official = await readStoreCatalogue({ choice: choice("custom"), officialUrl: OFFICIAL, customUrl: OFFICIAL, read: second.read });
        expect(second.calls).toEqual([OFFICIAL]);
        expect(official.origin.hosts).toEqual(["github"]);
    });
});

describe("fetchFromStore", () => {
    const PACKAGE = "https://github.com/NarraLeaf/Plugins/releases/download/acme.demo%401.0.0/acme.demo-1.0.0.zip";
    const PACKAGE_ON_GITCODE = "https://gitcode.com/NarraLeaf/Plugins/releases/download/acme.demo@1.0.0/acme.demo-1.0.0.zip";

    it("fetches from the host that served the catalogue, mapped onto it", async () => {
        const origin: StoreOrigin = { catalogueUrl: OFFICIAL, servedUrl: ON_GITCODE, hosts: ["gitcode", "github"] };
        const fetchOne = vi.fn(async (url: string) => url);
        expect(await fetchFromStore(origin, PACKAGE, fetchOne)).toEqual({ value: PACKAGE_ON_GITCODE, url: PACKAGE_ON_GITCODE });
        expect(fetchOne).toHaveBeenCalledTimes(1);
    });

    it("falls back to the other host, and puts it first for the rest of the visit", async () => {
        const origin: StoreOrigin = { catalogueUrl: OFFICIAL, servedUrl: OFFICIAL, hosts: ["github", "gitcode"] };
        const fetchOne = vi.fn(async (url: string) => {
            if (url.startsWith("https://github.com/")) {
                throw new Error("Plugin download failed (502 Bad Gateway)");
            }
            return "zip";
        });
        expect(await fetchFromStore(origin, PACKAGE, fetchOne)).toEqual({ value: "zip", url: PACKAGE_ON_GITCODE });
        expect(fetchOne.mock.calls.map(call => call[0])).toEqual([PACKAGE, PACKAGE_ON_GITCODE]);
        expect(origin.hosts).toEqual(["gitcode", "github"]);

        fetchOne.mockClear();
        await fetchFromStore(origin, PACKAGE, fetchOne);
        expect(fetchOne.mock.calls.map(call => call[0])).toEqual([PACKAGE_ON_GITCODE]);
    });

    it("reports the first host's failure when neither serves the file", async () => {
        const origin: StoreOrigin = { catalogueUrl: OFFICIAL, servedUrl: OFFICIAL, hosts: ["github", "gitcode"] };
        let count = 0;
        await expect(fetchFromStore(origin, PACKAGE, async () => {
            count += 1;
            throw new Error(`failure ${count}`);
        })).rejects.toThrow("failure 1");
        expect(origin.hosts).toEqual(["github", "gitcode"]);
    });

    it("has no fallback under a named host", async () => {
        const origin: StoreOrigin = { catalogueUrl: OFFICIAL, servedUrl: OFFICIAL, hosts: ["github"] };
        const fetchOne = vi.fn(async () => {
            throw new Error("down");
        });
        await expect(fetchFromStore(origin, PACKAGE, fetchOne)).rejects.toThrow("down");
        expect(fetchOne).toHaveBeenCalledTimes(1);
    });

    it("asks once for an address the rule leaves alone, and fetches a custom catalogue's addresses as written", async () => {
        const icon = "https://cdn.example.com/icon.png";
        const fetchOne = vi.fn(async () => {
            throw new Error("down");
        });
        await expect(fetchFromStore({ catalogueUrl: OFFICIAL, servedUrl: OFFICIAL, hosts: ["github", "gitcode"] }, icon, fetchOne))
            .rejects.toThrow("down");
        expect(fetchOne).toHaveBeenCalledTimes(1);

        const asWritten = vi.fn(async (url: string) => url);
        expect((await fetchFromStore(customStoreOrigin("http://127.0.0.1/index.json"), PACKAGE, asWritten)).url).toBe(PACKAGE);
    });
});

describe("storeSourceChoice", () => {
    it("reads the choice and the store's own typed address", () => {
        const stored: Record<string, unknown> = {
            "network.storeSource": "custom",
            "plugins.registryUrl": "  http://127.0.0.1:8123/index.json ",
        };
        expect(storeSourceChoice(key => stored[key], "plugins.registryUrl"))
            .toEqual({ preference: "custom", customUrl: "http://127.0.0.1:8123/index.json" });
        expect(storeSourceChoice(() => undefined, "uiTemplates.registryUrl")).toEqual({ preference: "auto", customUrl: "" });
    });
});

/**
 * The three stores end to end over a stubbed network: a host is "unreachable" when its requests
 * throw, the way an unresolvable or blocked host does.
 */
describe("the stores over a host that is down", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function stubNetwork(routes: Record<string, () => Response>, downHost?: string) {
        const requested: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (input: string) => {
            requested.push(input);
            if (downHost && new URL(input).hostname === downHost) {
                throw new TypeError("fetch failed");
            }
            const route = routes[input];
            return route ? route() : new Response("not found", { status: 404 });
        }));
        return requested;
    }

    const pluginIndex = JSON.stringify({
        formatVersion: 1,
        repository: "https://github.com/NarraLeaf/Plugins",
        plugins: [{
            id: "acme.demo",
            name: "Demo",
            version: "1.0.0",
            release: {
                tag: "acme.demo@1.0.0",
                page: "https://github.com/NarraLeaf/Plugins/releases/tag/acme.demo%401.0.0",
                download: "https://github.com/NarraLeaf/Plugins/releases/download/acme.demo%401.0.0/acme.demo-1.0.0.zip",
            },
        }],
    });

    it("lists the plugin store from GitHub when GitCode is unreachable, and from GitCode when GitHub is", async () => {
        const routes = {
            [OFFICIAL]: () => new Response(pluginIndex),
            [ON_GITCODE]: () => new Response(pluginIndex),
        };
        stubNetwork(routes, "api.gitcode.com");
        const fromGitHub = await fetchPluginCatalogue(choice("auto"));
        expect(fromGitHub.origin.servedUrl).toBe(OFFICIAL);
        expect(presentPluginCatalogue(fromGitHub).plugins[0].release.page)
            .toBe("https://github.com/NarraLeaf/Plugins/releases/tag/acme.demo%401.0.0");

        stubNetwork(routes, "raw.githubusercontent.com");
        const fromGitCode = await fetchPluginCatalogue(choice("auto"));
        expect(fromGitCode.origin.servedUrl).toBe(ON_GITCODE);
        expect(fromGitCode.index.plugins.map(plugin => plugin.id)).toEqual(["acme.demo"]);
        // The page the store links to is on the host the author's network reached.
        expect(presentPluginCatalogue(fromGitCode).plugins[0].release.page)
            .toBe("https://gitcode.com/NarraLeaf/Plugins/releases/acme.demo@1.0.0");
        // What main downloads stays as the catalogue wrote it, and is mapped at request time.
        expect(presentPluginCatalogue(fromGitCode).plugins[0].release.download)
            .toBe("https://github.com/NarraLeaf/Plugins/releases/download/acme.demo%401.0.0/acme.demo-1.0.0.zip");
    });

    it("fetches a template's files from the catalogue's host, falling back file by file", async () => {
        const templatesIndex = "https://raw.githubusercontent.com/NarraLeaf/UI-Templates/master/index.json";
        const templatesOnGitCode = "https://api.gitcode.com/api/v5/repos/NarraLeaf/UI-Templates/raw/index.json?ref=master";
        const entry = {
            id: "acme.title",
            name: "Title",
            version: "1.0.0",
            description: "",
            publisher: "",
            categories: [],
            path: "templates/acme.title",
            document: "ui/uidoc.json",
            graphs: "ui/uigraphs.json",
            surface: { kind: "appSurface" },
            assets: [],
            locales: {},
        };
        const index = JSON.stringify({ formatVersion: 1, repository: "", themes: [], templates: [entry] });
        const gitcodeFile = (file: string) => `https://api.gitcode.com/api/v5/repos/NarraLeaf/UI-Templates/raw/templates/acme.title/ui/${file}?ref=master`;
        const requested = stubNetwork({
            [templatesIndex]: () => new Response(index),
            [templatesOnGitCode]: () => new Response(index),
            [gitcodeFile("uidoc.json")]: () => new Response(JSON.stringify({ kind: "doc" })),
            [gitcodeFile("uigraphs.json")]: () => new Response(JSON.stringify({ kind: "graphs" })),
        }, "raw.githubusercontent.com");

        const { index: catalogue, origin } = await fetchTemplateCatalogue(choice("auto"));
        expect(origin.servedUrl).toBe(templatesOnGitCode);
        const bundle = await fetchTemplateBundle(catalogue.templates[0], origin);
        expect(bundle.document).toEqual({ kind: "doc" });
        expect(bundle.graphs).toEqual({ kind: "graphs" });
        // GitCode won the catalogue, so GitHub was never asked for the files.
        expect(requested.filter(url => url.includes("raw.githubusercontent.com/NarraLeaf/UI-Templates/master/templates"))).toEqual([]);
    });

    it("takes a dictionary from the other host when the first serves bytes the index's digest refuses", async () => {
        const dictionaryIndex = "https://raw.githubusercontent.com/NarraLeaf/Dictionaries/master/index.json";
        const good = Buffer.from("good word list");
        const stale = Buffer.from("yesterday's word list");
        const index = JSON.stringify({
            formatVersion: 1,
            repository: "",
            dictionaries: [{
                code: "en",
                name: "English",
                bytes: good.length,
                license: "MIT",
                sha256: createHash("sha256").update(good).digest("hex"),
                download: "https://raw.githubusercontent.com/NarraLeaf/Dictionaries/master/en.txt.gz",
            }],
        });
        stubNetwork({
            [dictionaryIndex]: () => new Response(index),
            "https://api.gitcode.com/api/v5/repos/NarraLeaf/Dictionaries/raw/index.json?ref=master": () => new Response(index),
            "https://raw.githubusercontent.com/NarraLeaf/Dictionaries/master/en.txt.gz": () => new Response(new Uint8Array(good)),
            "https://api.gitcode.com/api/v5/repos/NarraLeaf/Dictionaries/raw/en.txt.gz?ref=master": () => new Response(new Uint8Array(stale)),
        });
        const { index: catalogue } = await fetchDictionaryCatalogue(choice("auto"));
        const gitcodeFirst: StoreOrigin = { catalogueUrl: dictionaryIndex, servedUrl: dictionaryIndex, hosts: ["gitcode", "github"] };
        const bytes = await downloadDictionary(catalogue.dictionaries[0], gitcodeFirst);
        expect(bytes.equals(good)).toBe(true);
        expect(gitcodeFirst.hosts).toEqual(["github", "gitcode"]);
    });
});
