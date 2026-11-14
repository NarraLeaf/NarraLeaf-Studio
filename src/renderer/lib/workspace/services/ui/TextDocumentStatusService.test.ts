import { describe, expect, it, vi } from "vitest";
import { TextDocumentStatusService } from "./TextDocumentStatusService";
import type { TextDocumentCommands, TextDocumentStatus } from "./textDocumentStatus";

function status(fileName = "notes.txt"): TextDocumentStatus {
    return {
        tabId: "text:notes",
        fileName,
        encoding: "utf8",
        lineEnding: "LF",
        lossy: false,
        selection: { line: 1, column: 1, characters: 0, ranges: 0 },
    };
}

function commands(): TextDocumentCommands {
    return { reopenWith: vi.fn(), saveWith: vi.fn(), setLineEnding: vi.fn() };
}

describe("TextDocumentStatusService", () => {
    it("removes an updated document when its tab unmounts", () => {
        const service = new TextDocumentStatusService();
        const onChanged = vi.fn();
        service.onChanged(onChanged);
        const dispose = service.register(status(), commands());
        const initial = service.get("text:notes");

        service.update("text:notes", { fileName: "renamed.txt" });
        expect(service.get("text:notes")).not.toBe(initial);
        expect(service.get("text:notes")?.status.fileName).toBe("renamed.txt");

        dispose();
        expect(service.has("text:notes")).toBe(false);
        expect(onChanged).toHaveBeenCalledTimes(3);
    });

    it("removes a document after its commands are replaced", () => {
        const service = new TextDocumentStatusService();
        const dispose = service.register(status(), commands());
        const replacement = commands();

        service.setCommands("text:notes", replacement);
        expect(service.get("text:notes")?.commands).toBe(replacement);
        dispose();

        expect(service.get("text:notes")).toBeUndefined();
    });

    it("keeps a newer registration when the previous tab cleans up", () => {
        const service = new TextDocumentStatusService();
        const disposeOld = service.register(status("old.txt"), commands());
        const disposeNew = service.register(status("new.txt"), commands());
        service.update("text:notes", { fileName: "current.txt" });

        disposeOld();
        expect(service.get("text:notes")?.status.fileName).toBe("current.txt");
        disposeNew();
        expect(service.has("text:notes")).toBe(false);
    });
});
