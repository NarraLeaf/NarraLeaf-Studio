// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpBrowser } from "./HelpBrowser";
import { HELP_TOPICS } from "./helpTopics";

/**
 * What the host asks for has to arrive on screen: selected, and in view.
 *
 * The second part is what the popover's "All topics" depends on - it hands over the topic that was
 * being read, and a topic far enough down the list would otherwise be selected off screen.
 */

const FIRST = HELP_TOPICS[0].id;
/** Far enough down the list that a reader which never scrolls leaves it out of sight. */
const DEEP = HELP_TOPICS[HELP_TOPICS.length - 1].id;

let scrolled: Element[] = [];

beforeEach(() => {
    scrolled = [];
    // jsdom has no layout and no `scrollIntoView`; the call itself is the observable behaviour.
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
        scrolled.push(this);
    } as Element["scrollIntoView"];
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function row(id: string): HTMLElement {
    const element = document.querySelector(`[data-help-row="${id}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
}

/** The topic the right-hand pane is showing, read the way an author reads it: by its heading. */
function reading(): string {
    return screen.getByRole("heading", { level: 2 }).textContent ?? "";
}

describe("HelpBrowser", () => {
    it("opens on the requested topic and brings its row into view", () => {
        render(<HelpBrowser initialTopic={DEEP} topicRequest={1} />);

        expect(reading()).toBe(row(DEEP).textContent);
        expect(scrolled).toContain(row(DEEP));
    });

    it("returns to the requested topic when it is asked for again", () => {
        const view = render(<HelpBrowser initialTopic={DEEP} topicRequest={1} />);

        fireEvent.click(row(FIRST));
        expect(reading()).toBe(row(FIRST).textContent);

        // Same topic, second request: the id alone is unchanged, so only the request tells them apart.
        view.rerender(<HelpBrowser initialTopic={DEEP} topicRequest={2} />);
        expect(reading()).toBe(row(DEEP).textContent);
        expect(scrolled.filter(element => element === row(DEEP))).toHaveLength(2);
    });

    it("leaves the author's own selection alone", () => {
        render(<HelpBrowser initialTopic={DEEP} topicRequest={1} />);
        scrolled = [];

        fireEvent.click(row(FIRST));

        expect(reading()).toBe(row(FIRST).textContent);
        expect(scrolled).toHaveLength(0);
    });

    it("clears a filter that would hide the requested topic", () => {
        const view = render(<HelpBrowser initialTopic={FIRST} topicRequest={1} />);
        const search = document.querySelector("input") as HTMLInputElement;

        fireEvent.change(search, { target: { value: "zzzzzzzz" } });
        expect(document.querySelector(`[data-help-row="${DEEP}"]`)).toBeNull();

        view.rerender(<HelpBrowser initialTopic={DEEP} topicRequest={2} />);

        expect(search.value).toBe("");
        expect(reading()).toBe(row(DEEP).textContent);
        expect(scrolled).toContain(row(DEEP));
    });
});
