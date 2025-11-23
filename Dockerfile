# Imagem base
FROM node:22-alpine

# Diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copia apenas package.json e package-lock.json para aproveitar cache
COPY package*.json ./

# Instala TODAS as dependências (incluindo dev) para poder buildar TypeScript
RUN npm ci

# Copia o restante do código
COPY . .

# Build (gera dist/ via tsup)
RUN npm run build

# Remove dependências de dev para imagem ficar mais leve
RUN npm prune --omit=dev

# Define ambiente de produção
ENV NODE_ENV=production

# Porta que a app escuta (mesma do .env)
ENV PORT=3002

# Comando de inicialização
CMD ["node", "dist/server.js"]
