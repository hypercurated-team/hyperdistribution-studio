/**
 * A tiny Redis-like store on the Hypercurated project's Firestore, with no keys.
 *
 * Vercel signs each function call with a short-lived OIDC token. Google's
 * Workload Identity Federation swaps it for an access token of a service
 * account that may only use Firestore (roles/datastore.user). Nothing secret is
 * stored anywhere. Set up once with scripts/setup-firestore-store.sh.
 *
 * Env (none secret): GCP_PROJECT_ID, GCP_PROJECT_NUMBER, GCP_SERVICE_ACCOUNT_EMAIL,
 * GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID.
 *
 * It understands the commands HyperJudge uses: GET, SET [EX s], ZINCRBY,
 * ZREVRANGE … WITHSCORES, ZREVRANK, ZSCORE, HSET, HMGET, DEL, HDEL, ZREM (EXPIRE is ignored;
 * daily boards are keyed by date). Data sits under hyperjudge_* collections.
 */
const env = (k: string) => process.env[k] || "";
const PROJECT = () => env("GCP_PROJECT_ID");

export const gstoreReady = () =>
  !!(PROJECT() && env("GCP_PROJECT_NUMBER") && env("GCP_SERVICE_ACCOUNT_EMAIL") && env("GCP_WORKLOAD_IDENTITY_POOL_ID") && env("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"));

/** The handler passes the request's OIDC header here before using the store. */
let oidc = "";
export const useOidcFrom = (req: Request) => {
  oidc = req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || oidc;
};

let token: { value: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  if (!oidc) throw new Error("no Vercel OIDC token");
  const audience = `//iam.googleapis.com/projects/${env("GCP_PROJECT_NUMBER")}/locations/global/workloadIdentityPools/${env("GCP_WORKLOAD_IDENTITY_POOL_ID")}/providers/${env("GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID")}`;
  const sts = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectToken: oidc,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    }),
  }).then((r) => r.json() as Promise<{ access_token?: string }>);
  if (!sts.access_token) throw new Error("token exchange failed");
  const sa = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${env("GCP_SERVICE_ACCOUNT_EMAIL")}:generateAccessToken`, {
    method: "POST",
    headers: { authorization: `Bearer ${sts.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/datastore"] }),
  }).then((r) => r.json() as Promise<{ accessToken?: string; expireTime?: string }>);
  if (!sa.accessToken) throw new Error("service account impersonation failed");
  token = { value: sa.accessToken, exp: Date.parse(sa.expireTime || "") || Date.now() + 30 * 60_000 };
  return token.value;
}

const base = () => `https://firestore.googleapis.com/v1/projects/${PROJECT()}/databases/(default)/documents`;
/**
 * Firestore ids: the raw id goes in document names inside request bodies, and the same id
 * percent-encoded goes in URL paths (Google decodes the path). Mixing the two once left
 * the leaderboard writing "hj%3Ab%3A…" docs that the reads (path "hj:b:…") never found.
 */
const raw = (s: string) => (s === "." || s === ".." ? `_${s}` : s.replace(/\//g, "∕"));
const id = (s: string) => encodeURIComponent(raw(s));
const strDoc = (key: string) => `hyperjudge_kv/${id(key)}`;
const zCol = (key: string) => `hyperjudge_z/${id(key)}/m`;
const hCol = (key: string) => `hyperjudge_h/${id(key)}/f`;

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base()}/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore ${res.status}`);
  return res.json() as Promise<any>;
}

type Fields = Record<string, { stringValue?: string; integerValue?: string; doubleValue?: number }>;
const num = (f?: { integerValue?: string; doubleValue?: number }) => Number(f?.integerValue ?? f?.doubleValue ?? 0);

async function getStr(key: string): Promise<string | null> {
  const doc = await call(strDoc(key));
  const f = doc?.fields as Fields | undefined;
  if (!f?.v) return null;
  const exp = num(f.exp);
  return exp && exp < Date.now() ? null : f.v.stringValue ?? null;
}

async function setStr(key: string, v: string, ttlSec?: number) {
  const fields: Fields = { v: { stringValue: v }, exp: { integerValue: String(ttlSec ? Date.now() + ttlSec * 1000 : 0) } };
  await call(strDoc(key), { method: "PATCH", body: JSON.stringify({ fields }) });
  return "OK";
}

async function zincr(key: string, by: number, member: string) {
  const name = `projects/${PROJECT()}/databases/(default)/documents/hyperjudge_z/${raw(key)}/m/${raw(member)}`;
  const out = await commit({
    method: "POST",
    body: JSON.stringify({
      writes: [
        { update: { name, fields: { member: { stringValue: member } } }, updateMask: { fieldPaths: ["member"] }, updateTransforms: [{ fieldPath: "score", increment: { integerValue: String(Math.round(by)) } }] },
      ],
    }),
  });
  return num(out?.writeResults?.[0]?.transformResults?.[0]);
}

async function commit(init: RequestInit) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT()}/databases/(default)/documents:commit`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
  });
  if (!res.ok) throw new Error(`firestore ${res.status}`);
  return res.json() as Promise<any>;
}

