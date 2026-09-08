# L6: multi-stage — production runs precompiled `tsc` output as non-root.
# Nothing TypeScript, no devDependencies, and no JIT compiler ships.
# Base images are digest-pinned; bump together with .github/dependabot.yml.

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps
WORKDIR /app/apps/backend
COPY apps/backend/package.json apps/backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app/apps/backend
COPY apps/backend/package.json apps/backend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY apps/backend/tsconfig.json apps/backend/tsconfig.build.json ./
COPY apps/backend/src ./src
RUN npm run build

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runtime
WORKDIR /app
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build --chown=node:node /app/apps/backend/dist ./apps/backend/dist
COPY --chown=node:node apps/backend/package.json ./apps/backend/package.json
COPY --chown=node:node db ./db
WORKDIR /app/apps/backend
USER node
# 8080 = API server; 8081 = worker health endpoint (same image, both roles).
EXPOSE 8080 8081
CMD ["node", "dist/server.js"]
