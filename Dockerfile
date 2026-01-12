# Dockerfile

# Imagem base
FROM node:22-alpine

# Instalar OpenSSL (necessário para o Prisma em Alpine)
# REMOVIDO: openssl1.1-compat (não existe no Alpine do node:22)
RUN apk add --no-cache openssl

# Diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copia apenas package.json e package-lock.json para aproveitar cache
COPY package*.json ./

# Instala TODAS as dependências (incluindo dev)
RUN npm ci

# Copia o restante do código (inclui prisma/schema.prisma)
COPY . .

# Gera o Prisma Client
RUN npx prisma generate

# Build (gera dist/ via tsup)
RUN npm run build

# Remove dependências de dev para imagem ficar mais leve
# IMPORTANTE: Reinstala prisma como dependência de produção
RUN npm prune --omit=dev && npm install prisma@^5.21.1 --save --no-save

# Define ambiente de produção
ENV NODE_ENV=production
# Porta padrão (o App Runner pode sobrescrever, mas é bom ter um default)
ENV PORT=8080
# Host padrão para containers (0.0.0.0 = escuta em todas as interfaces)
ENV HOST=0.0.0.0

# Comando de inicialização otimizado para AWS App Runner
CMD npx prisma migrate deploy || echo "[Docker] Warning: Database migrations failed, but server will start anyway" && node dist/server.js
