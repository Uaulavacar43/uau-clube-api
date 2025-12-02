# 1. ESTÁGIO DE BUILD (Para instalar dependências e compilar o código)
FROM node:22-alpine AS build

# Instala a dependência libssl (openssl) necessária para o Prisma funcionar
# Isso corrige o erro "libssl.so.1.1: No such file or directory" no Google Cloud Run.
RUN apk update && apk add --no-cache openssl

# Diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copia package.json e package-lock.json (necessário para 'npm ci' e para aproveitar cache)
COPY package*.json ./

# Instala TODAS as dependências (incluindo dev para o build e o Prisma generate)
RUN npm ci

# Copia o restante do código
COPY . .

# Gera o Prisma Client.
RUN npx prisma generate

# Compila o TypeScript para JavaScript (saída em dist/)
RUN npm run build


# 2. ESTÁGIO DE PRODUÇÃO (Imagem final e leve)
FROM node:22-alpine AS final

# Instala openssl novamente para o Query Engine rodar na imagem final
RUN apk update && apk add --no-cache openssl

# Diretório de trabalho
WORKDIR /usr/src/app

# COPIA OS ARQUIVOS ESSENCIAIS:
# 1. package.json e package-lock.json (Para instalar dependências de produção)
COPY --from=build /usr/src/app/package*.json ./

# 2. Instala apenas as dependências de produção (utilizando o lockfile copiado)
# O comando 'npm install --omit=dev' é usado aqui no lugar de 'npm ci' para maior flexibilidade
# no estágio final, pois não precisamos que a instalação seja feita do zero e ele respeita o lockfile.
RUN npm install --omit=dev

# 3. Copia o código compilado e o motor do Prisma
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/node_modules/.prisma/client/ ./node_modules/.prisma/client/

# Define ambiente de produção
ENV NODE_ENV=production

# Comando de inicialização
CMD ["node", "dist/server.js"]