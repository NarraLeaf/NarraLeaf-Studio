/**
 * `defaultDoc` - default UI-document content baked into a newly created project.
 *
 * These element names, preview placeholder text, and blueprint display names are
 * resolved with `translate("defaultDoc.…")` at document-build time, so the
 * editor's current language is captured into the new project's data.
 */
export const defaultDoc = {
    rootName: "Root",
    componentName: "Component",
    pageName: "Page",
    pageCopy: "{name} Copy",
    speaker: "Speaker",
    dialog: {
        interactionLayer: "Dialog Interaction Layer",
        panel: "Dialog Panel",
        content: "Dialog Content",
        nametag: "Nametag",
        sentence: "Sentence",
        sentenceText: "The current line will appear here.",
        nextEvent: "Dialog Next",
        updateNametagEvent: "Update Nametag",
    },
    notification: {
        list: "Notification List",
        item: "Notification Item",
        message: "Notification Message",
        messageText: "Notification message",
        anotherMessage: "Another message",
    },
    choice: {
        list: "Choice List",
        item: "Choice Item",
        text: "Choice Text",
        itemText: "Choice",
        selectEvent: "Select Choice",
        previewA: "Choice A",
        previewB: "Choice B",
        previewC: "Choice C",
    },
    nvl: {
        interactionLayer: "NVL Interaction Layer",
        panel: "NVL Panel",
        list: "NVL List",
        nametag: "NVL Nametag",
        texts: "NVL Texts",
        entryText: "The dialog entry text will appear here.",
        nextEvent: "NVL Next",
    },
} as const;
