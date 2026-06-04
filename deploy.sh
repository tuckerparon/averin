#!/bin/bash
# Averin — Azure Container Apps deployment script
# Reads secrets from environment variables. Set these before running:
#
#   export AZURE_FHIR_CLIENT_SECRET=...
#   export GEMINI_API_KEY=...
#   export AZURE_OPENAI_API_KEY=...
#   export AZURE_DOCUMENT_INTELLIGENCE_KEY=...
#   export AZURE_STORAGE_CONNECTION_STRING=...
#   export PG_PASS=...
#
# Or source your .env file: set -o allexport && source .env && set +o allexport
set -e

RESOURCE_GROUP="averin-rg"
REGISTRY="averinregistry"
IMAGE="averinregistry.azurecr.io/averin-api:latest"
ENV_NAME="averin-env"
APP_NAME="averin-api"
LOCATION="eastus"
PG_HOST="averin-postgres.postgres.database.azure.com"

# Validate required secrets are set
: "${PG_PASS:?PG_PASS is required}"
: "${AZURE_FHIR_CLIENT_SECRET:?AZURE_FHIR_CLIENT_SECRET is required}"
: "${GEMINI_API_KEY:?GEMINI_API_KEY is required}"
: "${AZURE_OPENAI_API_KEY:?AZURE_OPENAI_API_KEY is required}"
: "${AZURE_DOCUMENT_INTELLIGENCE_KEY:?AZURE_DOCUMENT_INTELLIGENCE_KEY is required}"
: "${AZURE_STORAGE_CONNECTION_STRING:?AZURE_STORAGE_CONNECTION_STRING is required}"

echo "==> Step 1: Enable ACR admin..."
az acr update --name "$REGISTRY" --admin-enabled true

echo "==> Step 2: Get ACR credentials..."
ACR_USER=$(az acr credential show --name "$REGISTRY" --query username -o tsv)
ACR_PASS=$(az acr credential show --name "$REGISTRY" --query "passwords[0].value" -o tsv)
echo "    ACR user: $ACR_USER"

echo "==> Step 3: Create Container Apps environment..."
az containerapp env create \
  --name "$ENV_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION"

echo "==> Step 4: Create Container App..."
# NOTE: build image with --platform linux/amd64 on Apple Silicon before running this
az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENV_NAME" \
  --image "$IMAGE" \
  --registry-server "averinregistry.azurecr.io" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --target-port 8000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 2 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --env-vars \
    "DATABASE_URL=postgresql+asyncpg://averin:${PG_PASS}@${PG_HOST}/averin?ssl=require" \
    "AZURE_FHIR_URL=https://averinhealth-averin-fhir.fhir.azurehealthcareapis.com" \
    "AZURE_FHIR_TENANT_ID=b75ad7da-c87f-4ba1-897b-37a0581af133" \
    "AZURE_FHIR_CLIENT_ID=b8522400-692f-4917-b6e2-c1e0598eb899" \
    "AZURE_FHIR_CLIENT_SECRET=${AZURE_FHIR_CLIENT_SECRET}" \
    "GEMINI_API_KEY=${GEMINI_API_KEY}" \
    "AZURE_OPENAI_ENDPOINT=https://averin-openai.openai.azure.com/" \
    "AZURE_OPENAI_API_KEY=${AZURE_OPENAI_API_KEY}" \
    "AZURE_OPENAI_DEPLOYMENT=gpt-4o" \
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small" \
    "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://averin-docai.cognitiveservices.azure.com/" \
    "AZURE_DOCUMENT_INTELLIGENCE_KEY=${AZURE_DOCUMENT_INTELLIGENCE_KEY}" \
    "AZURE_STORAGE_CONTAINER=contracts" \
    "DEMO_PASSWORD=averin2026" \
    "SECRET_KEY=$(openssl rand -hex 32)"

echo "==> Step 5: Set storage connection string (separate due to special chars)..."
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars "AZURE_STORAGE_CONNECTION_STRING=${AZURE_STORAGE_CONNECTION_STRING}"

echo "==> Done! Getting URL..."
az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv
