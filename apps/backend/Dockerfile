FROM node:22-alpine

WORKDIR /app

COPY apps/backend/package.json apps/backend/package-lock.json* ./apps/backend/
RUN cd apps/backend && npm install --omit=dev --no-audit --no-fund

COPY apps/backend/tsconfig.json ./apps/backend/tsconfig.json
COPY apps/backend/src ./apps/backend/src
COPY db ./db

WORKDIR /app/apps/backend
USER node

CMD ["npx", "tsx", "src/server.ts"]
