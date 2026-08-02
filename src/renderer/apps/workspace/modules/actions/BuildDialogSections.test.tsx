import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BuildPreflightSection } from "@shared/types/gameBuild";
import type { SigningCredential } from "@shared/types/signing";
import { SECTIONS } from "./BuildDialog";
import { SigningSection } from "./BuildSigningSection";

/**
 * Guards the two things about the Signing section that cannot be seen from its
 * own file: that the dialog's rail actually shows it, and that a row appears for
 * each signable target the selection includes.
 *
 * Rendered with `renderToStaticMarkup`, so effects never run - what is being
 * checked is the shape the section takes before it has heard from the vault,
 * which is also the first thing an author sees.
 */

/**
 * Every section a preflight finding can name. Written as a total record so the
 * union growing breaks this file at compile time, and the assertion below then
 * fails until the rail grows with it - which is the failure that shipped once
 * already: `signing` findings existed with no section to render them in.
 */
const EVERY_SECTION: Record<BuildPreflightSection, true> = {
    targets: true,
    identity: true,
    content: true,
    signing: true,
    output: true,
};

const noop = () => undefined;
const neverRemoves = async (_credential: SigningCredential) => false;

describe("the build dialog's rail", () => {
    it("has a section for every section a finding can name", () => {
        expect([...SECTIONS].sort()).toEqual(Object.keys(EVERY_SECTION).sort());
    });

    it("keeps Output last, so the footer's Build button is the end of the walk", () => {
        expect(SECTIONS[SECTIONS.length - 1]).toBe("output");
    });
});

describe("SigningSection", () => {
    it("shows one row per signable target in the selection", () => {
        const markup = renderToStaticMarkup(
            <SigningSection
                platforms={["windows", "android"]}
                signing={{}}
                onChange={noop}
                onRemove={neverRemoves}
            />,
        );

        expect(markup).toContain("Windows");
        expect(markup).toContain("Android");
        // macOS signing is a later batch and must not offer a row; Linux and iOS
        // are signable but were not selected here.
        expect(markup).not.toContain("macOS");
        expect(markup).not.toContain("Linux");
        expect(markup).not.toContain("iOS");
    });

    it("says so when nothing selected can be signed", () => {
        const markup = renderToStaticMarkup(
            <SigningSection platforms={[]} signing={{}} onChange={noop} onRemove={neverRemoves} />,
        );

        expect(markup).toContain("Select a target that can be signed.");
    });

    it("renders the section's findings underneath the rows", () => {
        const markup = renderToStaticMarkup(
            <SigningSection platforms={["linux"]} signing={{}} onChange={noop} onRemove={neverRemoves}>
                <p>a finding</p>
            </SigningSection>,
        );

        expect(markup).toContain("a finding");
    });
});

// The section reaches the vault through the app bridge, which does not exist
// outside Electron. Effects do not run under static rendering, so this only has
// to be importable.
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => {
        throw new Error("the build dialog must not reach the vault while rendering");
    },
}));
