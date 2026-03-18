FROM node:20-alpine

WORKDIR /app

# Installe uniquement les dépendances de production
COPY package*.json ./
RUN npm ci --omit=dev

# Copie le code source
COPY server.js ./
COPY public/ ./public/

EXPOSE 3001

CMD ["node", "server.js"]
