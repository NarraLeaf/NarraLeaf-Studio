// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchGroupResult, SearchQueryOptions } from "@/lib/workspace/services/search/searchIndexModel";

const state = vi.hoisted(() => {
    const search = {
        ensureReady: vi.fn(async () => {}),
        search: vi.fn((_query: string, _options?: SearchQueryOptions): SearchGroupResult[] => []),
        onIndexChanged: vi.fn(() => () => {}),
    };
    const context = { services: { get: () => search } };
    return {
        context,
        plan: vi.fn(() => ({
            edits: [], occurrences: 1, blockCount: 1, sceneCount: 1, storyCount: 1,
            failures: [], applicable: true,
        })),
        apply: vi.fn(() => true),
    };
});

vi.mock("../../context", () => ({ useWorkspace: () => ({ context: state.context }) }));
vi.mock("../../registry", () => ({ useRegistry: () => ({ openEditorTab: vi.fn(), setPanelVisibility: vi.fn() }) }));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key }) }));
vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ writes: (disabled = false, title?: string) => ({ disabled, title }) }),
}));
vi.mock("@/apps/workspace/hooks/useTextFieldUndo", () => ({ useTextFieldUndo: () => () => {} }));
vi.mock("@/apps/workspace/hooks/useShortcutLabels", () => ({ useShortcutLabels: () => ({ forBinding: () => "Ctrl+Z" }) }));
vi.mock("@/lib/tooltip", () => ({ TooltipGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../assets/components/SearchBox", () => ({
    SearchBox: ({ value, onChange, inputRef, placeholder }: {
        value: string; onChange: (value: string) => void; inputRef: React.Ref<HTMLInputElement>; placeholder: string;
    }) => <input ref={inputRef} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />,
}));
vi.mock("@/lib/workspace/services/search/storyReplace", () => ({
    planStoryReplace: state.plan,
    applyStoryReplace: state.apply,
    planForEdit: vi.fn(),
}));
vi.mock("@/apps/workspace/modules/story/scene-editor/storyFindReplace", () => ({ segmentPlainText: () => "" }));
vi.mock("./searchJump", () => ({ jumpToSearchTarget: vi.fn() }));

import { SearchPanel } from "./SearchPanel";
import { indexEntries, querySearchIndex } from "@/lib/workspace/services/search/searchIndexModel";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    state.context.services.get().search.mockImplementation(() => []);
});

describe("SearchPanel replace preview", () => {
    it("disables a previous plan while the replacement and query are being replanned", async () => {
        vi.useFakeTimers();
        render(<SearchPanel />);
        await act(async () => {});
        const query = screen.getByPlaceholderText("workspace.shell.search.placeholder");
        fireEvent.change(query, { target: { value: "hello" } });
        fireEvent.click(screen.getByRole("button", { name: "workspace.shell.search.toggleReplace" }));
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
        await act(async () => { await vi.advanceTimersByTimeAsync(150); });

        const replaceAll = screen.getByRole("button", { name: /workspace.shell.search.replaceAll/ }) as HTMLButtonElement;
        expect(replaceAll.disabled).toBe(false);
        const replacement = screen.getByPlaceholderText("workspace.shell.search.replacePlaceholder");
        fireEvent.change(replacement, { target: { value: "hi" } });
        expect(replaceAll.disabled).toBe(true);
        fireEvent.click(replaceAll);
        expect(state.apply).not.toHaveBeenCalled();

        await act(async () => { await vi.advanceTimersByTimeAsync(150); });
        expect(replaceAll.disabled).toBe(false);
        expect(state.plan).toHaveBeenLastCalledWith(state.context, expect.objectContaining({ replacement: "hi" }));
        fireEvent.change(query, { target: { value: "other" } });
        expect(replaceAll.disabled).toBe(true);
        fireEvent.click(replaceAll);
        expect(state.apply).not.toHaveBeenCalled();
    });
});

it("hides the expand action once the expanded result cap has been reached", async () => {
    vi.useFakeTimers();
    const entries = indexEntries(Array.from({ length: 501 }, (_, index) => ({
        id: `asset-${index}`, group: "asset" as const, text: `Match ${index}`,
        target: { kind: "asset" as const, assetId: `${index}`, assetType: "image" },
    })));
    state.context.services.get().search.mockImplementation((query, options) => querySearchIndex(entries, query, options));
    render(<SearchPanel />);
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText("workspace.shell.search.placeholder"), { target: { value: "match" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    fireEvent.click(screen.getByRole("button", { name: "workspace.shell.search.more" }));
    expect(screen.queryByRole("button", { name: "workspace.shell.search.more" })).toBeNull();
    expect(screen.getByText("workspace.shell.search.more")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Match \d+$/ })).toHaveLength(500);
    expect(screen.queryByRole("button", { name: "Match 500" })).toBeNull();
});
