import { describe, expect, it } from "vitest";
import { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { resolveStartupProject, StartupProjectLookup } from "./startupProject";

function project(name: string, path: string): RecentlyOpenedProject {
  return { name, path, openedAt: 1 };
}

/** `directories` are the only paths that exist; everything else has to match by name. */
function lookup(
  recents: RecentlyOpenedProject[],
  directories: Record<string, string> = {}
): StartupProjectLookup {
  return {
    resolveDirectory: (candidate) => directories[candidate] ?? null,
    recentProjects: () => recents
  };
}

describe("resolveStartupProject", () => {
  it("takes a directory as given, resolved to an absolute path", () => {
    const result = resolveStartupProject(
      "demo3",
      lookup([project("Other", "D:/other")], { demo3: "D:/work/demo3" })
    );

    expect(result).toEqual({ ok: true, projectPath: "D:/work/demo3", source: "path" });
  });

  it("prefers a directory over a recent project of the same name", () => {
    // The path is the unambiguous thing to have asked for; a name is a convenience on top.
    const result = resolveStartupProject(
      "demo3",
      lookup([project("demo3", "D:/remembered/demo3")], { demo3: "D:/here/demo3" })
    );

    expect(result).toEqual({ ok: true, projectPath: "D:/here/demo3", source: "path" });
  });

  it("matches a recent project by name, ignoring case and surrounding space", () => {
    const result = resolveStartupProject(
      "  DEMO3 ",
      lookup([project("NLDemo", "D:/games/NLDemo"), project("demo3", "D:/games/demo3")])
    );

    expect(result).toEqual({ ok: true, projectPath: "D:/games/demo3", source: "recent" });
  });

  it("matches a recent project by part of its name when that is unambiguous", () => {
    const result = resolveStartupProject(
      "skel",
      lookup([
        project("NLDemo", "D:/games/NLDemo"),
        project("Skeleton Project", "D:/games/skeleton")
      ])
    );

    expect(result).toEqual({ ok: true, projectPath: "D:/games/skeleton", source: "recent" });
  });

  it("prefers an exact name over a longer one that contains it", () => {
    const result = resolveStartupProject(
      "demo",
      lookup([project("demo3", "D:/games/demo3"), project("demo", "D:/games/demo")])
    );

    expect(result).toEqual({ ok: true, projectPath: "D:/games/demo", source: "recent" });
  });

  it("refuses to guess between two projects of the same name", () => {
    const result = resolveStartupProject(
      "demo",
      lookup([project("demo", "D:/one/demo"), project("demo", "D:/two/demo")])
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("D:/one/demo");
    expect(result.ok === false && result.reason).toContain("D:/two/demo");
  });

  it("refuses to guess between two partial matches", () => {
    const result = resolveStartupProject(
      "demo",
      lookup([project("demo3", "D:/games/demo3"), project("demo-old", "D:/games/demo-old")])
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("matches 2 recent projects");
  });

  it("names what was available when nothing matches", () => {
    const result = resolveStartupProject("missing", lookup([project("NLDemo", "D:/games/NLDemo")]));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("NLDemo");
  });

  it("says the list is empty rather than listing nothing", () => {
    const result = resolveStartupProject("anything", lookup([]));

    expect(result.ok === false && result.reason).toContain("recent project list is empty");
  });

  it("falls back to the folder name for a record that lost its name", () => {
    // A history record can carry no name at all (a recovered .nlproj), and the launcher shows
    // the folder instead - so that is what a scripted launch has to be able to name.
    const nameless = { name: "", path: "D:/games/rescued", openedAt: 1 };
    const result = resolveStartupProject("rescued", lookup([nameless]));

    expect(result).toEqual({ ok: true, projectPath: "D:/games/rescued", source: "recent" });
  });

  it("rejects an empty selector", () => {
    expect(resolveStartupProject("   ", lookup([project("demo", "D:/demo")])).ok).toBe(false);
  });
});
