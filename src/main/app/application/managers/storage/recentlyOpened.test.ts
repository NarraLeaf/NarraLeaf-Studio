import { describe, expect, it } from "vitest";
import type { GlobalState } from "@shared/types/state/globalState";
import { RecentlyOpened } from "./recentlyOpened";

function stateWith(recents: unknown, limit: unknown = 10): GlobalState {
  return {
    getItem: (key: string) => (key === "app.recentProjects" ? recents : limit)
  } as unknown as GlobalState;
}

describe("RecentlyOpened", () => {
  it("promotes a project to the front and dedupes by path", () => {
    const history = new RecentlyOpened(
      stateWith([
        { name: "A", path: "/a", openedAt: 1 },
        { name: "B", path: "/b", openedAt: 2 }
      ])
    );

    const next = history.withProject({ name: "B", path: "/b/", openedAt: 0 });

    expect(next.map((project) => project.path)).toEqual(["/b/", "/a"]);
  });

  it("trims to the configured limit", () => {
    const history = new RecentlyOpened(
      stateWith(
        [1, 2, 3].map((n) => ({ name: `P${n}`, path: `/p${n}`, openedAt: n })),
        2
      )
    );

    expect(history.withProject({ name: "New", path: "/new", openedAt: 0 })).toHaveLength(2);
  });

  /**
   * A store written before names were enforced can hold a nameless record, and that record used
   * to reach the launcher and terminate the app on every launch. Repairing on read is what heals
   * an installation that is already stuck.
   */
  it("fills in a missing name on the way out", () => {
    const history = new RecentlyOpened(
      stateWith([{ path: "/Users/aria/Projects/My Game", openedAt: 1 }])
    );

    expect(history.list()[0].name).toBe("My Game");
  });

  it("refuses to store a nameless record", () => {
    const history = new RecentlyOpened(stateWith([]));

    const [stored] = history.withProject({ path: "C:\\Dev\\Game One", openedAt: 0 } as never);

    expect(stored.name).toBe("Game One");
  });

  it("tolerates an absent history", () => {
    expect(new RecentlyOpened(stateWith(undefined)).list()).toEqual([]);
  });
});
