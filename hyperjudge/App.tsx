import { ExtensionStorage } from "@bacons/apple-targets";
import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import HjLive from "./modules/hj-live";

/** Same steps as the island and the server (api/judge.ts STEPS). */
const STEPS = ["1K", "2K", "5K", "10K", "20K", "50K", "100K", "200K", "500K", "1M", "2M", "5M", "10M+"];
const ROW = 56;
const VISIBLE = 5;

const store = (() => {
  try {
    return new ExtensionStorage("group.com.kraftxworks.hyperjudge");
  } catch {
    return null;
  }
})();
const read = (key: string) => {
  try {
    return store?.get(key) ?? null;
  } catch {
    return null;
  }
};

type Result = { phase: string; title: string; detail: string; score: string; at: string };
const readResult = (): Result | null => {
  try {
    return JSON.parse(read("result") || "null");
  } catch {
    return null;
  }
};

export default function App() {
  const dark = useColorScheme() === "dark";
  const c = dark ? colors.dark : colors.light;
  const [index, setIndex] = useState(() => Math.min(Math.max(Number(read("guess") ?? 3) || 3, 0), STEPS.length - 1));
  const [player, setPlayer] = useState(() => read("player") ?? "");
  const [result, setResult] = useState<Result | null>(readResult);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const wheel = useRef<ScrollViewInstance>(null);
  const last = useRef(index);

  useEffect(() => {
    wheel.current?.scrollTo({ y: index * ROW, animated: false });
  }, []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(Math.max(Math.round(e.nativeEvent.contentOffset.y / ROW), 0), STEPS.length - 1);
    if (i !== last.current) {
      last.current = i;
      setIndex(i);
      Haptics.selectionAsync().catch(() => {});
    }
  };

  const savePlayer = (name: string) => {
    setPlayer(name);
    try {
      store?.set("player", name.trim());
    } catch {}
  };

  const lockIn = () => {
    if (!read("text")) {
      setNote("Start a round from a reel first: tap your AssistiveTouch button while watching.");
      return;
    }
    if (!HjLive?.lockIn(index)) {
      setNote("This build can't reach the Dynamic Island. Install the HyperJudge build, not Expo Go.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setNote("");
    setBusy(true);
    const before = result?.at;
    const started = Date.now();
    const poll = setInterval(() => {
      const r = readResult();
      if ((r && r.at !== before) || Date.now() - started > 30_000) {
        clearInterval(poll);
        setBusy(false);
        if (r && r.at !== before) setResult(r);
        else setNote("No answer yet. Check the Dynamic Island.");
      }
    }, 700);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[s.screen, { backgroundColor: c.bg }]}>
        <StatusBar style={dark ? "light" : "dark"} />
        <ScrollView contentContainerStyle={s.content}>
          <Text style={[s.brand, { color: c.dim }]}>HYPERMIXER</Text>
          <Text style={[s.title, { color: c.text }]}>HyperJudge</Text>
          <Text style={[s.sub, { color: c.dim }]}>How many followers does this creator have?</Text>

          <View style={[s.card, { backgroundColor: c.card }]}>
            <View style={s.wheelWrap}>
              <View pointerEvents="none" style={[s.band, { backgroundColor: c.band }]} />
              <ScrollView
                ref={wheel}
                style={{ height: ROW * VISIBLE }}
                contentContainerStyle={{ paddingVertical: ROW * Math.floor(VISIBLE / 2) }}
                showsVerticalScrollIndicator={false}
                snapToInterval={ROW}
                decelerationRate="fast"
                onScroll={onScroll}
                scrollEventThrottle={16}
              >
                {STEPS.map((label, i) => {
                  const d = Math.abs(i - index);
                  return (
                    <View key={label} style={s.row}>
                      <Text
                        style={[
                          s.step,
                          { color: d === 0 ? c.text : c.dim, opacity: d === 0 ? 1 : d === 1 ? 0.6 : 0.3, fontSize: d === 0 ? 34 : 24 },
                        ]}
                      >
                        {label}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
            <Pressable onPress={lockIn} disabled={busy} style={({ pressed }) => [s.button, { opacity: pressed || busy ? 0.6 : 1 }]}>
              <Text style={s.buttonText}>{busy ? "Judging…" : `Lock in ${STEPS[index]}`}</Text>
            </Pressable>
            {note ? <Text style={[s.note, { color: c.dim }]}>{note}</Text> : null}
          </View>

          {result ? (
            <View style={[s.card, { backgroundColor: c.card }]}>
              <Text style={[s.resultTitle, { color: c.text }]}>{result.title}</Text>
              <Text style={[s.body, { color: c.text }]}>{result.detail}</Text>
              {result.score ? <Text style={[s.body, { color: c.dim }]}>{result.score}</Text> : null}
            </View>
          ) : null}

          <Text style={[s.section, { color: c.dim }]}>YOUR NAME ON THE LEADERBOARD</Text>
          <View style={[s.card, { backgroundColor: c.card, paddingVertical: 4 }]}>
            <TextInput
              value={player}
              onChangeText={savePlayer}
              placeholder="e.g. Achintya"
              placeholderTextColor={c.dim}
              style={[s.input, { color: c.text }]}
              autoCorrect={false}
              returnKeyType="done"
            />
          </View>

          <Text style={[s.section, { color: c.dim }]}>SET UP ONCE</Text>
          <View style={[s.card, { backgroundColor: c.card }]}>
            {[
              "Open Shortcuts and make a new shortcut called HyperJudge.",
              "Add Take Screenshot, then Extract Text from Image, then Start HyperJudge Round.",
              "Settings → Accessibility → Touch → AssistiveTouch → on, then Single-Tap → HyperJudge.",
              "Watch a reel and tap the button. Guess with < > in the Dynamic Island and tap Lock in.",
              "Tap the island any time to come here and use the wheel instead.",
            ].map((t, i) => (
              <View key={i} style={s.stepRow}>
                <Text style={[s.num, { color: "#4C5BFF" }]}>{i + 1}</Text>
                <Text style={[s.body, { color: c.text, flex: 1 }]}>{t}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const colors = {
  light: { bg: "#F2F2F7", card: "#FFFFFF", text: "#111111", dim: "#8A8A8E", band: "#EEF0FF" },
  dark: { bg: "#000000", card: "#1C1C1E", text: "#FFFFFF", dim: "#8E8E93", band: "#23264A" },
};

const s = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  brand: { fontSize: 12, fontWeight: "600", letterSpacing: 1.2, marginTop: 8 },
  title: { fontSize: 34, fontWeight: "700" },
  sub: { fontSize: 17, marginBottom: 4 },
  card: { borderRadius: 16, padding: 16, gap: 8 },
  wheelWrap: { justifyContent: "center" },
  band: { position: "absolute", left: 0, right: 0, height: ROW, top: ROW * Math.floor(VISIBLE / 2), borderRadius: 12 },
  row: { height: ROW, alignItems: "center", justifyContent: "center" },
  step: { fontWeight: "700", fontVariant: ["tabular-nums"] },
  button: { backgroundColor: "#4C5BFF", borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  note: { fontSize: 13, textAlign: "center" },
  resultTitle: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 20 },
  section: { fontSize: 13, marginTop: 12, marginLeft: 16 },
  input: { fontSize: 17, paddingVertical: 10 },
  stepRow: { flexDirection: "row", gap: 12, paddingVertical: 4 },
  num: { fontSize: 15, fontWeight: "700", width: 16 },
});
