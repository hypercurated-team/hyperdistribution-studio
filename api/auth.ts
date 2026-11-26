import { enabledProviders, firebaseConfig, personFrom } from "./_lib/firebase.js";

export const config = { maxDuration: 10 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * GET /api/auth   the public Firebase config the sign-in screen needs ({enabled:false} until it's set up),
 *                 plus who the Bearer token belongs to, when one is sent.
 */
export async function GET(req: Request) {
  const cfg = firebaseConfig();
  if (!cfg) return json({ enabled: false });
  const who = await personFrom(req);
  return json({
    enabled: true, config: cfg, providers: await enabledProviders(),
    requireSignIn: process.env.HM_REQUIRE_SIGNIN === "true",
    ...(who && who !== "bad" ? { uid: who.uid } : who === "bad" ? { error: "Sign in again." } : {}),
  });
}
