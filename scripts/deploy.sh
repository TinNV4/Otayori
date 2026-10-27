#!/usr/bin/env bash
# One-shot, idempotent deploy to Cloud Run (asia-northeast1) + Firestore + Secret Manager + Scheduler.
#
#   PROJECT_ID=my-proj ./scripts/deploy.sh            # full setup + deploy
#   PROJECT_ID=my-proj ./scripts/deploy.sh --deploy-only
#
# Secrets are read from env on first run (or prompted) and stored in Secret Manager:
#   LINE_CHANNEL_SECRET LINE_CHANNEL_ACCESS_TOKEN ANTHROPIC_API_KEY
# Non-secret settings (kept across deploys once set): LIFF_ID, ADMIN_USER_IDS (comma-separated LINE userIds,
# get yours with /whoami), ANTHROPIC_WORKSPACE_ID (only for organization-level API keys)
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-giaytonhat}"
SA="${SERVICE}-run@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_ONLY=false
[[ "${1:-}" == "--deploy-only" ]] && DEPLOY_ONLY=true

gcloud config set project "$PROJECT_ID" >/dev/null

ensure_secret() { # name env_var
  local name=$1 var=$2 val="${!2:-}"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    if [[ -n "$val" ]]; then printf '%s' "$val" | gcloud secrets versions add "$name" --data-file=- >/dev/null; echo "  updated $name"; fi
  else
    if [[ -z "$val" ]]; then read -rsp "  $var: " val; echo; fi
    printf '%s' "$val" | gcloud secrets create "$name" --replication-policy=user-managed --locations="$REGION" --data-file=- >/dev/null
    echo "  created $name"
  fi
  gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
}

if ! $DEPLOY_ONLY; then
  echo "▶ Enabling APIs"
  gcloud services enable run.googleapis.com firestore.googleapis.com secretmanager.googleapis.com \
    cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com >/dev/null

  echo "▶ Service account"
  gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "${SERVICE}-run" --display-name="Giay To Nhat runtime"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/datastore.user >/dev/null

  echo "▶ Firestore (Native, $REGION) + TTL"
  gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 || \
    gcloud firestore databases create --location="$REGION" --type=firestore-native
  gcloud firestore fields ttls update expire_at --collection-group=documents --enable-ttl --async >/dev/null || true
  gcloud firestore fields ttls update expire_at --collection-group=error_logs --enable-ttl --async >/dev/null || true

  echo "▶ Secrets"
  ensure_secret line-channel-secret LINE_CHANNEL_SECRET
  ensure_secret line-channel-token LINE_CHANNEL_ACCESS_TOKEN
  ensure_secret anthropic-api-key ANTHROPIC_API_KEY
  CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 24)}" ensure_secret cron-secret CRON_SECRET
fi

URL=$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)' 2>/dev/null || true)

# Optional settings are only sent when given, so a later --deploy-only keeps existing values.
ENV_VARS="^@^NODE_ENV=production@STORAGE=firestore@PUBLIC_BASE_URL=${URL:-https://placeholder.invalid}"
for v in LIFF_ID ADMIN_USER_IDS ANTHROPIC_WORKSPACE_ID MAX_BETA_FAMILIES MONTHLY_BUDGET_USD DEFAULT_FAMILY_QUOTA; do
  [[ -n "${!v:-}" ]] && ENV_VARS="$ENV_VARS@$v=${!v}"
done

echo "▶ Deploying Cloud Run service"
# max-instances=1: the multi-page aggregator and webhook dedupe are in-process (fine for 20 families).
# no-cpu-throttling: webhook ACKs immediately and keeps extracting in the background.
gcloud run deploy "$SERVICE" \
  --source=. \
  --region="$REGION" \
  --service-account="$SA" \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=1 \
  --no-cpu-throttling \
  --memory=512Mi --cpu=1 --timeout=300 \
  --update-env-vars="$ENV_VARS" \
  --set-secrets="LINE_CHANNEL_SECRET=line-channel-secret:latest,LINE_CHANNEL_ACCESS_TOKEN=line-channel-token:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,CRON_SECRET=cron-secret:latest"

NEW_URL=$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')
if [[ "$NEW_URL" != "${URL:-}" ]]; then
  echo "▶ First deploy: setting PUBLIC_BASE_URL=$NEW_URL"
  gcloud run services update "$SERVICE" --region="$REGION" --update-env-vars="PUBLIC_BASE_URL=$NEW_URL" >/dev/null
fi

if ! $DEPLOY_ONLY; then
  echo "▶ Cloud Scheduler: hourly cleanup"
  CRON=$(gcloud secrets versions access latest --secret=cron-secret)
  gcloud scheduler jobs describe "${SERVICE}-cleanup" --location="$REGION" >/dev/null 2>&1 && \
    gcloud scheduler jobs delete "${SERVICE}-cleanup" --location="$REGION" --quiet >/dev/null
  gcloud scheduler jobs create http "${SERVICE}-cleanup" --location="$REGION" \
    --schedule="17 * * * *" --uri="$NEW_URL/tasks/cleanup" --http-method=POST \
    --headers="x-cron-secret=$CRON" >/dev/null
fi

echo
echo "✅ Deployed: $NEW_URL"
echo "   Webhook:   $NEW_URL/api/line/webhook"
echo "   LIFF endpoint URL: $NEW_URL/"
echo "Next: npx tsx scripts/line-setup.ts $NEW_URL"
