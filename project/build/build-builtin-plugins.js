const path = require('path');
const { rootDir, isDev } = require('./utils');
const { buildBuiltInPlugins } = require('./builtin-plugins');

(async () => {
    console.log(`[build-builtin-plugins] Mode: ${isDev() ? 'development' : 'production'}`);
    try {
        const results = await buildBuiltInPlugins({ dev: isDev() });
        if (results.length === 0) {
            console.log('[build-builtin-plugins] No built-in plugins found.');
            return;
        }
        for (const result of results) {
            console.log(`[build-builtin-plugins] Built ${result.id} -> ${path.relative(rootDir, result.outfile)}`);
        }
        console.log('[build-builtin-plugins] All built-in plugins built successfully.');
    } catch (error) {
        console.error('[build-builtin-plugins] Failed:', error);
        process.exit(1);
    }
})();
