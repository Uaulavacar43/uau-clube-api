#!/bin/bash

# Script para fazer build e deploy da API no Cloud Run
# Usa Cloud Build do Google Cloud

set -e

PROJECT_ID="metal-music-479113-v9"
REGION="us-central1"
SERVICE_NAME="uau-clube-api"
IMAGE_NAME="us-central1-docker.pkg.dev/${PROJECT_ID}/uau/${SERVICE_NAME}"

echo "🚀 Iniciando build e deploy da API..."

# 1. Fazer push do código (se necessário)
echo "📤 Fazendo push do código..."
git push origin main || echo "⚠️  Push falhou ou já está atualizado"

# 2. Fazer build e push da imagem usando Cloud Build
echo "🔨 Fazendo build da imagem Docker no Cloud Build..."
gcloud builds submit --tag ${IMAGE_NAME}:latest \
  --project=${PROJECT_ID} \
  --region=${REGION}

# 3. Fazer deploy no Cloud Run
echo "🚀 Fazendo deploy no Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME}:latest \
  --region ${REGION} \
  --project ${PROJECT_ID} \
  --platform managed \
  --allow-unauthenticated

echo "✅ Deploy concluído com sucesso!"
echo "🌐 URL do serviço:"
gcloud run services describe ${SERVICE_NAME} --region ${REGION} --project ${PROJECT_ID} --format 'value(status.url)'

