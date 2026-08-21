// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dictionary as enDictionary } from "@shared/i18n/catalog/en/dictionary";
import {
    DEFAULT_DICTIONARY_OPTIONS,
    normalizeDictionaryEntries,
    type DictionaryEntryPatch,
    type ProjectDictionaryEntry,
    type ProjectDictionaryOptions,
} from "@shared/types/dictionary";
import { DictionaryPanel } from "./DictionaryPanel";
import { DICTIONARY_PANEL_ID } from "./openDictionaryPanel";

/**
 * The panel over a dictionary that behaves like the real service: sorted, one entry per term, and
 * refusing a rename onto a term the project already writes.
 *
 * Two things are worth pinning down here and are invisible from the component's source. The fields
 * are drafts committed on blur, so a term that is half typed must not have been written yet; and a
 * rename moves the entry's identity, which the row is keyed by - the editor folding shut on the
 * keystroke that renamed a term is the failure that costs the author their place.
 */

class FakeDictionary {
    public entries: ProjectDictionaryEntry[] = [];
    public options: ProjectDictionaryOptions = { ...DEFAULT_DICTIONARY_OPTIONS };
    private readonly handlers = new Set<(entries: ProjectDictionaryEntry[]) => void>();

    public listEntries(): ProjectDictionaryEntry[] {
        return this.entries.map(entry => ({ ...entry }));
    }

    public getOptions(): ProjectDictionaryOptions {
        return { ...this.options };
    }

    public getEntry(term: string): ProjectDictionaryEntry | null {
        return this.entries.find(entry => entry.term === term) ?? null;
    }

    public hasTerm(term: string): boolean {
        return this.getEntry(term) !== null;
    }

    public addTerm(term: string): boolean {
        if (!term.trim() || this.hasTerm(term.trim())) {
            return false;
        }
        this.commit([...this.entries, { term: term.trim() }]);
        return true;
    }

    public updateEntry(term: string, patch: DictionaryEntryPatch): boolean {
        const existing = this.getEntry(term);
        if (!existing) {
            return false;
        }
        if (patch.term && patch.term !== term && this.hasTerm(patch.term)) {
            return false;
        }
        const next: ProjectDictionaryEntry = { term: patch.term ?? existing.term };
        const reading = patch.reading === undefined ? existing.reading : patch.reading ?? undefined;
        if (reading) {
            next.reading = reading;
        }
        const variants = patch.variants ?? existing.variants;
        if (variants && variants.length > 0) {
            next.variants = variants;
        }
        this.commit(this.entries.map(entry => (entry.term === term ? next : entry)));
        return true;
    }

    public removeTerm(term: string): boolean {
        if (!this.hasTerm(term)) {
            return false;
        }
        this.commit(this.entries.filter(entry => entry.term !== term));
        return true;
    }

    public setOptions(patch: Partial<ProjectDictionaryOptions>): void {
        this.options = { ...this.options, ...patch };
        this.emit();
    }

    public onEntriesChanged(handler: (entries: ProjectDictionaryEntry[]) => void): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    private commit(entries: ProjectDictionaryEntry[]): void {
        this.entries = normalizeDictionaryEntries(entries);
        this.emit();
    }

    private emit(): void {
        for (const handler of this.handlers) {
            handler(this.listEntries());
        }
    }
}

let service: FakeDictionary;

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({
        context: {
            services: {
                get: (id: string) => (id === "workspaceFreeze"
                    ? { getReason: () => null, onChanged: () => () => undefined }
                    : service),
            },
        },
        isInitialized: true,
    }),
}));

/** The jump the findings list makes, recorded rather than performed. */
const jumps: unknown[] = [];
vi.mock("../search/searchJump", () => ({
    jumpToSearchTarget: (target: unknown) => { jumps.push(target); return true; },
}));

vi.mock("@/apps/workspace/registry", () => ({
    useRegistry: () => ({ openEditorTab: () => undefined, setPanelVisibility: () => undefined }),
}));

/** The project pass. Stubbed so the panel is tested without a story library behind it. */
let scanFindings: unknown[] = [];
vi.mock("@/lib/workspace/services/dictionary/dictionaryScan", async () => {
    const actual = await vi.importActual<typeof import("@/lib/workspace/services/dictionary/dictionaryScan")>(
        "@/lib/workspace/services/dictionary/dictionaryScan",
    );
    return {
        ...actual,
        scanProjectForVariants: async (_context: unknown, _needles: unknown, options?: {
            onProgress?: (progress: { done: number; total: number }) => void;
        }) => {
            options?.onProgress?.({ done: 1, total: 1 });
            return { findings: scanFindings, scanned: 1, total: 1, complete: true };
        },
    };
});

