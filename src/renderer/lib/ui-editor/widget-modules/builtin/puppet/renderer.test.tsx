import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  UI_DOCUMENT_SCHEMA_VERSION,
  type UIDocument,
  type UIElement
} from "@shared/types/ui-editor/document";
import { UI_PUPPET_ELEMENT_TYPE } from "@shared/types/ui-editor/puppet";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { PuppetRenderer } from "./renderer";

function createDocument(props: Record<string, unknown>): UIDocument {
  return {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
      {
        id: "surface",
        name: "Surface",
        host: "app",
        kind: "appSurface",
        designSize: { width: 1280, height: 720 },
        rootElementId: "root"
      }
    ],
    elements: {
      root: {
        id: "root",
        type: "nl.root",
        parentId: null,
        childrenIds: ["puppet"],
        layout: { x: 0, y: 0, width: 1280, height: 720 }
      },
      puppet: {
        id: "puppet",
        type: UI_PUPPET_ELEMENT_TYPE,
        name: "Heroine",
        parentId: "root",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 360, height: 540, opacity: 1, visible: true },
        props
      }
    }
  };
}

function render(props: Record<string, unknown>, hostAdapter: UIHostAdapter): string {
  const document = createDocument(props);
  return renderToStaticMarkup(
    <PuppetRenderer
      element={document.elements.puppet as UIElement}
      document={document}
      surface={document.surfaces[0]!}
      hostAdapter={hostAdapter}
    />
  );
}

const EDITOR: UIHostAdapter = { host: "app" };
/** `blueprintRuntime` is the signal that tells a live host from the editor canvas. */
const LIVE: UIHostAdapter = {
  host: "app",
  blueprintRuntime: {} as UIHostAdapter["blueprintRuntime"]
};

describe("PuppetRenderer", () => {
  it("draws a quiet explanatory box when nothing is configured", () => {
    // Not an error box and not a white screen: most projects carry no puppet runtime at all, and a
    // widget the author has not finished configuring is the ordinary state. It has to say what it
    // wants, and it has to say who supplies the renderer.
    const markup = render({}, EDITOR);

    expect(markup).toContain('data-ui-puppet-placeholder="true"');
    expect(markup).toContain("Select a model bundle and a runtime.");
    expect(markup).toContain("Studio ships no renderer. The project supplies one.");
  });

  it("always leaves a mount host in the box, whatever the status", () => {
    // The seam needs a stable element to mount into. Rendering the host only once configured would
    // mean the first mount waits an extra commit for the ref to arrive.
    expect(render({}, EDITOR)).toContain('data-ui-puppet="true"');
    expect(render({ assetId: "m", backend: "b" }, EDITOR)).toContain('data-ui-puppet="true"');
  });

  it("keeps the authoring notice out of a live host", () => {
    // A player must never read "pick a model bundle". In a shipped game an unconfigured or
    // unresolvable puppet draws nothing at all - the engine's own degradation contract for a stage
    // puppet whose backend nobody answers to.
    const markup = render({}, LIVE);

    expect(markup).not.toContain("data-ui-puppet-placeholder");
    expect(markup).not.toContain("Studio ships no renderer");
    expect(markup).toContain('data-ui-puppet="true"');
  });

  it("says nothing while a configured widget is not yet mounted", () => {
    // `unmounted` on the canvas means off screen or hidden - the box cannot be seen, so a label
    // there would only ever be read as an error by someone scrolling past. This is also the state
    // the very first render is in, before the intersection observer has answered.
    const markup = render({ assetId: "model-1", backend: "spine" }, EDITOR);

    expect(markup).not.toContain("data-ui-puppet-placeholder");
    expect(markup).toContain('data-ui-puppet-status="unmounted"');
    expect(markup).toContain('data-ui-puppet-backend="spine"');
  });
});