async function zscore(key: string, member: string): Promise<number | null> {
  const doc = await call(`${zCol(key)}/${id(member)}`);
  return doc?.fields?.score ? num(doc.fields.score) : null;
}

const parentOf = (key: string) => `hyperjudge_z/${id(key)}`;

async function ztop(key: string, n: number): Promise<string[]> {
  const rows = (await call(`${parentOf(key)}:runQuery`, {
    method: "POST",
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "m" }], orderBy: [{ field: { fieldPath: "score" }, direction: "DESCENDING" }], limit: n } }),
  })) as { document?: { fields: Fields } }[] | null;
  return (rows ?? []).flatMap((r) => (r.document ? [r.document.fields.member?.stringValue ?? "", String(num(r.document.fields.score))] : []));
}

async function zrevrank(key: string, member: string): Promise<number | null> {
  const mine = await zscore(key, member);
  if (mine === null) return null;
  const rows = (await call(`${parentOf(key)}:runAggregationQuery`, {
    method: "POST",
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId: "m" }], where: { fieldFilter: { field: { fieldPath: "score" }, op: "GREATER_THAN", value: { integerValue: String(mine) } } } },
        aggregations: [{ alias: "n", count: {} }],
      },
    }),
  })) as { result?: { aggregateFields?: Fields } }[] | null;
  return num(rows?.[0]?.result?.aggregateFields?.n);
}

async function hset(key: string, field: string, v: string) {
  await call(`${hCol(key)}/${id(field)}`, { method: "PATCH", body: JSON.stringify({ fields: { v: { stringValue: v } } }) });
  return 1;
}

async function hget(key: string, field: string): Promise<string | null> {
  const doc = await call(`${hCol(key)}/${id(field)}`);
  return doc?.fields?.v?.stringValue ?? null;
}

/** Runs a Redis-style pipeline against Firestore. Throws if Google can't be reached. */
export async function gstore(cmd: string[][]): Promise<unknown[]> {
  return Promise.all(
    cmd.map(async ([op, key, ...args]) => {
      switch (op) {
        case "GET": return getStr(key);
        case "SET": {
          const ex = args.indexOf("EX");
          return setStr(key, args[0], ex >= 0 ? Number(args[ex + 1]) : undefined);
        }
        case "ZINCRBY": return zincr(key, Number(args[0]), args[1]);
        case "ZSCORE": { const s = await zscore(key, args[0]); return s === null ? null : String(s); }
        case "ZREVRANK": return zrevrank(key, args[0]);
        case "ZREVRANGE": return ztop(key, Number(args[1]) - Number(args[0]) + 1);
        case "HSET": return hset(key, args[0], args[1]);
        case "HMGET": return Promise.all(args.map((f) => hget(key, f)));
        // For account deletion.
        case "DEL": return Promise.all([key, ...args].map((k) => call(strDoc(k), { method: "DELETE" }))).then((r) => r.length);
        case "HDEL": return Promise.all(args.map((f) => call(`${hCol(key)}/${id(f)}`, { method: "DELETE" }))).then((r) => r.length);
        case "ZREM": return Promise.all(args.map((m) => call(`${zCol(key)}/${id(m)}`, { method: "DELETE" }))).then((r) => r.length);
        default: return null;
      }
    }),
  );
}
