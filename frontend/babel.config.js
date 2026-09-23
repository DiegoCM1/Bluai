module.exports = function (api) {
  const isProduction = api.env("production");
  api.cache.using(() => isProduction);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      "react-native-reanimated/plugin",
      // Strips console.* from production bundles so the 180+ console.log calls
      // in this codebase stop shipping as Sentry breadcrumbs in release builds.
      isProduction && "transform-remove-console",
    ].filter(Boolean),
  };
};
