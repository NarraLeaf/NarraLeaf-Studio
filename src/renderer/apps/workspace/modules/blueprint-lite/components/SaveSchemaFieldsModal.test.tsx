// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveSchemaService } from "@/lib/workspace/services/saves/SaveSchemaService";
import { SaveSchemaFieldsModal } from "./SaveSchemaFieldsModal";

const workspace = vi.hoisted(() => ({ service: null as unknown as SaveSchemaService }));
vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: { services: { get: () => workspace.service } } }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ frozen: false }),
}));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, has: () => false, locale: "en" }),
}));
vi.mock("@/lib/i18n/useTranslation", () => ({
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, has: () => false, locale: "en" }),
}));

beforeEach(() => {
    vi.useFakeTimers();
    workspace.service = new SaveSchemaService();
    workspace.service.replaceSchema({ schemaVersion: 1, fields: {
        field: { id: "field", name: "Chapter", valueType: "json", defaultValue: { chapter: 1 }, storageKey: "chapter", order: 0 },
    } });
});
afterEach(() => {
    cleanup();
    workspace.service.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe("save schema editor", () => {
    it("keeps a partial JSON default while editing and commits the completed value", () => {
        render(<SaveSchemaFieldsModal isOpen onClose={() => undefined} />);
        const input = screen.getByRole("textbox", { name: "saveSchema.field.default" }) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: '{"chapter":' } });
        expect(input.value).toBe('{"chapter":');
        expect(workspace.service.getField("field")?.defaultValue).toEqual({ chapter: 1 });
        fireEvent.change(input, { target: { value: '{"chapter":2}' } });
        fireEvent.blur(input);
        expect(workspace.service.getField("field")?.defaultValue).toEqual({ chapter: 2 });
    });

    it("accepts spaces while renaming a save field", () => {
        render(<SaveSchemaFieldsModal isOpen onClose={() => undefined} />);
        const input = screen.getByRole("textbox", { name: "saveSchema.field.name" }) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "Chapter " } });
        expect(input.value).toBe("Chapter ");
        fireEvent.change(input, { target: { value: "Chapter name" } });
        fireEvent.blur(input);
        expect(workspace.service.getField("field")?.name).toBe("Chapter name");
    });

    it("restores the stored default when an unfinished JSON draft is left", () => {
        render(<SaveSchemaFieldsModal isOpen onClose={() => undefined} />);
        const input = screen.getByRole("textbox", { name: "saveSchema.field.default" }) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: '{"chapter":' } });
        fireEvent.blur(input);
        expect(workspace.service.getField("field")?.defaultValue).toEqual({ chapter: 1 });
        expect(input.value).toBe('{"chapter":1}');
    });

    it("keeps a partial number until it is valid", () => {
        workspace.service.updateField("field", { valueType: "float", defaultValue: 12 });
        render(<SaveSchemaFieldsModal isOpen onClose={() => undefined} />);
        const input = screen.getByRole("textbox", { name: "saveSchema.field.default" }) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "-" } });
        expect(workspace.service.getField("field")?.defaultValue).toBe(12);
        expect(input.value).toBe("-");
        fireEvent.change(input, { target: { value: "-1.5" } });
        fireEvent.blur(input);
        expect(workspace.service.getField("field")?.defaultValue).toBe(-1.5);
    });

    it("keeps a partial boolean until it is valid", () => {
        workspace.service.updateField("field", { valueType: "boolean", defaultValue: false });
        render(<SaveSchemaFieldsModal isOpen onClose={() => undefined} />);
        const input = screen.getByRole("textbox", { name: "saveSchema.field.default" }) as HTMLInputElement;
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "t" } });
        expect(workspace.service.getField("field")?.defaultValue).toBe(false);
        expect(input.value).toBe("t");
        fireEvent.change(input, { target: { value: "true" } });
        fireEvent.blur(input);
        expect(workspace.service.getField("field")?.defaultValue).toBe(true);
    });
});
