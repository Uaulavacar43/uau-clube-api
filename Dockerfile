# Dockerfile

# Imagem base
FROM node:22-alpine

# Diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copia apenas package.json e package-lock.json para aproveitar cache
COPY package*.json ./

# Instala TODAS as dependências (incluindo dev) para poder buildar TypeScript e gerar Prisma
RUN npm ci

# Copia o restante do código (inclui prisma/schema.prisma)
COPY . .

# Gera o Prisma Client dentro da imagem
RUN npx prisma generate

# Build (gera dist/ via tsup)
RUN npm run build

# Remove dependências de dev para imagem ficar mais leve
RUN npm prune --omit=dev

# Define ambiente de produção
ENV NODE_ENV=production

# Não fixa PORT aqui: o Cloud Run injeta PORT e seu código lê de process.env.PORT
# Comando de inicialização
CMD ["node", "dist/server.js"]
