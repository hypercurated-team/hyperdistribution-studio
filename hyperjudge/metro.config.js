const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Ship the signed Shortcuts file (assets/HyperJudge.shortcut) inside the app.
config.resolver.assetExts.push("shortcut");

module.exports = config;
