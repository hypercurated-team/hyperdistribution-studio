import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Linking, Platform, Pressable, StyleSheet, Text, useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import * as Media from "./media";

// react-native-webview's iOS + Android + Windows prop types collapse to never under the
// current React types, so the component is re-typed loosely here. The ref keeps its real type.
type WebViewHandle = InstanceType<typeof RNWebView>;
const WebView = RNWebView as unknown as React.ComponentType<Record<string, unknown> & { ref?: React.Ref<WebViewHandle> }>;

/**
 * HyperMixer for iOS and Android: the HyperMixer web app in a native shell.
 * The shell adds what a browser tab can't do well on a phone: saving and
 * sharing finished videos and backups, the Android back button, an offline
 * screen, opening other sites in the system browser, and the phone's own
 * photos and files (see media.ts).
 */
const WEB_URL: string = Constants.expoConfig?.extra?.webUrl ?? "https://hyperdistribution-studio.vercel.app";
const ORIGIN = new URL(WEB_URL).origin;

SplashScreen.preventAutoHideAsync().catch(() => {});

type Msg =
  | { type: "save-start"; id: string; name: string; mime: string }
  | { type: "save-chunk"; id: string; data: string }
  | { type: "save-end"; id: string }
  | { type: "panel"; open: boolean }
  | { type: "media-scan" }
  | { type: "media-change" }
  | { type: "files-pick" }
  | { type: "media-thumbs"; ids: string[] }
  | { type: "media-file"; id: string; req: string }
  | { type: "vision-analyze"; ids: string[]; req: string };

// Tells the page it is inside the app, and reports whether a side panel is open (for the back button).
const BOOT = `(() => {
  window.__hypermixerApp = { platform: ${JSON.stringify(Platform.OS)} };
  const send = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
  const watch = () => {
    const o = document.getElementById("overlay");
    if (!o) return setTimeout(watch, 300);
    const report = () => send({ type: "panel", open: !o.hidden });
    new MutationObserver(report).observe(o, { attributes: true, attributeFilter: ["hidden"] });
    report();
  };
  watch();
})(); true;`;

function Shell() {
  const web = useRef<WebViewHandle>(null);
  const files = useRef(new Map<string, { file: File; mime: string }>());
  const panelOpen = useRef(false);
  const [failed, setFailed] = useState(false);
  const dark = useColorScheme() === "dark";
  const bg = dark ? "#0E1017" : "#F4F5FA";

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panelOpen.current) {
        web.current?.injectJavaScript(`document.querySelector("#panel [data-close]")?.click(); true;`);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  // Replies to the page arrive through window.__hmFromApp(message).
  const send = useCallback<Media.Send>((m) => {
    web.current?.injectJavaScript(`window.__hmFromApp && window.__hmFromApp(${JSON.stringify(m)}); true;`);
  }, []);

  // Cloud sign-in (Google Drive, OneDrive, Dropbox) happens in the system browser, which
  // returns to hypermixer://oauth?r=…; hand that result to the page once it has loaded.
  const loaded = useRef(false);
  const pendingAuth = useRef<string | null>(null);
  useEffect(() => {
    const take = (url: string | null | undefined) => {
      const r = url && /^hypermixer:\/\/oauth\b/.test(url) ? /[?&]r=([^&#]+)/.exec(url)?.[1] : null;
      if (!r) return;
      if (loaded.current) send({ type: "oauth-result", r });
      else pendingAuth.current = r;
    };
    Linking.getInitialURL().then(take).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => take(e.url));
    return () => sub.remove();
  }, [send]);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let m: Msg;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === "panel") { panelOpen.current = m.open; return; }
    if (m.type === "media-scan") { Media.scan(send).catch(() => send({ type: "media-perm", access: "error" })); return; }
    if (m.type === "media-change") { Media.changeSelection().then(() => Media.scan(send)).catch(() => {}); return; }
    if (m.type === "files-pick") { Media.pickFiles(send).catch(() => {}); return; }
    if (m.type === "media-thumbs") { Media.thumbs(m.ids, send); return; }
    if (m.type === "media-file") { Media.sendFile(m.id, m.req, send); return; }
    if (m.type === "vision-analyze") { Media.analyze(m.ids, m.req, send); return; }
    try {
      if (m.type === "save-start") {
        const name = m.name.replace(/[^\w.-]+/g, "_") || "hypermixer-file";
        const file = new File(Paths.cache, name);
        if (file.exists) file.delete();
        file.create();
        files.current.set(m.id, { file, mime: m.mime });
      } else if (m.type === "save-chunk") {
        await files.current.get(m.id)?.file.write(m.data, { encoding: "base64", append: true });
      } else if (m.type === "save-end") {
        const entry = files.current.get(m.id);
        files.current.delete(m.id);
        if (entry && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(entry.file.uri, { mimeType: entry.mime });
      }
    } catch {
      web.current?.injectJavaScript(`window.toast && window.toast("Couldn't save that file"); true;`);
    }
  }, [send]);

  if (failed) {
    return (
      <SafeAreaView style={[styles.fill, styles.center, { backgroundColor: bg }]}>
        <Text style={[styles.title, { color: dark ? "#ECEEF6" : "#141622" }]}>You're offline</Text>
        <Text style={[styles.body, { color: dark ? "#979DB2" : "#5C6176" }]}>HyperMixer needs a connection to open. Your brands and posts are safe on this device.</Text>
        <Pressable style={styles.button} onPress={() => { setFailed(false); web.current?.reload(); }}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    // iOS: the page draws under the status bar and pads itself with env(safe-area-inset-*).
    // Android: keep it inside the safe area, since older WebViews don't report the insets.
    <SafeAreaView style={[styles.fill, { backgroundColor: bg }]} edges={Platform.OS === "android" ? ["top", "bottom", "left", "right"] : []}>
      <StatusBar style={dark ? "light" : "dark"} />
      <WebView
        ref={web}
        source={{ uri: WEB_URL }}
        style={[styles.fill, { backgroundColor: bg }]}
        originWhitelist={["https://*", "blob:*", "data:*"]}
        injectedJavaScriptBeforeContentLoaded={BOOT}
        onMessage={onMessage}
        onLoadEnd={() => {
          SplashScreen.hideAsync().catch(() => {});
          loaded.current = true;
          if (pendingAuth.current) { const r = pendingAuth.current; pendingAuth.current = null; setTimeout(() => send({ type: "oauth-result", r }), 1500); }
        }}
        onError={() => { SplashScreen.hideAsync().catch(() => {}); setFailed(true); }}
        onShouldStartLoadWithRequest={(req: WebViewNavigation & { isTopFrame?: boolean }) => {
          const url = req.url;
          if (url.startsWith(ORIGIN) || url.startsWith("blob:") || url.startsWith("data:") || url === "about:blank") return true;
          if (req.isTopFrame === false) return true;
          Linking.openURL(url).catch(() => {});
          return false;
        }}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsBackForwardNavigationGestures={false}
        allowFileAccess
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        pullToRefreshEnabled={false}
        bounces={false}
        overScrollMode="never"
        applicationNameForUserAgent="HyperMixerApp"
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  title: { fontSize: 22, fontWeight: "600" },
  body: { fontSize: 15, textAlign: "center", lineHeight: 21 },
  button: { marginTop: 8, backgroundColor: "#3846F0", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
});
