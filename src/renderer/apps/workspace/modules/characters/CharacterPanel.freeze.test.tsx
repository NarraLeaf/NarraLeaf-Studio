// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CharacterPanel } from "./CharacterPanel";

const fixture = vi.hoisted(() => {
    const show = vi.fn();
    const character = {
        listCharacter: () => [],
        listGroups: () => [{ id: "g1", name: "Cast" }],
        subscribe: () => () => undefined,
    };
    const panel = { getPanelState: () => undefined, setPanelState: vi.fn() };
    const ui = { dialogs: { show }, showNotification: vi.fn() };
    return { show, context: { services: { get: (key: string) => key === "character" ? character : key === "panelState" ? panel : ui } } };
});

vi.mock("@/apps/workspace/context", () => ({ useWorkspace: () => ({ context: fixture.context, isInitialized: true }) }));
vi.mock("@/lib/i18n", async original => ({
    ...(await original<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, formatList: (values: string[]) => values.join(", ") }),
}));
vi.mock("../../components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ frozen: true, reason: "frozen", writes: () => ({ disabled: true, "data-tip": "frozen" }) }),
    freezeContextMenuRows: (rows: unknown) => rows,
}));
vi.mock("./state/useCharacterFocus", () => ({
    useCharacterFocus: () => ({ focusedCharacterId: null, handleCharacterClick: vi.fn(), handleCharacterOpen: vi.fn(), setFocusToPanel: vi.fn() }),
}));
vi.mock("./useCharacterAvatarBake", () => ({ useCharacterAvatarBake: () => ({}) }));
vi.mock("./useAvatarAutoFrame", () => ({ useAvatarAutoFrame: () => ({ running: false, frameAll: vi.fn() }) }));
vi.mock("@/lib/components/dialogs", () => ({ createInputDialog: () => ({}) }));
vi.mock("@/lib/components/elements/Accordion", () => ({
    Accordion: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    AccordionItem: ({ title, actions, children }: { title: React.ReactNode; actions: React.ReactNode; children: React.ReactNode }) => <div>{title}{actions}{children}</div>,
}));
vi.mock("@/lib/components/elements/ContextMenu", () => ({ ContextMenu: () => null }));
vi.mock("../assets/components/SearchBox", () => ({ SearchBox: () => null }));
vi.mock("../assets/components/FilterSystem", () => ({ FilterSystem: () => null }));

afterEach(() => { cleanup(); fixture.show.mockClear(); });

describe("character creation in a frozen workspace", () => {
    it("disables the group header's add button along with the panel action", async () => {
        render(<CharacterPanel panelId="characters" />);
        const buttons = await screen.findAllByRole("button", { name: "characters.panel.addCharacter" });
        expect(buttons).toHaveLength(2);
        for (const button of buttons) {
            expect(button.matches(":disabled")).toBe(true);
            expect(button.getAttribute("data-tip")).toBe("frozen");
            fireEvent.click(button);
        }
        expect(fixture.show).not.toHaveBeenCalled();
    });
});
