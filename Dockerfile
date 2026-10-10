ARG NODE_VERSION=24.14.0

FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node drizzle ./drizzle
COPY --from=builder --chown=node:node /app/package.json ./
USER node
EXPOSE 8080
CMD ["node", "--import", "./dist/instrument.js", "dist/main.js"]