vi.mock("@/lib/i18n", () => ({
    // The panel's own strings, resolved from the English catalog so a renamed key fails here rather
    // than rendering the key at an author.
    useTranslation: () => ({
        tn: (key: string, count: number, values?: Record<string, string | number>) => {
            const leaf = key.replace(/^dictionary\./, "").split(".")
                .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], enDictionary);
            const forms = (leaf ?? {}) as Record<string, string>;
            const text = (count === 1 ? forms.one : undefined) ?? forms.other ?? key;
            return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
        },
        t: (key: string, values?: Record<string, string>) => {
            const leaf = key.replace(/^dictionary\./, "").split(".")
                .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], enDictionary);
            const text = typeof leaf === "string" ? leaf : key;
            return values
                ? text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`)
                : text;
        },
    }),
}));

const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
    service = new FakeDictionary();
    scanFindings = [];
    jumps.length = 0;
    // jsdom has no layout and no `scrollIntoView`; nothing here asserts about it.
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
        return undefined;
    } as Element["scrollIntoView"];
});
afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    cleanup();
});

const panel = (payload?: { term?: string; revealToken?: number }) =>
    render(<DictionaryPanel panelId={DICTIONARY_PANEL_ID} payload={payload} />);

describe("the dictionary panel", () => {
    it("says there are no terms before there are any", () => {
        panel();
        expect(screen.getByText(enDictionary.empty)).toBeTruthy();
    });

    it("adds what is typed in the search box, and reveals it", async () => {
        const view = panel();

        fireEvent.change(view.container.querySelector("input") as HTMLInputElement, {
            target: { value: "Kamurocho" },
        });
        fireEvent.click(screen.getByRole("button", { name: "" }) ?? view.container.querySelector("button")!);

        await waitFor(() => expect(service.entries).toEqual([{ term: "Kamurocho" }]));
        // Revealed, so the reading can be filled in without hunting for the row.
        await waitFor(() => expect(screen.getByLabelText(enDictionary.field.reading)).toBeTruthy());
    });

    it("writes a reading when the field is left, not while it is being typed", async () => {
        service.addTerm("Kamurocho");
        panel();

        fireEvent.click(screen.getByText("Kamurocho"));
        const reading = await screen.findByLabelText(enDictionary.field.reading);

        fireEvent.change(reading, { target: { value: "かむろちょ" } });
        expect(service.getEntry("Kamurocho")?.reading).toBeUndefined();

        fireEvent.blur(reading);
        expect(service.getEntry("Kamurocho")?.reading).toBe("かむろちょ");
    });

    it("keeps the editor open on the entry a rename moved", async () => {
        service.addTerm("Kamurocho");
        panel();

        fireEvent.click(screen.getByText("Kamurocho"));
        const term = await screen.findByLabelText(enDictionary.field.term);
        fireEvent.change(term, { target: { value: "Kamuro" } });
        fireEvent.blur(term);

        await waitFor(() => expect(service.entries).toEqual([{ term: "Kamuro" }]));
        // The row is keyed by the term, so without following the rename the editor folds shut on the
        // keystroke that renamed it.
        expect(screen.getByLabelText(enDictionary.field.reading)).toBeTruthy();
    });

    it("takes one variant per line", async () => {
        service.addTerm("color");
        panel();

        fireEvent.click(screen.getByText("color"));
        const variants = await screen.findByLabelText(enDictionary.field.variants);
        fireEvent.change(variants, { target: { value: "colour\n  colr  \n\n" } });
        fireEvent.blur(variants);

        expect(service.getEntry("color")?.variants).toEqual(["colour", "colr"]);
    });

    it("unfolds the term a story row asked about", async () => {
        service.addTerm("Kamurocho");
        service.addTerm("Anyo");
        panel({ term: "Kamurocho", revealToken: 1 });

        const term = await screen.findByLabelText(enDictionary.field.term);
        expect((term as HTMLInputElement).value).toBe("Kamurocho");
    });

    it("reads the project on request, and says where each term is written the other way", async () => {
        service.addTerm("color");
        service.updateEntry("color", { variants: ["colour"] });
        scanFindings = [
            {
                term: "color",
                written: "colour",
                replacement: "color",
                preview: "The colour of the sky.",
                target: {
                    kind: "storyBlock", storyId: "s1", sceneId: "sc1", blockId: "b1",
                    storyName: "Main", sceneName: "Opening",
                },
            },
        ];
        panel();

        fireEvent.click(screen.getByText(enDictionary.check));

        // The count lands on the term, so the answer is readable without opening anything.
        await waitFor(() => expect(screen.getAllByText("1 row").length).toBeGreaterThan(0));

        fireEvent.click(screen.getByText("color"));
        const row = await screen.findByText("The colour of the sky.");
        fireEvent.click(row);
        expect(jumps).toEqual([(scanFindings[0] as { target: unknown }).target]);
    });

    it("says so when the project writes every term the project's way", async () => {
        service.addTerm("color");
        panel();

        fireEvent.click(screen.getByText(enDictionary.check));

        // Distinguishable from "not checked yet", which says nothing at all.
        await waitFor(() => expect(screen.getByText(enDictionary.checkClean)).toBeTruthy());
    });

    it("turns a check off for the whole project", () => {
        panel();

        fireEvent.click(screen.getByLabelText(enDictionary.options.checkVariants));

        expect(service.options.checkVariants).toBe(false);
    });
});
