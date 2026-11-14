const esbuild = require('esbuild');

/**
 * Generic helper to build & watch with esbuild.
 * Calls onSuccess after each successful build. An initial failure closes the
 * context and rejects so the dev session can release its reload port.
 * @param {import('esbuild').BuildOptions} options esbuild options
 * @param {() => void} onSuccess callback when build succeeds
 * @returns {Promise<import('esbuild').BuildContext>}
 */
async function watchBuild(options, onSuccess = () => {}) {
  // `ctx.watch()` runs a build of its own before it starts watching, so the
  // explicit `ctx.rebuild()` this used to open with meant every bundle in
  // `yarn dev` was compiled twice at startup — and `onSuccess` fired three
  // times per context (once per onEnd, once more by hand), which is why a
  // single edit used to log two "rebuilt" lines and broadcast two reloads.
  //
  // Watch's own build is the initial build now. `firstBuild` reports when it
  // lands so callers can still await the initial result.
  let settleFirst;
  const firstBuild = new Promise((resolve) => { settleFirst = resolve; });

  // Rebuild duration logger plugin
  const rebuildLogPlugin = {
    name: 'rebuild-log',
    setup(build) {
      let startTime;
      build.onStart(() => {
        startTime = Date.now();
      });
      build.onEnd((result) => {
        if (startTime) {
          const status = result.errors.length ? 'failed' : 'finished';
          console.log(`[watch] build ${status} in ${Date.now() - startTime} ms`);
        }
        settleFirst(result);
        if (result.errors.length === 0) {
          onSuccess();
        }
      });
    },
  };

  // Ensure plugins array exists and append the logger
  const ctx = await esbuild.context({
    ...options,
    plugins: [...(options.plugins || []), rebuildLogPlugin],
  });

  await ctx.watch();
  const result = await firstBuild;
  if (result.errors.length) {
    await ctx.dispose();
    throw new Error(`[watch] initial build failed: ${result.errors.map(error => error.text).join('; ')}`);
  }
  return ctx;
}

module.exports = {
  watchBuild,
};
