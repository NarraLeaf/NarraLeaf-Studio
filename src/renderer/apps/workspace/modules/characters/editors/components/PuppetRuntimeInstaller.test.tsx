// @vitest-environment jsdom
/**
 * The one thing about this dialog that is not a preference: **a runtime Studio names opens on its
 * vendor's terms, every time it opens.**
 *
 * That step is the whole reason the install is a wizard rather than a file picker, and it is the only
 * place an author is told that the licence is the vendor's and that Studio downloads nothing. It used
 * to be decided once at mount, which the hosts quietly defeated — both of them keep the dialog mounted
 * for their own lifetime and pass a custom-runtime placeholder while nothing is being installed, so the
 * placeholder chose the opening step and a click on Live2D landed straight on the picker.
 *
 * Rendered the way the hosts render it, toggling `visible` and swapping `target`, because that pairing
 * is precisely what nothing else observes.
 */
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PuppetRuntimeInstaller, type PuppetRuntimeInstallTarget } from "./PuppetRuntimeInstaller";

// Keys, not prose: the assertions below are about which step is on screen, and English wording is free
// to change without this file having an opinion.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ app: { openExternal: () => undefined } }),
}));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: null }),
}));

// Stubbed so the dialog can be rendered without the privileged facade or an engine `Game` behind it.
// Nothing here is reached: no test gets as far as picking a file.
vi.mock("@/lib/workspace/services/puppet/installPuppetRuntime", () => ({
    installPrebuiltPuppetRuntime: async () => ({ backend: "", registered: [] }),
    installPuppetRuntimeFromSdk: async () => ({ backend: "", entryPath: "" }),
    pickPrebuiltRuntimeDirectory: async () => null,
    pickPrebuiltRuntimeFile: async () => null,
    pickSdkArchive: async () => null,
}));

/** What both hosts pass while nothing is being installed. */
const PLACEHOLDER: PuppetRuntimeInstallTarget = { kind: "custom" };

const LIVE2D: PuppetRuntimeInstallTarget = { kind: "known", id: "live2d" };

/** A host in the shape of the real two: the dialog stays mounted, `installing` decides the rest. */
function Host({ open }: { open: PuppetRuntimeInstallTarget | null }) {
    const [installing, setInstalling] = useState<PuppetRuntimeInstallTarget | null>(open);
    // Mirrors the hosts' own `useEffect`-free wiring: a click sets `installing`, closing clears it.
    if (installing !== open) {
        setInstalling(open);
    }
    return (
        <PuppetRuntimeInstaller
            visible={installing !== null}
            target={installing ?? PLACEHOLDER}
            onClose={() => setInstalling(null)}
            onInstalled={() => undefined}
        />
    );
}

const licenseShown = () => screen.queryByText("characters.editor.runtime.licenseAgree") !== null;
const pickerShown = () => screen.queryByText("characters.editor.runtime.sdkPick") !== null;

afterEach(cleanup);

describe("the puppet runtime installer's first step", () => {
    it("shows the licence notice the first time a known runtime is opened", () => {
        const view = render(<Host open={null} />);
        view.rerender(<Host open={LIVE2D} />);

        expect(licenseShown()).toBe(true);
        expect(pickerShown()).toBe(false);
    });

    it("shows it again when the previous open was a custom runtime", () => {
        const view = render(<Host open={null} />);
        // A custom runtime has no terms of ours and opens at the picker — which must not become the
        // step Live2D inherits.
        view.rerender(<Host open={{ kind: "custom" }} />);
        expect(licenseShown()).toBe(false);

        view.rerender(<Host open={null} />);
        view.rerender(<Host open={LIVE2D} />);

        expect(licenseShown()).toBe(true);
    });

    it("holds the picker back until the terms are agreed to", () => {
        const view = render(<Host open={null} />);
        view.rerender(<Host open={LIVE2D} />);

        const advance = () => screen.getByRole("button", { name: "common.continue" }) as HTMLButtonElement;
        expect(advance().disabled).toBe(true);

        fireEvent.click(advance());
        expect(pickerShown()).toBe(false);

        fireEvent.click(screen.getByRole("checkbox"));
        fireEvent.click(advance());
        expect(pickerShown()).toBe(true);
    });

    it("returns to the notice after being closed and opened again", () => {
        const view = render(<Host open={null} />);
        view.rerender(<Host open={LIVE2D} />);
        fireEvent.click(screen.getByRole("checkbox"));
        fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
        expect(pickerShown()).toBe(true);

        view.rerender(<Host open={null} />);
        view.rerender(<Host open={LIVE2D} />);

        expect(licenseShown()).toBe(true);
        expect(pickerShown()).toBe(false);
    });
});
