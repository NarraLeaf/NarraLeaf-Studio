import { describe, expect, it } from "vitest";
import { composeVcsIdentity } from "./vcs";

/**
 * The `Name <email>` rule, which is the only place the two Sync settings become the one string
 * Lore records verbatim. Worth pinning: an identity is written into revisions that outlive the
 * machine, so a change of shape here is not a cosmetic change - it is a repository whose history
 * is attributed two different ways depending on which Studio version wrote each revision.
 */
describe("composeVcsIdentity", () => {
  it("joins a name and an email into the form every other tool writes", () => {
    expect(composeVcsIdentity("Ada Lovelace", "ada@example.com")).toBe(
      "Ada Lovelace <ada@example.com>"
    );
  });

  it("records the name alone when no email is configured", () => {
    expect(composeVcsIdentity("Ada Lovelace", "")).toBe("Ada Lovelace");
    expect(composeVcsIdentity("Ada Lovelace", undefined)).toBe("Ada Lovelace");
  });

  it("records the email alone rather than dropping the one thing that was configured", () => {
    expect(composeVcsIdentity("", "ada@example.com")).toBe("<ada@example.com>");
  });

  it("answers empty when neither is set, leaving the unconfigured identity to the caller", () => {
    // Not "NarraLeaf Studio": what an unconfigured author is called is VcsManager's decision,
    // and this function saying it would put that name in two places.
    expect(composeVcsIdentity("", "")).toBe("");
    expect(composeVcsIdentity(undefined, undefined)).toBe("");
  });

  it("trims, so a setting that is only whitespace is the same as unset", () => {
    expect(composeVcsIdentity("  Ada  ", "  ada@example.com  ")).toBe("Ada <ada@example.com>");
    expect(composeVcsIdentity("   ", "   ")).toBe("");
  });

  it("strips angle brackets out of the email instead of nesting them", () => {
    // An author who typed the git form into the email box would otherwise produce
    // `Ada <<ada@example.com>>`, which no reader of a history can split.
    expect(composeVcsIdentity("Ada", "<ada@example.com>")).toBe("Ada <ada@example.com>");
  });
});
