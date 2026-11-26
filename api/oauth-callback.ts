import { open, PROVIDERS, redirectUri, seal, tokenRequest, type State } from "./_lib/cloud.js";

export const config = { maxDuration: 30 };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string, script = "") {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.45 -apple-system,system-ui,sans-serif;background:#FFFFFF;color:#000000;padding:24px;box-sizing:border-box;text-align:center}
@media (prefers-color-scheme:dark){body{background:#000000;color:#FFFFFF}a{background:#B9A1FF!important;color:#000!important}}a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:22px;background:#6E3FD1;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><div><h1 style="font-size:22px;margin:0 0 8px">${esc(title)}</h1>${body}</div>${script}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } },
  );
}

/** Where Google, Microsoft and Dropbox send the person back after they sign in. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = open<State>(url.searchParams.get("state") || "");
  if (!state || Date.now() - state.t > 15 * 60_000) return page("That sign-in expired", "<p>Go back to HyperMixer and try again.</p>");
  const name = PROVIDERS[state.p].name;
  if (url.searchParams.get("error") || !url.searchParams.get("code")) return page(`${name} wasn't connected`, "<p>You can close this and try again from HyperMixer.</p>");

  let result: string;
  try {
    const t = await tokenRequest(state.p, {
      grant_type: "authorization_code", code: url.searchParams.get("code")!,
      redirect_uri: redirectUri(state.o), code_verifier: state.v,
    });
    if (!t.refresh_token) throw new Error("no refresh token");
    const account = await PROVIDERS[state.p].account(t.access_token!).catch(() => "");
    // Readable by HyperMixer's page (it checks the nonce it started with); the grant inside stays encrypted.
    result = Buffer.from(JSON.stringify({ provider: state.p, nonce: state.n, account, grant: seal({ p: state.p, r: t.refresh_token }) })).toString("base64url");
  } catch {
    return page(`${name} wasn't connected`, "<p>Something went wrong signing in. Go back to HyperMixer and try again.</p>");
  }

  if (state.ret === "app") {
    // Back to the iOS / Android app, which hands the result to its page.
    const link = `hypermixer://oauth?r=${result}`;
    return page(`${name} connected`, `<p>Returning to HyperMixer…</p><a href="${esc(link)}">Open HyperMixer</a>`,
      `<script>location.replace(${JSON.stringify(link)})</script>`);
  }
  // In a browser: hand the result to the HyperMixer tab that opened this window.
  return page(`${name} connected`, "<p>You can close this window.</p>",
    `<script>try{window.opener&&window.opener.postMessage({type:"hm-oauth",r:${JSON.stringify(result)}},${JSON.stringify(state.o)});}catch(e){}setTimeout(function(){window.close()},300)</script>`);
}
