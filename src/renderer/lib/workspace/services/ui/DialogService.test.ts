import { describe, expect, it } from "vitest";
import { DialogService } from "./DialogService";
import { FocusManager } from "./FocusManager";
import { UIStore } from "./UIStore";

// The real store, focus manager and service: the store's `closeDialog` is what runs a dialog's
// `onClose`, and that ordering is the thing under test. A mocked service would pass whatever it did.
function makeService() {
    const store = new UIStore();
    const service = new DialogService(store, new FocusManager());
    return { store, service };
}

function onlyDialog(store: UIStore) {
    const dialogs = store.getDialogs();
    expect(dialogs).toHaveLength(1);
    return dialogs[0];
}

function pickupDialog(service: DialogService) {
    return service.showAndWait<"import" | "replace">({
        title: "Replace existing takes",
        buttons: [
            { label: "Cancel", primary: true },
            { label: "Import as new audio", result: "import" },
            { label: "Replace takes", danger: true, result: "replace" },
        ],
        closable: true,
    });
}

describe("DialogService.showAndWait", () => {
    it("resolves with the pressed button's result and closes the dialog", async () => {
        const { store, service } = makeService();
        const answer = pickupDialog(service);

        await onlyDialog(store).buttons![2].onClick!();

        await expect(answer).resolves.toBe("replace");
        expect(store.getDialogs()).toHaveLength(0);
    });

    it("resolves with the other button's result too", async () => {
        const { store, service } = makeService();
        const answer = pickupDialog(service);

        await onlyDialog(store).buttons![1].onClick!();

        await expect(answer).resolves.toBe("import");
    });

    it("resolves undefined for a button without a result", async () => {
        const { store, service } = makeService();
        const answer = pickupDialog(service);

        await onlyDialog(store).buttons![0].onClick!();

        await expect(answer).resolves.toBeUndefined();
        expect(store.getDialogs()).toHaveLength(0);
    });

    it("resolves undefined when dismissed by the close button, Escape or the backdrop", async () => {
        const { store, service } = makeService();
        const answer = pickupDialog(service);

        // All three dismissals go through DialogContainer's onClose, which is `dialogs.close(id)`.
        service.close(onlyDialog(store).id);

        await expect(answer).resolves.toBeUndefined();
        expect(store.getDialogs()).toHaveLength(0);
    });

    it("keeps a dismissal that lands while the button's own handler is still running", async () => {
        const { store, service } = makeService();
        let finishHandler!: () => void;
        const answer = service.showAndWait<string>({
            title: "Slow",
            buttons: [{
                label: "Go",
                result: "go",
                onClick: () => new Promise<void>(done => { finishHandler = done; }),
            }],
        });
        const dialog = onlyDialog(store);

        const pressed = dialog.buttons![0].onClick!();
        service.close(dialog.id);
        finishHandler();
        await pressed;

        await expect(answer).resolves.toBeUndefined();
    });
});

describe("DialogService.confirm", () => {
    it("answers true for OK and false for a dismissal", async () => {
        const { store, service } = makeService();
        const accepted = service.confirm("Sure?");
        await onlyDialog(store).buttons![1].onClick!();
        await expect(accepted).resolves.toBe(true);

        const dismissed = service.confirm("Sure?");
        service.close(onlyDialog(store).id);
        await expect(dismissed).resolves.toBe(false);
    });
});

describe("DialogService.confirmDestructive", () => {
    it("answers true for the destructive button", async () => {
        const { store, service } = makeService();
        const answer = service.confirmDestructive("Delete?", undefined, "Delete");
        await onlyDialog(store).buttons![1].onClick!();
        await expect(answer).resolves.toBe(true);
    });
});
