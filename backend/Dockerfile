FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev
COPY backend backend
COPY database database
COPY packages packages
WORKDIR /app/backend
ENV NODE_ENV=production
EXPOSE 4000
# Applique les migrations puis démarre l'API (premier démarrage : `docker compose exec backend node scripts/seed.js`).
CMD ["sh", "-c", "node scripts/migrate.js && node api.js"]
