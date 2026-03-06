FROM node:20-alpine3.19

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY public/ ./public/

USER node

EXPOSE 3001

CMD ["node", "server.js"]
