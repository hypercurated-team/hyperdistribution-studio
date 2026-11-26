import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as auth from "./auth";
import HjLive from "./modules/hj-live";
import { addShortcut, openAssistiveTouch, openInstagram } from "./setup";

/** Same steps as the island and the server (api/judge.ts STEPS). */
const STEPS = ["1K", "2K", "5K", "10K", "20K", "50K", "100K", "200K", "500K", "1M", "2M", "5M", "10M+"];
const ROW = 56;
const VISIBLE = 5;
const BLUE = "#4C5BFF";

type Result = { phase: string; title: string; detail: string; score: string; at: string };
const readResult = (): Result | null => {
  try {
    return JSON.parse(auth.get("result") || "null");
  } catch {
    return null;
  }
};
type Row = { rank: number; name: string; points: number; me: boolean };

export default function App() {
  const dark = useColorScheme() === "dark";
  const c = dark ? colors.dark : colors.light;
  const [tab, setTab] = useState<"play" | "board">("play");
  const [me, setMe] = useState(auth.account);
  const [signIn, setSignIn] = useState(false);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[s.screen, { backgroundColor: c.bg }]}>
        <StatusBar style={dark ? "light" : "dark"} />
        <View style={s.header}>
          <View>
            <Text style={[s.brand, { color: c.dim }]}>HYPERMIXER</Text>
            <Text style={[s.title, { color: c.text }]}>HyperJudge</Text>
          </View>
          <Pressable onPress={() => setSignIn(true)} hitSlop={8}>
            <Text style={[s.link, { color: BLUE }]}>{me ? me.name || me.email.split("@")[0] : "Sign in"}</Text>
          </Pressable>
        </View>
        <View style={[s.segment, { backgroundColor: c.card }]}>
          {(["play", "board"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[s.segItem, tab === t && { backgroundColor: BLUE }]}>
              <Text style={[s.segText, { color: tab === t ? "#fff" : c.text }]}>{t === "play" ? "Play" : "Leaderboard"}</Text>
            </Pressable>
          ))}
        </View>
        {tab === "play" ? <Play c={c} /> : <Board c={c} me={me} onSignIn={() => setSignIn(true)} />}
        <SignInSheet c={c} open={signIn} me={me} onClose={() => setSignIn(false)} onChange={() => setMe(auth.account())} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

type C = typeof colors.light;

