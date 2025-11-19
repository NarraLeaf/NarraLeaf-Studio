const esbuild = require('esbuild');

/**
 * Generic helper to build & watch with esbuild.
 * Ensures onSuccess is called after initial build and on subsequent rebuilds.
 * @param {import('esbuild').BuildOptions} options esbuild options
 * @param {() => void} onSuccess callback when build succeeds
 * @returns {Promise<import('esbuild').BuildContext>}
 */
async function watchBuild(options, onSuccess = () => {}) {
  // Rebuild duration logger plugin
  const rebuildLogPlugin = {
    name: 'rebuild-log',
    setup(build) {
      let startTime;
      build.onStart(() => {
        startTime = Date.now();
      });
      build.onEnd(() => {
        if (startTime) {
          console.log(`[watch] build finished in ${Date.now() - startTime} ms`);
        }
        onSuccess();
      });
    },
  };

  // Ensure plugins array exists and append the logger
  const ctx = await esbuild.context({
    ...options,
    plugins: [...(options.plugins || []), rebuildLogPlugin],
  });

  // Trigger the initial build explicitly and invoke success callback
  try {
    await ctx.rebuild();
    onSuccess();
  } catch (err) {
    console.error(`[watch] initial build failed`, err);
  }

  await ctx.watch();
  return ctx;
}

module.exports = {
  watchBuild,
};
