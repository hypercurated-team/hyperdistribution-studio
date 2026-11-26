# Setting up Google Drive, OneDrive and Dropbox

HyperMixer lets people sign in to their drives, choose folders, and use the
photos and videos in them. To turn that on you register one small "app" with
each provider and put its id and secret into Vercel. A provider whose keys are
missing simply shows "Not set up on this site yet" on the Connect screen.

**How it works:**

- Sign-in happens in the system browser, using OAuth with PKCE.
- The server stores nothing. The refresh token goes back to the person's device
  encrypted, and the device keeps it.
- The device asks `/api/oauth` for a short-lived access token whenever it needs
  one.
- The device then talks to Drive, Graph or Dropbox directly. No photo or video
  ever passes through the server.
- Access is read-only everywhere.

Use this redirect URI everywhere (copy it exactly, no trailing slash):

```
https://hyperdistribution-studio.vercel.app/api/oauth-callback
```

If you add a custom domain later, add `https://<that domain>/api/oauth-callback`
too. The site always sends the callback for the domain it's served from.

---

## 0. One shared key (do this first)

`HM_TOKEN_KEY` encrypts sign-in state and saved grants. Make one in Terminal:

```bash
openssl rand -base64 32
```

Add it in Vercel → project **hyperdistribution-studio** → Settings → Environment
Variables → Name `HM_TOKEN_KEY`, Environment **Production** (and Preview if you
use it). Don't change it afterwards: changing it signs everyone out of their
drives.

---

## 1. Google Drive

1. Go to https://console.cloud.google.com, top bar → project picker → **New
   project** → name it "HyperMixer" → Create, then select it.
2. **APIs & Services → Library**, search **Google Drive API**, then **Enable**.
3. **APIs & Services → OAuth consent screen** (now called "Google Auth
   Platform"), then **Get started**:
   - App name "HyperMixer", support email yours, audience **External**, contact
     email yours → Create.
   - **Branding**: add the app home page
     `https://hyperdistribution-studio.vercel.app` and authorized domain
     `vercel.app` (or your own domain). Save.
   - **Data access → Add or remove scopes**: tick
     `https://www.googleapis.com/auth/drive.readonly`, `openid` and `.../auth/userinfo.email`.
     Save.
   - **Audience → Test users → Add users**: add each Google account that will
     test (up to 100).
4. **Clients → Create client**:
   - Application type **Web application**, name "HyperMixer web".
   - **Authorized redirect URIs → Add URI**: the redirect URI above.
   - Create. Copy the **Client ID** and **Client secret**.
5. In Vercel, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**About the Google scope:** `drive.readonly` lets people browse their whole
Drive and pick folders, which is the experience built here. Google classes it
as a *restricted* scope:

- In **Testing** mode it works right away, for up to 100 test users. Their
  sign-in shows an "unverified app" notice, and Google expires their sign-in
  after 7 days, so they reconnect weekly.
- To open it to everyone you **Publish app**, then go through Google's
  verification, including a yearly third-party security assessment (CASA).
  That takes weeks and may cost money.
- The lighter alternative is the `drive.file` scope plus the Google Picker.
  It needs no security assessment. But people pick files and folders in
  Google's own picker, and HyperMixer only sees what they pick. That's a
  follow-up if you want public launch without the assessment.

---

## 2. OneDrive (Microsoft)

1. Go to https://entra.microsoft.com, then **Applications → App registrations →
   New registration**. If you don't have an Entra tenant, sign in with any
   Microsoft account at https://portal.azure.com and use **Microsoft Entra ID →
   App registrations**.
   - Name "HyperMixer".
   - Supported account types: **Accounts in any organizational directory and
     personal Microsoft accounts** (this is the "common" option, needed for
     personal OneDrive).
   - Redirect URI: platform **Web**, value is the redirect URI above.
   - Register.
2. On the overview page copy **Application (client) ID**. That's
   `MICROSOFT_CLIENT_ID`.
3. **Certificates & secrets → Client secrets → New client secret**:
   - Description "vercel", expiry 24 months, then Add.
   - Copy the **Value** right away (not the Secret ID). That's
     `MICROSOFT_CLIENT_SECRET`.
   - Put a reminder in your calendar to renew it before it expires.
4. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions**: tick `Files.Read`, `offline_access` and `User.Read`, then Add
   permissions. No admin consent is needed for these.
5. In Vercel, add `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.

Anyone with a personal or work Microsoft account can use it immediately.
Some companies block third-party apps; their admin would need to allow it.
Optional, later: **Branding & properties → Publisher verification**, which
removes the "unverified" label on the consent screen.

---

## 3. Dropbox

1. Go to https://www.dropbox.com/developers/apps, then **Create app**:
   - API: **Scoped access**.
   - Access: **Full Dropbox**, so people can choose any folder.
   - Name: something unique, e.g. "HyperMixer Studio". Create app.
2. **Permissions** tab: tick `account_info.read`, `files.metadata.read` and
   `files.content.read`, then **Submit** at the bottom. Do this before anyone
   signs in, because a scope change needs people to reconnect.
3. **Settings** tab:
   - **OAuth 2 → Redirect URIs**: add the redirect URI above.
   - Copy **App key** (`DROPBOX_APP_KEY`) and **App secret**
     (`DROPBOX_APP_SECRET`, click Show).
4. In Vercel, add `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET`.

A new Dropbox app is in **Development** status and works for up to 500 Dropbox
accounts. Beyond that, click **Apply for production** on the Settings tab.

---

## 4. Turn it on

After adding the variables, redeploy so they take effect:

```bash
vercel --prod
```

Then open the site's **Connect** screen. Each provider you set up shows
**Connect**.

Check it with this:

```bash
curl -s https://hyperdistribution-studio.vercel.app/api/oauth
```

It returns `{"providers":{"google":true,"microsoft":true,"dropbox":true}}` once
all three are set.

### All variables

| Name | From |
|---|---|
| `HM_TOKEN_KEY` | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud → Clients |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Entra → App registration |
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` | Dropbox App Console → Settings |

Never commit these or paste them into chat. They belong only in Vercel.

## What people see

- **On iPhone and Android:**
  - Connect opens Safari or Chrome for the provider's sign-in.
  - After signing in, the page says "Returning to HyperMixer…" and the app
    reopens with a folder browser.
  - They choose folders, and the photos and videos appear in Edit and
    Auto-pick.
- **On the web:** the same, in a popup window.
- Previews come from the provider's thumbnails. A full file is downloaded only
  when an edit actually renders it.
- **Disconnect** forgets the sign-in on that device. To revoke fully, use the
  provider's own settings:
  - Google: myaccount.google.com → Security → Third-party apps.
  - Microsoft: account.microsoft.com → Privacy → Apps.
  - Dropbox: Settings → Connected apps.
