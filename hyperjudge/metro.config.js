const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// The HyperJudge shortcut ships inside the app (assets/HyperJudge.shortcut).
config.resolver.assetExts.push("shortcut");

module.exports = config;
