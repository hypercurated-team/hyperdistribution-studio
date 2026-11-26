// Shared by the app and the widget extension (apple-targets links _shared into both).
// Holds the round: Live Activity state, the Shortcuts action, the island buttons and the
// call to /api/judge.

import ActivityKit
import AppIntents
import Foundation

let hjGroup = "group.com.kraftxworks.hyperjudge"
let hjAPI = URL(string: "https://hypermixer.vercel.app/api/judge")!
/// Same 13 steps the server snaps guesses to (api/judge.ts STEPS).
let hjSteps = ["1K", "2K", "5K", "10K", "20K", "50K", "100K", "200K", "500K", "1M", "2M", "5M", "10M+"]

struct HJAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    /// "guess", "judging", "result" or "error"
    var phase: String
    var guess: Int
    var title: String = ""
    var detail: String = ""
    var score: String = ""
  }
}

/// App Group storage. The JS side writes "player" and reads "result" with ExtensionStorage.
enum HJStore {
  static var defaults: UserDefaults { UserDefaults(suiteName: hjGroup) ?? .standard }

  static var text: String {
    get { defaults.string(forKey: "text") ?? "" }
    set { defaults.set(newValue, forKey: "text") }
  }
  static var player: String {
    let p = (defaults.string(forKey: "player") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return p.isEmpty ? (defaults.string(forKey: "name") ?? "") : p
  }
  static var guess: Int {
    get { min(max(Int(defaults.string(forKey: "guess") ?? "") ?? 3, 0), hjSteps.count - 1) }
    set { defaults.set(String(newValue), forKey: "guess") }
  }
  /// A fresh Firebase ID token (HyperMixer account), refreshed with the token the app saved.
  static func idToken() async -> String? {
    guard let refresh = defaults.string(forKey: "refresh"), !refresh.isEmpty,
          let key = defaults.string(forKey: "apiKey"), !key.isEmpty else { return nil }
    if let t = defaults.string(forKey: "idToken"), let exp = Double(defaults.string(forKey: "idTokenExp") ?? ""),
       exp - 60 > Date().timeIntervalSince1970 { return t }
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    guard let url = URL(string: "https://securetoken.googleapis.com/v1/token?key=\(key)"),
          let enc = refresh.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    req.httpBody = "grant_type=refresh_token&refresh_token=\(enc)".data(using: .utf8)
    guard let (data, _) = try? await URLSession.shared.data(for: req),
          let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let id = j["id_token"] as? String else { return nil }
    let ttl = Double((j["expires_in"] as? String) ?? "3600") ?? 3600
    defaults.set(id, forKey: "idToken")
    defaults.set(String(Date().timeIntervalSince1970 + ttl), forKey: "idTokenExp")
    if let r = j["refresh_token"] as? String { defaults.set(r, forKey: "refresh") }
    return id
  }

  static func saveResult(_ s: HJAttributes.ContentState) {
    let r = ["phase": s.phase, "title": s.title, "detail": s.detail, "score": s.score, "at": String(Date().timeIntervalSince1970)]
    if let data = try? JSONSerialization.data(withJSONObject: r), let json = String(data: data, encoding: .utf8) {
      defaults.set(json, forKey: "result")
    }
  }
}

enum HJEngine {
  static var current: Activity<HJAttributes>? { Activity<HJAttributes>.activities.first }

  /// New round: remember the reel's text and open the guess in the Dynamic Island.
  static func start(text: String) async throws {
    HJStore.text = text
    for old in Activity<HJAttributes>.activities { await old.end(nil, dismissalPolicy: .immediate) }
    let state = HJAttributes.ContentState(phase: "guess", guess: HJStore.guess)
    let activity = try Activity.request(attributes: HJAttributes(), content: .init(state: state, staleDate: nil), pushType: nil)
    // An alert makes the island pop open, so the < > buttons are there without a long-press.
    await activity.update(.init(state: state, staleDate: nil),
                          alertConfiguration: AlertConfiguration(title: "HyperJudge", body: "How many followers?", sound: .default))
  }

  static func step(_ delta: Int) async {
    guard let activity = current else { return }
    var s = activity.content.state
    guard s.phase == "guess" else { return }
    s.guess = min(max(s.guess + delta, 0), hjSteps.count - 1)
    HJStore.guess = s.guess
    await activity.update(.init(state: s, staleDate: nil))
  }

