# HyperJudge (iPhone app)

HyperJudge by HyperMixer: watch a reel on Instagram, tap AssistiveTouch, guess the creator's
follower count in the Dynamic Island. Scores come from the HyperMixer server (`/api/judge`).

- App id `com.kraftxworks.hyperjudge`, widget `com.kraftxworks.hyperjudge.widget`,
  App Group `group.com.kraftxworks.hyperjudge`. iOS 17+.
- Expo SDK 58, built with EAS in the cloud (no Xcode needed on the Mac).

## How a round works

1. Set up once in the app: **Add shortcut** opens the share sheet with `assets/HyperJudge.shortcut`
   (Take Screenshot → Extract Text from Image → **Start HyperJudge Round**, signed for anyone);
   tap Shortcuts → Add Shortcut. **Open Settings** is for putting it on AssistiveTouch Single-Tap
   or Back Tap. The setup card moves to the bottom once a round has run.
2. Watching a reel, tap the button. The Dynamic Island pops open: "How many followers? 10K" with
   < > (1K, 2K, 5K … 10M+), Lock in and ✕. Long-press the island to open it again later.
3. Tap the island to open the app instead and use the scroll wheel.
4. After Lock in the island shows "Judging…", then the result in plain words, e.g.
   "👌 Close! +1 · @x has 2.1M · you said 10K · 12 pts · 🔥 2 in a row". It clears after 8 seconds.

The shortcut file is built from a plist and signed on a Mac with
`shortcuts sign --mode anyone --input in.shortcut --output assets/HyperJudge.shortcut`.
If the intent's name or the team id changes, rebuild and re-sign it.

## Where things are

- `targets/widget/HyperJudgeWidget.swift`: the Live Activity (island + Lock Screen).
- `targets/widget/_shared/HJShared.swift`: round logic, the Shortcuts action and the island
  buttons. Linked into both the app and the widget by `@bacons/apple-targets`.
- `modules/hj-live`: lets the React Native screen lock in a wheel guess (calls `HJBridge`).
  Its Swift lives in `modules/hj-live/ios` (the root `/ios` is generated and ignored).
- `App.tsx`: wheel, last result, leaderboard name, setup steps.

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
