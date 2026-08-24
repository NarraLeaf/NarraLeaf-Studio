import { describe, expect, it } from "vitest";
import { installDocumentLanguage } from "./documentLanguage";

function host(initial: string) {
    const listeners = new Set<() => void>();
    const applied: string[] = [];
    let language = initial;
    return {
        applied,
        publish(next: string) {
            language = next;
            listeners.forEach(listener => listener());
        },
        listenerCount: () => listeners.size,
        seam: {
            getLanguage: () => language,
            subscribe: (listener: () => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            apply: (next: string) => applied.push(next),
        },
    };
}

describe("installDocumentLanguage", () => {
    it("applies the language already published when it installs", () => {
        const h = host("ja");
        installDocumentLanguage(h.seam);
        expect(h.applied).toEqual(["ja"]);
    });

    it("follows a language published after it installed", () => {
        const h = host("");
        installDocumentLanguage(h.seam);
        h.publish("zh-CN");
        expect(h.applied).toEqual(["zh-CN"]);
    });

    it("leaves the document alone while the project publishes no language", () => {
        const h = host("");
        installDocumentLanguage(h.seam);
        h.publish("");
        expect(h.applied).toEqual([]);
    });

    it("writes once for a language that is published again", () => {
        const h = host("ja");
        installDocumentLanguage(h.seam);
        h.publish("ja");
        expect(h.applied).toEqual(["ja"]);
    });

    it("ignores a locale that is not a language tag", () => {
        const h = host("Japanese (Kansai)");
        installDocumentLanguage(h.seam);
        expect(h.applied).toEqual([]);
    });

    it("stops following once uninstalled", () => {
        const h = host("en");
        const uninstall = installDocumentLanguage(h.seam);
        uninstall();
        h.publish("ja");
        expect(h.applied).toEqual(["en"]);
        expect(h.listenerCount()).toBe(0);
    });
});
