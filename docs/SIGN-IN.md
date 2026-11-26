# HyperMixer accounts

People sign in with **Apple, Google, Microsoft or email**. Accounts live in the
Hypercurated Firebase project (`hypercurated-app-99068`), shared with the
Hypercurated app. One account works in both.

## How it works

- **First run:** a sign-in screen, with "Not now" to keep going without an
  account. "Account" on Connect shows who's signed in, with Sign out.
- **On the web:** Firebase's own sign-in window.
- **In the iOS / Android app:** Google refuses sign-in inside an embedded web
  view, so it works like this:
  - The app opens the sign-in page in Safari or Chrome.
  - After signing in, the page sends the person back through
    `hypermixer://auth`.
  - The session travels encrypted with a key that never left the app.
  - This is a JS-only change to the app shell, shipped over the air.
- **Email:** uses a password, with "Forgot password?". It works the same in
  the app and on the web, with no browser hop.
- **Server:** checks Firebase ID tokens against Google's published keys, so
  there's no service account or secret to set.
- **Daily allowance:** the free AI allowance counts per signed-in person. Without
  an account it still counts per device, as before.
- **Config:** Hypercurated's public web config is built in. These env vars
  override it: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`,
  `FIREBASE_AUTH_DOMAIN`. Set `HM_SIGNIN=off` to hide sign-in, or
  `HM_REQUIRE_SIGNIN=true` to make the free AI need an account.
- **Provider buttons:** a button only appears when that provider is switched
  on in Firebase (`/api/auth` checks).

## Account sync

Signed in, a person's brands, posts, dumps, renders, subs, styles, analyses,
kits and setups follow them to every device (`src/shim/sync.ts`).

- **Where it's stored:** in their own space in the same Firebase project,
  `users/{uid}/hm_<collection>/<doc>`. Only that person can read or write it.
- **How it's written:** each document is `{ d: JSON, t: last change, x: deleted }`,
  and the newest change wins.
- **When it runs:** at sign-in, whenever the app comes back to the front, and
  about 1.5 s after any change.
- **Switching it on:** one Firestore rule, added by `hm-enable-sync.sh`. The
  script adds that single block to the live rules and prints how to undo it.
  - The same block must also be in the Hypercurated repo's `firebase/firestore.rules`.
    Otherwise the next Hypercurated rules deploy removes it.

```
match /users/{userId}/{coll}/{docId} {
  allow read, write: if request.auth != null && request.auth.uid == userId
    && coll.matches('hm_[a-z]+');
}
```

- **Moving data in:** a backup file (Connect → Import backup) is uploaded to the
  account as soon as it's imported.

## To switch it on

1. **Authorized domain** (needed for Apple / Google / Microsoft):
   - Firebase console → project hypercurated-app-99068 → Authentication →
     Settings → Authorized domains → Add domain.
   - Enter `hyperdistribution-studio.vercel.app`.
2. **Microsoft** (optional, any time later). It reuses Hypercurated's existing
   Microsoft app (`OUTLOOK_CLIENT_ID`):
   1. In entra.microsoft.com → App registrations → that app → Authentication →
      Web → Add URI, enter
      `https://hypercurated-app-99068.firebaseapp.com/__/auth/handler`, then
      Save.
   2. In the Firebase console → Authentication → Sign-in method → Add new
      provider → Microsoft → Enable.
      - Application ID: the value of `OUTLOOK_CLIENT_ID`.
      - Application secret: the value of `OUTLOOK_CLIENT_SECRET`.

      Both are in `~/Desktop/hypercurated-mobile-app/backend/.env`. Copy them
      from there yourself.
   3. Save. The Microsoft button appears within 10 minutes.

Apple, Google and email are already switched on in that project.

## Before launch (to-do)

- **Klaviyo:** every new account in the shared project fires Hypercurated's
  `onUserCreate`. That adds a Klaviyo profile and a "Signed up" event, so
  HyperMixer sign-ups would reach Hypercurated's CRM.
  - Fix in hypercurated-team/hypercurated: move that trigger (and
    `onLifecycleUserCreate`) to run when a Hypercurated profile
    (`users/{uid}`) is created.
  - Lifecycle journeys already skip people without a profile.
- **Account deletion:** the App Store requires in-app account deletion once the
  app offers sign-in. Because the account is shared with Hypercurated,
  deleting it from HyperMixer would delete the Hypercurated account too.
  - Decide the behaviour first, e.g. "remove HyperMixer data, keep the
    account" plus a link to delete everything.
  - Until then, keep sign-in off in the App Store build, or add that flow.
- **Marking HyperMixer users:** they can be told apart today because they have
  no `users/{uid}` profile. A custom claim (`apps: ["hypermixer"]`) needs a
  small Hypercurated function with admin rights, which can be added with the
  Klaviyo change.
