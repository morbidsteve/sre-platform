# Stage 1: Build React SPA
FROM node:20-alpine3.19 AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ .
COPY package.json /app/package.json
RUN npm run build

# Stage 2: Production server
FROM node:20-alpine3.19
WORKDIR /app

# Install crane for pushing bundle images to Harbor
RUN apk add --no-cache curl && \
    curl -sL https://github.com/google/go-containerregistry/releases/download/v0.20.2/go-containerregistry_Linux_x86_64.tar.gz | tar xz -C /usr/local/bin crane && \
    apk del curl && \
    chmod +x /usr/local/bin/crane

COPY package.json package-lock.json* ./
RUN npm install --production

COPY server.js db.js gitops.js logger.js error-knowledge-base.js ./
COPY --from=client-build /app/client/dist ./client/dist
COPY public/ ./public/

USER node

EXPOSE 3001

CMD ["node", "server.js"]
