# HyperJudge

Guess a reel creator's follower count while you watch Instagram. On iPhone it runs as a
shortcut from the AssistiveTouch button, so you never leave Instagram.

## How a round works

1. Tap the AssistiveTouch button on a reel.
2. The shortcut takes one screenshot and reads its text on the phone (nothing is recorded).
3. Scroll the list and pick a guess: 1K, 2K, 5K, 10K … 5M, 10M+.
4. HyperMixer (`POST /api/judge`) works out who posted the reel, looks up their followers
   with Claude and web search, and scores the guess.
5. A notification shows the reply (plain text, `?format=text`) on three short lines, e.g.
   `🎯 Nailed it! +3` / `Real answer: 18K followers` / `Your score: 27 · 🔥 4 in a row`.
   Shortcuts can't show a Dynamic Island; that needs a Live Activity in the HyperMixer app.

Scoring: the step closest to the real count = 3 points, the step next to it = 1, anything else = 0.
Today's leaderboard: `GET /api/judge?board=1`.

## Server setup (Vercel)

- `ANTHROPIC_API_KEY` and `HDS_SHARED_KEY=true` (already used by the AI actions).
- Optional but recommended: Vercel KV / Upstash (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) so
  scores, streaks and the follower cache survive between requests.

Each new account costs one Claude call with up to 3 web searches; lookups are cached for a day.

## Follower counts (Instagram Graph API)

Counts come from Instagram's Business Discovery API first, then Claude with web search as a
fallback (personal accounts aren't covered by the API). Set in Vercel:

- `IG_USER_ID`: the id of one of our Instagram professional accounts (linked to a Facebook Page).
- `IG_ACCESS_TOKEN`: a long-lived token for it with `instagram_basic`, `pages_show_list` and
  `business_management`. A System User token from Meta Business Settings doesn't expire.
- `IG_GRAPH_VERSION` (optional), e.g. `v23.0`.

Find the id with `GET /me/accounts?fields=instagram_business_account` in the Graph API Explorer.

## The shortcut file

`shortcuts/build_hyperjudge.py` writes the shortcut. iOS only imports signed shortcuts, so sign it on a Mac:

```sh
python3 shortcuts/build_hyperjudge.py > HyperJudge-unsigned.shortcut
shortcuts sign --mode anyone --input HyperJudge-unsigned.shortcut --output HyperJudge.shortcut
```

AirDrop `HyperJudge.shortcut` to the iPhone, or open it from iCloud Drive, and tap Add Shortcut.

## Setting up the iPhone (once)

Settings → Accessibility → Touch → AssistiveTouch → turn on → Single-Tap → HyperJudge.

The first run asks to allow the screenshot and to allow sending text to
hyperdistribution-studio.vercel.app. Choose Always Allow.
