// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { ListContentModal } from "./ListContentModal";

vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ frozen: false }),
}));

afterEach(cleanup);

it("lets an author type and commit a JSON value through intermediate text", () => {
    const struct: UIStructDef = { id: "fields", fields: [{ id: "payload", key: "payload", type: "json" }] };
    let stored: unknown;
    function Editor() {
        const [items, setItems] = useState<unknown[]>([{ payload: null }]);
        stored = items[0];
        return (
            <ListContentModal
                isOpen onClose={() => {}} struct={struct} structId={struct.id} items={items}
                generateFieldId={() => "new"} onFieldsChange={() => {}} onShapeChange={() => {}} onItemsChange={setItems}
            />
        );
    }
    render(<Editor />);
    const input = screen.getByRole("textbox", { name: "payload" }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "{" } });
    expect(input.value).toBe("{");
    expect(stored).toEqual({ payload: null });
    fireEvent.change(input, { target: { value: '{"count":2}' } });
    expect(stored).toEqual({ payload: { count: 2 } });
    fireEvent.change(input, { target: { value: '{"count":' } });
    fireEvent.blur(input);
    expect(input.value).toBe('{"count":2}');
    expect(stored).toEqual({ payload: { count: 2 } });
});
