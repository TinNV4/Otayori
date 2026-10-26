FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json server.ts tsconfig.json ./
COPY src ./src
# tsx is a runtime dependency (server is TypeScript, run without a separate compile step).
CMD ["node", "--import", "tsx", "server.ts"]
