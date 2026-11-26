import { Asset } from "expo-asset";
import * as Sharing from "expo-sharing";
import { Linking } from "react-native";

/** Hands the bundled shortcut to the share sheet; picking Shortcuts imports it. */
export async function addShortcut() {
  const [asset] = await Asset.loadAsync(require("./assets/HyperJudge.shortcut"));
  if (!asset.localUri) throw new Error("Couldn't open the shortcut.");
  await Sharing.shareAsync(asset.localUri, { dialogTitle: "Add to Shortcuts" });
}

/** Opens Settings as close to AssistiveTouch as iOS allows, falling back to this app's settings. */
export async function openAssistiveTouch() {
  for (const url of ["App-prefs:ACCESSIBILITY&path=TOUCH_REACHABILITY_TITLE/AIR_TOUCH_TITLE", "App-prefs:ACCESSIBILITY"]) {
    try {
      await Linking.openURL(url);
      return;
    } catch {}
  }
  await Linking.openSettings();
}

export async function openInstagram() {
  try {
    await Linking.openURL("instagram://reels_home");
  } catch {
    await Linking.openURL("https://www.instagram.com/reels/");
  }
}