function Play({ c }: { c: C }) {
  const [index, setIndex] = useState(() => Math.min(Math.max(Number(auth.get("guess") ?? 3) || 3, 0), STEPS.length - 1));
  const [result, setResult] = useState<Result | null>(readResult);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [setupOpen, setSetupOpen] = useState(() => auth.get("setupDone") !== "1");
  const wheel = useRef<ScrollViewInstance>(null);
  const last = useRef(index);

  useEffect(() => {
    wheel.current?.scrollTo({ y: index * ROW, animated: false });
    // Coming back from Instagram or the island: show the latest result.
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") setResult(readResult());
    });
    return () => sub.remove();
  }, []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(Math.max(Math.round(e.nativeEvent.contentOffset.y / ROW), 0), STEPS.length - 1);
    if (i !== last.current) {
      last.current = i;
      setIndex(i);
      Haptics.selectionAsync().catch(() => {});
    }
  };

  const lockIn = () => {
    if (!auth.get("text")) {
      setNote("Start a round from a reel first: tap your AssistiveTouch button while watching.");
      return;
    }
    if (!HjLive?.lockIn(index)) {
      setNote("This build can't reach the Dynamic Island. Install HyperJudge from TestFlight.");
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

  const run = (f: () => Promise<void>) => f().catch((e) => setNote(String(e?.message ?? e)));

  return (
    <ScrollView contentContainerStyle={s.content}>
      <View style={[s.card, { backgroundColor: c.card }]}>
        <Pressable onPress={() => setSetupOpen(!setupOpen)} style={s.rowBetween}>
          <Text style={[s.cardTitle, { color: c.text }]}>Set up in 3 taps</Text>
          <Text style={{ color: c.dim }}>{setupOpen ? "Hide" : "Show"}</Text>
        </Pressable>
        {setupOpen ? (
          <>
            <SetupStep c={c} n={1} label="Add the HyperJudge shortcut" hint="Pick Shortcuts in the share sheet, then Add Shortcut." onPress={() => run(addShortcut)} />
            <SetupStep c={c} n={2} label="Turn on AssistiveTouch" hint="AssistiveTouch → on → Single-Tap → HyperJudge. Or Back Tap → Double Tap." onPress={() => run(openAssistiveTouch)} />
            <SetupStep c={c} n={3} label="Open Instagram and tap the button" hint="Guess with < > in the Dynamic Island, then Lock in." onPress={() => run(openInstagram)} />
            <Pressable
              onPress={() => {
                auth.set("setupDone", "1");
                setSetupOpen(false);
              }}
            >
              <Text style={[s.small, { color: c.dim, textAlign: "center", marginTop: 4 }]}>All set, hide this</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      <View style={[s.card, { backgroundColor: c.card }]}>
        <Text style={[s.cardTitle, { color: c.text }]}>How many followers?</Text>
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
                <View key={label} style={s.wheelRow}>
                  <Text style={[s.step, { color: d === 0 ? c.text : c.dim, opacity: d === 0 ? 1 : d === 1 ? 0.6 : 0.3, fontSize: d === 0 ? 34 : 24 }]}>
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
        {note ? <Text style={[s.small, { color: c.dim, textAlign: "center" }]}>{note}</Text> : null}
      </View>

      {result ? (
        <View style={[s.card, { backgroundColor: c.card }]}>
          <Text style={[s.resultTitle, { color: c.text }]}>{result.title}</Text>
          <Text style={[s.body, { color: c.text }]}>{result.detail}</Text>
          {result.score ? <Text style={[s.body, { color: c.dim }]}>{result.score}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function SetupStep({ c, n, label, hint, onPress }: { c: C; n: number; label: string; hint: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.setupRow, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={s.badge}>
        <Text style={s.badgeText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.body, { color: BLUE, fontWeight: "600" }]}>{label}</Text>
        <Text style={[s.small, { color: c.dim }]}>{hint}</Text>
      </View>
      <Text style={{ color: c.dim, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}

function Board({ c, me, onSignIn }: { c: C; me: auth.Account | null; onSignIn: () => void }) {
  const [period, setPeriod] = useState<"today" | "all">("today");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mine, setMine] = useState<{ rank: number; points: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const token = await auth.idToken();
      const r = await fetch(`${auth.WEB}/api/judge?board=1&period=${period}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const j = await r.json();
      setRows(j.board ?? []);
      setMine(j.me ?? null);
    } catch {
      setErr("Couldn't load the leaderboard. Pull to try again.");
    }
    setLoading(false);
  }, [period, me?.uid]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={[s.segment, { backgroundColor: c.card, marginHorizontal: 0 }]}>
        {(["today", "all"] as const).map((p) => (
          <Pressable key={p} onPress={() => setPeriod(p)} style={[s.segItem, period === p && { backgroundColor: c.band }]}>
            <Text style={[s.segText, { color: c.text }]}>{p === "today" ? "Today" : "All time"}</Text>
          </Pressable>
        ))}
      </View>
      {!me ? (
        <Pressable onPress={onSignIn} style={[s.card, { backgroundColor: c.card }]}>
          <Text style={[s.body, { color: c.text }]}>Sign in with your Hypercurated account to get on the leaderboard.</Text>
          <Text style={[s.body, { color: BLUE, fontWeight: "600" }]}>Sign in</Text>
        </Pressable>
      ) : mine ? (
        <View style={[s.card, { backgroundColor: c.card }]}>
          <Text style={[s.body, { color: c.dim }]}>You're</Text>
          <Text style={[s.resultTitle, { color: c.text }]}>
            #{mine.rank} · {mine.points} pts
          </Text>
        </View>
      ) : null}
      <View style={[s.card, { backgroundColor: c.card, paddingVertical: 4 }]}>
        {rows === null ? (
          <ActivityIndicator style={{ marginVertical: 24 }} />
        ) : rows.length === 0 ? (
          <Text style={[s.body, { color: c.dim, paddingVertical: 16, textAlign: "center" }]}>
            {err || (period === "today" ? "No one has played today yet. Be first." : "No scores yet.")}
          </Text>
        ) : (
          rows.map((r, i) => (
            <View key={`${r.rank}-${r.name}`} style={[s.boardRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
              <Text style={[s.rank, { color: r.rank <= 3 ? BLUE : c.dim }]}>{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</Text>
              <Text style={[s.body, { color: c.text, flex: 1, fontWeight: r.me ? "700" : "400" }]} numberOfLines={1}>
                {r.name}
                {r.me ? " (you)" : ""}
              </Text>
              <Text style={[s.body, { color: c.text, fontVariant: ["tabular-nums"] }]}>{r.points}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function SignInSheet({ c, open, me, onClose, onChange }: { c: C; open: boolean; me: auth.Account | null; onClose: () => void; onChange: () => void }) {
  const [providers, setProviders] = useState<Partial<Record<auth.Provider, boolean>>>({});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(() => auth.get("player") ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (open) auth.setup().then((r) => setProviders(r.providers)).catch(() => {});
  }, [open]);

  const go = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setMsg("");
    try {
      const ok = await f();
      if (ok !== false) {
        onChange();
        onClose();
      }
    } catch (e) {
      setMsg(String((e as Error)?.message ?? e));
    }
    setBusy(false);
  };

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={[s.content, { paddingTop: 24 }]} keyboardShouldPersistTaps="handled">
        <View style={s.rowBetween}>
          <Text style={[s.title, { color: c.text, fontSize: 28 }]}>{me ? "Account" : "Sign in"}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={[s.link, { color: BLUE }]}>Done</Text>
          </Pressable>
        </View>
        {me ? (
          <>
            <View style={[s.card, { backgroundColor: c.card }]}>
              <Text style={[s.body, { color: c.dim }]}>Signed in as</Text>
              <Text style={[s.body, { color: c.text, fontWeight: "600" }]}>{me.email || me.name}</Text>
            </View>
            <Text style={[s.section, { color: c.dim }]}>NAME ON THE LEADERBOARD</Text>
            <View style={[s.card, { backgroundColor: c.card, paddingVertical: 4 }]}>
              <TextInput
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  auth.set("player", v.trim());
                }}
                placeholder={me.name || me.email.split("@")[0]}
                placeholderTextColor={c.dim}
                style={[s.input, { color: c.text }]}
              />
            </View>
            <Pressable
              onPress={() => {
                auth.signOut();
                onChange();
                onClose();
              }}
              style={[s.card, { backgroundColor: c.card, alignItems: "center" }]}
            >
              <Text style={[s.body, { color: "#FF3B30" }]}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[s.body, { color: c.dim }]}>Use your Hypercurated account, the same one as HyperMixer.</Text>
            {(["apple", "google", "microsoft"] as const)
              .filter((p) => providers[p])
              .map((p) => (
                <Pressable
                  key={p}
                  disabled={busy}
                  onPress={() => go(() => auth.provider(p))}
                  style={[s.button, { backgroundColor: p === "apple" ? (c === colors.dark ? "#fff" : "#000") : c.card, marginTop: 0 }]}
                >
                  <Text style={[s.buttonText, { color: p === "apple" ? (c === colors.dark ? "#000" : "#fff") : c.text }]}>
                    Continue with {p === "apple" ? "Apple" : p === "google" ? "Google" : "Microsoft"}
                  </Text>
                </Pressable>
              ))}
            <View style={[s.card, { backgroundColor: c.card, paddingVertical: 4, gap: 0 }]}>
              <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={c.dim} autoCapitalize="none" keyboardType="email-address" textContentType="username" style={[s.input, { color: c.text }]} />
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line }} />
              <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={c.dim} secureTextEntry textContentType="password" style={[s.input, { color: c.text }]} />
            </View>
            <Pressable disabled={busy} onPress={() => go(() => auth.email("in", email, password))} style={[s.button, { opacity: busy ? 0.6 : 1, marginTop: 0 }]}>
              <Text style={s.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text>
            </Pressable>
            <View style={s.rowBetween}>
              <Pressable disabled={busy} onPress={() => go(() => auth.email("up", email, password))}>
                <Text style={[s.small, { color: BLUE }]}>Create an account</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() =>
                  auth.resetPassword(email).then(
                    () => setMsg("Check your email for a reset link."),
                    (e) => setMsg(String(e?.message ?? e)),
                  )
                }
              >
                <Text style={[s.small, { color: BLUE }]}>Forgot password?</Text>
              </Pressable>
            </View>
          </>
        )}
        {msg ? <Text style={[s.small, { color: c.dim, textAlign: "center" }]}>{msg}</Text> : null}
      </ScrollView>
    </Modal>
  );
}

const colors = {
  light: { bg: "#F2F2F7", card: "#FFFFFF", text: "#111111", dim: "#8A8A8E", band: "#EEF0FF", line: "#D1D1D6" },
  dark: { bg: "#000000", card: "#1C1C1E", text: "#FFFFFF", dim: "#8E8E93", band: "#23264A", line: "#38383A" },
};

const s = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 16, paddingTop: 8 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  brand: { fontSize: 12, fontWeight: "600", letterSpacing: 1.2 },
  title: { fontSize: 34, fontWeight: "700" },
  link: { fontSize: 17, fontWeight: "500", marginBottom: 6 },
  segment: { flexDirection: "row", borderRadius: 10, padding: 2, marginHorizontal: 16, marginTop: 12 },
  segItem: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: "center" },
  segText: { fontSize: 14, fontWeight: "600" },
  card: { borderRadius: 16, padding: 16, gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: "600" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  setupRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: BLUE, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontWeight: "700" },
  wheelWrap: { justifyContent: "center" },
  band: { position: "absolute", left: 0, right: 0, height: ROW, top: ROW * Math.floor(VISIBLE / 2), borderRadius: 12 },
  wheelRow: { height: ROW, alignItems: "center", justifyContent: "center" },
  step: { fontWeight: "700", fontVariant: ["tabular-nums"] },
  button: { backgroundColor: BLUE, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  small: { fontSize: 13 },
  resultTitle: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 20 },
  section: { fontSize: 13, marginTop: 4, marginLeft: 16 },
  input: { fontSize: 17, paddingVertical: 12 },
  boardRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  rank: { width: 28, fontSize: 15, fontWeight: "700", textAlign: "center" },
});
