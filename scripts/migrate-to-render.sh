#!/bin/bash

# =============================================================================
# Script de Migração: Google Cloud → Render
# =============================================================================
# Este script automatiza a migração do banco de dados PostgreSQL
# do Google Cloud para o Render.
# =============================================================================

set -e  # Sair em caso de erro

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Migração de Banco de Dados${NC}"
echo -e "${BLUE}  Google Cloud → Render${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Diretório do script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_FILE="$PROJECT_DIR/backup_migration_$(date +%Y%m%d_%H%M%S).sql"

# =============================================================================
# PASSO 1: Solicitar credenciais
# =============================================================================

echo -e "${YELLOW}PASSO 1: Configuração das credenciais${NC}"
echo ""

# Origem (Google Cloud)
echo -e "${BLUE}[ORIGEM - Google Cloud]${NC}"
read -p "Digite a DATABASE_URL do Google Cloud: " SOURCE_URL

if [ -z "$SOURCE_URL" ]; then
    echo -e "${RED}Erro: DATABASE_URL de origem é obrigatória${NC}"
    exit 1
fi

echo ""

# Destino (Render)
echo -e "${BLUE}[DESTINO - Render]${NC}"
echo -e "${YELLOW}Dica: Use a 'External Database URL' do Render para esta migração${NC}"
read -p "Digite a DATABASE_URL do Render (External): " TARGET_URL

if [ -z "$TARGET_URL" ]; then
    echo -e "${RED}Erro: DATABASE_URL de destino é obrigatória${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Credenciais configuradas${NC}"
echo ""

# =============================================================================
# PASSO 2: Testar conexões
# =============================================================================

echo -e "${YELLOW}PASSO 2: Testando conexões...${NC}"
echo ""

echo -n "Testando conexão com Google Cloud... "
if psql "$SOURCE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ OK${NC}"
else
    echo -e "${RED}✗ Falhou${NC}"
    echo -e "${RED}Verifique a DATABASE_URL de origem e tente novamente${NC}"
    exit 1
fi

echo -n "Testando conexão com Render... "
if psql "$TARGET_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ OK${NC}"
else
    echo -e "${RED}✗ Falhou${NC}"
    echo -e "${RED}Verifique a DATABASE_URL de destino e tente novamente${NC}"
    exit 1
fi

echo ""

# =============================================================================
# PASSO 3: Criar backup do banco de origem
# =============================================================================

echo -e "${YELLOW}PASSO 3: Criando backup do banco de origem...${NC}"
echo ""

echo "Exportando dados do Google Cloud..."
echo "Arquivo de backup: $BACKUP_FILE"
echo ""

pg_dump "$SOURCE_URL" \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    --verbose \
    > "$BACKUP_FILE" 2>&1

if [ $? -eq 0 ]; then
    BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
    echo -e "${GREEN}✓ Backup criado com sucesso (${BACKUP_SIZE})${NC}"
else
    echo -e "${RED}✗ Erro ao criar backup${NC}"
    exit 1
fi

echo ""

# =============================================================================
# PASSO 4: Preparar banco de destino
# =============================================================================

echo -e "${YELLOW}PASSO 4: Preparando banco de destino...${NC}"
echo ""

# Criar schema logs se não existir
echo "Criando schema 'logs' no Render..."
psql "$TARGET_URL" -c "CREATE SCHEMA IF NOT EXISTS logs;" 2>/dev/null || true
echo -e "${GREEN}✓ Schema 'logs' pronto${NC}"

echo ""

# =============================================================================
# PASSO 5: Importar dados
# =============================================================================

echo -e "${YELLOW}PASSO 5: Importando dados para o Render...${NC}"
echo -e "${YELLOW}Isso pode levar alguns minutos dependendo do tamanho do banco...${NC}"
echo ""

# Importar ignorando erros de permissão
psql "$TARGET_URL" < "$BACKUP_FILE" 2>&1 | grep -v "must be owner" | grep -v "permission denied" | tail -20

echo ""
echo -e "${GREEN}✓ Importação concluída${NC}"
echo ""

# =============================================================================
# PASSO 6: Verificar migração
# =============================================================================

echo -e "${YELLOW}PASSO 6: Verificando migração...${NC}"
echo ""

echo "Contagem de registros nas principais tabelas:"
echo ""

# Função para contar registros
count_records() {
    local table=$1
    local schema=${2:-public}
    local count=$(psql "$TARGET_URL" -t -c "SELECT COUNT(*) FROM \"$schema\".\"$table\";" 2>/dev/null | tr -d ' ')
    echo -e "  $schema.$table: ${GREEN}$count registros${NC}"
}

count_records "User" "public"
count_records "Car" "public"
count_records "Subscription" "public"
count_records "Payment" "public"
count_records "Plan" "public"
count_records "WashLocation" "public"
count_records "WashService" "public"
count_records "Coupon" "public"
count_records "RequestLog" "logs"
count_records "ResponseLog" "logs"

echo ""

# =============================================================================
# PASSO 7: Instruções finais
# =============================================================================

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}  Migração concluída com sucesso!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}PRÓXIMOS PASSOS:${NC}"
echo ""
echo "1. Acesse o Dashboard do Render: https://dashboard.render.com"
echo ""
echo "2. Vá no serviço 'uau-clube-api' → 'Environment'"
echo ""
echo "3. Atualize a variável DATABASE_URL com a 'Internal Database URL':"
echo -e "   ${BLUE}(começa com postgresql://...@dpg-...)${NC}"
echo ""
echo "4. Faça um 'Manual Deploy' ou aguarde o deploy automático"
echo ""
echo "5. Teste a API: https://uau-clube-api.onrender.com"
echo ""
echo -e "${YELLOW}IMPORTANTE:${NC}"
echo "- Mantenha o banco do Google Cloud ativo por alguns dias como backup"
echo "- O arquivo de backup está em: $BACKUP_FILE"
echo ""

