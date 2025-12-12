#!/usr/bin/env bash
set -euo pipefail

YAML_FILE="${1:-cloud-run.yaml}"
OUT_FILE="${2:-.env}"

# Extrai envs name/value do YAML (apenas o que estiver como "value: ...")
# Observação: isso não resolve Secret Manager; é para YAML "cru" como o seu.
extract() {
  awk '
    $1=="-" && $2=="name:" {name=$3; gsub(/"/,"",name)}
    $1=="value:" {val=$2; for(i=3;i<=NF;i++) val=val" "$i; gsub(/"/,"",val); print name"="val}
  ' "$YAML_FILE"
}

# Campos sensíveis que vamos mascarar no .env gerado
mask_sensitive() {
  sed -E \
    -e 's/^(DATABASE_URL)=.*/\1=__COLE_AQUI__/g' \
    -e 's/^(JWT_SECRET)=.*/\1=__COLE_AQUI__/g' \
    -e 's/^(MAILER_PASS)=.*/\1=__COLE_AQUI__/g' \
    -e 's/^(ASAAS_API_KEY)=.*/\1=__COLE_AQUI__/g'
}

{
  echo "# Gerado a partir de $YAML_FILE"
  extract | mask_sensitive
} > "$OUT_FILE"

echo "OK: $OUT_FILE gerado (segredos mascarados)."
echo "Agora preencha DATABASE_URL / JWT_SECRET / MAILER_PASS / ASAAS_API_KEY manualmente."
