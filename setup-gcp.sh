#!/usr/bin/env bash
# setup-gcp.sh — one-time GCP project bootstrap
# Usage: PROJECT_ID=my-project bash setup-gcp.sh

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID before running this script}"
REGION="${REGION:-us-central1}"
SERVICE="notion-mcp-server"
REPO="notion-mcp"
SA_NAME="notion-mcp-deploy"

echo "==> Creating GCP project: $PROJECT_ID"
gcloud projects create "$PROJECT_ID" --set-as-default || true
gcloud config set project "$PROJECT_ID"

echo "==> Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com

echo "==> Creating Artifact Registry repository"
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Notion MCP Server images" || true

echo "==> Storing Notion token in Secret Manager"
echo -n "Paste your NOTION_TOKEN and press Enter: "
read -rs NOTION_TOKEN
echo
printf '%s' "$NOTION_TOKEN" | gcloud secrets create notion-token --data-file=- || \
  printf '%s' "$NOTION_TOKEN" | gcloud secrets versions add notion-token --data-file=-

echo "==> Creating service account for GitHub Actions"
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Notion MCP Deploy SA" || true

SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")

for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/iam.serviceAccountTokenCreator \
  roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" --role="$ROLE"
done

# Also allow Cloud Run runtime SA to access secrets
CLOUDRUN_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding notion-token \
  --member="serviceAccount:$CLOUDRUN_SA" \
  --role="roles/secretmanager.secretAccessor"

echo "==> Creating Workload Identity Federation pool for GitHub Actions"
POOL="github-pool"
PROVIDER="github-provider"
GITHUB_ORG="cal-group"

gcloud iam workload-identity-pools create "$POOL" \
  --location=global \
  --display-name="GitHub Actions Pool" || true

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --location=global \
  --workload-identity-pool="$POOL" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com" || true

POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL" \
  --location=global --format="value(name)")

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_ORG}/notion-mcp-server"

PROVIDER_ID=$(gcloud iam workload-identity-pools providers describe "$PROVIDER" \
  --location=global \
  --workload-identity-pool="$POOL" \
  --format="value(name)")

echo ""
echo "===== Add these secrets to your GitHub repo ====="
echo "GCP_PROJECT_ID:                $PROJECT_ID"
echo "GCP_SERVICE_ACCOUNT:           $SA_EMAIL"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER: $PROVIDER_ID"
echo "=================================================="
echo ""
echo "==> Setup complete! Push to main to trigger your first deploy."
