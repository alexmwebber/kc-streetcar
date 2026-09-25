# --- Build stage: compile TypeScript to dist/ ---
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY db ./db
RUN npm run build

# --- Runtime stage: production deps + compiled output only ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
# tsc doesn't copy .sql files; the migrate script reads them from db/migrations
# relative to its compiled location (dist/db/migrations).
COPY db/migrations ./dist/db/migrations
# Same for .json data files: routeGeometry.ts reads the route alignment at runtime
# relative to its compiled location (dist/src/lib -> dist/src/data).
COPY src/data ./dist/src/data

EXPOSE 3001
CMD ["node", "dist/src/index.js"]
