# Claude Code - run once in a terminal. Replace <PORT> and <TOKEN> with the values from
# NarraLeaf Studio: Settings -> Agent access -> Copy configuration.
# --scope user makes the server available in every folder; drop it to add it to the current project only.
claude mcp add --scope user --transport http narraleaf http://127.0.0.1:<PORT>/mcp --header "Authorization: Bearer <TOKEN>"
