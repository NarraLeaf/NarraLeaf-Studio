const path = require('path');
const esbuild = require('esbuild');
const rootDir = "D:/Dev/org/NarraLeaf/NarraLeaf-Studio/.claude/worktrees/uicli";
const scratch = "C:/Users/hello/AppData/Local/Temp/claude/D--Dev-org-NarraLeaf-NarraLeaf-Studio/bdffeeca-f633-447d-bf58-dd57e4079ced/scratchpad/spike";
esbuild.build({
    entryPoints: [path.join(scratch, 'entry.ts')],
    outfile: path.join(scratch, 'out.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning',
    alias: {
        '@': path.join(rootDir, 'src', 'renderer'),
        '@shared': path.join(rootDir, 'src', 'shared'),
        '@lib': path.join(rootDir, 'src', 'renderer', 'lib'),
        '@services': path.join(rootDir, 'src', 'renderer', 'lib', 'workspace', 'services'),
    },
    define: { __NLS_STUDIO_DEV__: 'true' },
    loader: { '.ts': 'ts', '.tsx': 'tsx', '.css': 'empty', '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty', '.svg': 'empty', '.png': 'empty' },
}).then(() => console.log('built')).catch(e => { console.error(e.message); process.exit(1); });
