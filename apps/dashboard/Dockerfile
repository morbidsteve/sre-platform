# Stage 1: Build React SPA
FROM node:20-alpine3.19 AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ .
RUN npm run build

# Stage 2: Production server
FROM node:20-alpine3.19
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY server.js db.js gitops.js logger.js ./
COPY --from=client-build /app/client/dist ./client/dist
COPY public/ ./public/

USER node

EXPOSE 3001

CMD ["node", "server.js"]
