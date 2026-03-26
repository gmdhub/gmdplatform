FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY server/package*.json ./
RUN npm ci

FROM deps AS build
COPY server/tsconfig.json ./tsconfig.json
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/index.js"]