  static func lockIn(_ index: Int? = nil) async {
    guard let activity = current else { return }
    var s = activity.content.state
    if let index { s.guess = min(max(index, 0), hjSteps.count - 1) }
    HJStore.guess = s.guess
    s.phase = "judging"
    await activity.update(.init(state: s, staleDate: nil))

    let r = await judge(guess: hjSteps[s.guess])
    s.phase = r.ok ? "result" : "error"
    s.title = r.title
    s.detail = r.detail
    s.score = r.score
    HJStore.saveResult(s)
    await activity.update(.init(state: s, staleDate: nil),
                          alertConfiguration: AlertConfiguration(title: "\(r.title)", body: "\(r.detail)", sound: .default))
    try? await Task.sleep(for: .seconds(8))
    await activity.end(.init(state: s, staleDate: nil), dismissalPolicy: .immediate)
  }

  static func close() async {
    for a in Activity<HJAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
  }

  struct Outcome { var ok: Bool; var title: String; var detail: String; var score: String }

  static func judge(guess: String) async -> Outcome {
    var req = URLRequest(url: hjAPI)
    req.httpMethod = "POST"
    req.timeoutInterval = 25
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token = await HJStore.idToken() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["text": HJStore.text, "guess": guess, "player": HJStore.player])
    guard let (data, _) = try? await URLSession.shared.data(for: req),
          let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      return Outcome(ok: false, title: "No connection", detail: "Couldn't reach HyperJudge. Try again.", score: "")
    }
    let line = (j["line"] as? String) ?? "Something went wrong."
    guard j["error"] == nil, let points = j["points"] as? Int, let followers = (j["followers"] as? NSNumber)?.doubleValue else {
      return Outcome(ok: false, title: "No score this time", detail: line, score: "")
    }
    let handle = (j["handle"] as? String) ?? "creator"
    let total = (j["total"] as? Int) ?? 0
    let streak = (j["streak"] as? Int) ?? 0
    let title = points == 3 ? "🎯 Nailed it! +3" : points == 1 ? "👌 Close! +1" : "❌ Miss"
    let detail = "@\(handle) has \(short(followers)) · you said \(guess)"
    let score = "\(total) pts" + (streak > 1 ? " · 🔥 \(streak) in a row" : "")
    return Outcome(ok: true, title: title, detail: detail, score: score)
  }

  static func short(_ n: Double) -> String {
    func fmt(_ v: Double, _ big: Bool) -> String {
      let s = big ? String(format: "%.0f", v) : String(format: "%.1f", v)
      return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
    }
    if n >= 1e6 { return fmt(n / 1e6, n >= 1e7) + "M" }
    if n >= 1e3 { return fmt(n / 1e3, n >= 1e4) + "K" }
    return String(Int(n))
  }
}

// MARK: - Shortcuts action and island buttons

/// The Shortcuts action: Take Screenshot → Extract Text from Image → Start HyperJudge Round.
struct StartRoundIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Start HyperJudge Round"
  static let description = IntentDescription("Takes the text from the reel you're watching and asks for your guess in the Dynamic Island.")

  @Parameter(title: "Text from the screen")
  var text: String

  init() {}

  func perform() async throws -> some IntentResult {
    try await HJEngine.start(text: text)
    return .result()
  }
}

struct StepGuessIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Change HyperJudge guess"
  static let isDiscoverable = false

  @Parameter(title: "Step")
  var delta: Int

  init() {}
  init(delta: Int) { self.delta = delta }

  func perform() async throws -> some IntentResult {
    await HJEngine.step(delta)
    return .result()
  }
}

struct LockInIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Lock in HyperJudge guess"
  static let isDiscoverable = false

  init() {}

  func perform() async throws -> some IntentResult {
    await HJEngine.lockIn()
    return .result()
  }
}

struct CloseRoundIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Close HyperJudge round"
  static let isDiscoverable = false

  init() {}

  func perform() async throws -> some IntentResult {
    await HJEngine.close()
    return .result()
  }
}

/// Lets the React Native app (modules/hj-live) drive a round. Found by name at runtime.
@objc(HJBridge)
public class HJBridge: NSObject {
  @objc public static func start(_ text: NSString) {
    Task { try? await HJEngine.start(text: text as String) }
  }
  @objc public static func lockIn(_ index: NSNumber) {
    Task { await HJEngine.lockIn(index.intValue) }
  }
  @objc public static func close(_ unused: NSNumber) {
    Task { await HJEngine.close() }
  }
}
