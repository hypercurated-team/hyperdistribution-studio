# HyperJudge (iPhone app)

HyperJudge by HyperMixer: watch a reel on Instagram, tap AssistiveTouch, guess the creator's
follower count in the Dynamic Island. Scores come from the HyperMixer server (`/api/judge`).

- App id `com.kraftxworks.hyperjudge`, widget `com.kraftxworks.hyperjudge.widget`,
  App Group `group.com.kraftxworks.hyperjudge`. iOS 17+.
- Expo SDK 58, built with EAS in the cloud (no Xcode needed on the Mac).

## How a round works

1. AssistiveTouch runs the shortcut: Take Screenshot → Extract Text from Image →
   **Start HyperJudge Round** (an action this app adds to Shortcuts).
2. The Dynamic Island pops open: "How many followers? 10K" with < > (1K, 2K, 5K … 10M+),
   Lock in and ✕. Long-press the island to open it again later.
3. Tap the island to open the app instead and use the scroll wheel.
4. After Lock in the island shows "Judging…", then the result in plain words, e.g.
   "👌 Close! +1 · @x has 2.1M · you said 10K · 12 pts · 🔥 2 in a row". It clears after 8 seconds.

## Setup in the app (3 taps)

1. **Add the HyperJudge shortcut**: shares `assets/HyperJudge.shortcut` (built by
   `shortcuts/build_hyperjudge_app.py`, signed on a Mac with `shortcuts sign --mode anyone`).
2. **Turn on AssistiveTouch**: opens Settings → Accessibility (`App-prefs:` link, falls back
   to the app's own settings page). App Review sometimes questions `App-prefs:` links; if so,
   drop them and keep the fallback.
3. **Open Instagram**.

## Accounts and leaderboard

Same accounts as HyperMixer (the Hypercurated Firebase project). Email and password use
Firebase's REST API; Apple, Google and Microsoft open HyperMixer's sign-in page
(`/?signin=google&app=hyperjudge`) in a sign-in sheet that returns to `hyperjudge://auth`.
The session sits in the App Group so island rounds are scored to the account.
`GET /api/judge?board=1&period=today|all` serves the leaderboard (top 50, plus your rank).

## Where things are

- `targets/widget/HyperJudgeWidget.swift`: the Live Activity (island + Lock Screen).
- `targets/widget/_shared/HJShared.swift`: round logic, the Shortcuts action and the island
  buttons. Linked into both the app and the widget by `@bacons/apple-targets`.
- `modules/hj-live`: lets the React Native screen lock in a wheel guess (calls `HJBridge`).
- `App.tsx`: Play (setup, wheel, last result), Leaderboard, sign-in sheet. `auth.ts`, `setup.ts`.

## Build

```sh
cd hyperjudge
npm install
npx eas-cli@latest init            # once: creates the Expo project, writes extra.eas.projectId
npx eas-cli@latest build --profile preview --platform ios
```

EAS asks for the Apple developer sign-in the first time and creates the app id, the widget id,
the App Group and the profiles. Add the team id to `app.json` as `ios.appleTeamId`
(apple-targets needs it for the widget). Everything here is native, so changes to the Swift
files need a new build; changes to `App.tsx` can go out with EAS Update once it's set up.
