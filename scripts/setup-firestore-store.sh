#!/usr/bin/env bash
# One-time: let the Vercel project "hypermixer" use the Hypercurated Firestore with no keys.
# Vercel OIDC -> Google Workload Identity Federation -> service account with Firestore access only.
# Needs gcloud signed in as an owner of the Firebase project, and the vercel CLI linked to the project.
set -euo pipefail
PROJECT=${PROJECT:-hypercurated-app-99068}
TEAM=${TEAM:-hypercurated}          # Vercel team slug (OIDC issuer)
POOL=vercel; PROVIDER=vercel; SA=hyperjudge-vercel
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA_EMAIL="$SA@$PROJECT.iam.gserviceaccount.com"

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com firestore.googleapis.com --project "$PROJECT"
gcloud iam workload-identity-pools describe $POOL --location=global --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create $POOL --location=global --display-name="Vercel" --project "$PROJECT"
gcloud iam workload-identity-pools providers describe $PROVIDER --workload-identity-pool=$POOL --location=global --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc $PROVIDER --workload-identity-pool=$POOL --location=global --project "$PROJECT" \
    --issuer-uri="https://oidc.vercel.com/$TEAM" --allowed-audiences="https://vercel.com/$TEAM" \
    --attribute-mapping="google.subject=assertion.sub,attribute.project=assertion.project" \
    --attribute-condition="assertion.project == 'hypermixer'"
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam service-accounts create $SA --display-name="HyperJudge on Vercel" --project "$PROJECT"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA_EMAIL" --role=roles/datastore.user --condition=None >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project "$PROJECT" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/$POOL/attribute.project/hypermixer" >/dev/null

for kv in "GCP_PROJECT_ID=$PROJECT" "GCP_PROJECT_NUMBER=$NUM" "GCP_SERVICE_ACCOUNT_EMAIL=$SA_EMAIL" \
          "GCP_WORKLOAD_IDENTITY_POOL_ID=$POOL" "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=$PROVIDER"; do
  for envname in production preview; do
    printf '%s' "${kv#*=}" | vercel env add "${kv%%=*}" "$envname" --force
  done
done
echo "Done. Redeploy (or merge to main) to pick up the new variables."
