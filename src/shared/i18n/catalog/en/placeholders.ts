/** `placeholders` — empty-state copy for not-yet-implemented workspace panels. */
export const placeholders = {
    story: {
        title: "Story",
        description: "Chapters, scenes, and story structure will appear here.",
    },
    localization: {
        title: "Localization",
        description: "Translation tables and language assets will be managed here.",
    },
    // Static panel/editor module titles registered at load time (see each module's index).
    moduleTitles: {
        welcome: "Welcome",
        project: "Project",
        properties: "Properties",
        characters: "Characters",
        story: "Story",
        storyFlow: "Scene Flow",
        localization: "Localization",
        voice: "Voice",
        assets: "Assets",
        console: "Console",
        storyMotion: "Story Motion",
        dashboard: "Dashboard",
        audioPreview: "Audio Preview",
        imagePreview: "Image Preview",
        videoPreview: "Video Preview",
        fontPreview: "Font Preview",
        jsonPreview: "JSON Preview",
        search: "Search",
        keybindings: "Keyboard Shortcuts",
        history: "History",
        notifications: "Notifications",
    },
} as const;
