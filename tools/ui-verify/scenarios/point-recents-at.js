/*
 * Point an isolated profile's recent-projects list at ONE project and nothing else.
 *
 *   node point-recents-at.js <profileStateDir> <projectPath>
 *
 * Not cosmetic. With the shared fixture project absent from recents, an acceptance run cannot open
 * it even by a mis-aimed click, so no probe can dirty the project the whole round depends on.
 * Always point this at a COPY.
 */
const fs = require('fs');
const path = require('path');

const [stateDir, projectPath] = process.argv.slice(2);
if (!stateDir || !projectPath) {
    console.error('usage: node point-recents-at.js <profileStateDir> <projectPath>');
    process.exit(1);
}

const file = path.join(stateDir, 'global.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
state['app.recentProjects'] = [{
    // The app stores Windows-style paths; a forward-slash one does not match an existing entry.
    path: path.resolve(projectPath).split('/').join('\\'),
    name: path.basename(projectPath),
    openedAt: 1785039416211,
}];
fs.writeFileSync(file, JSON.stringify(state, null, '\t'));
console.log(`${file} -> ${JSON.stringify(state['app.recentProjects'])}`);
