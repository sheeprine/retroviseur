FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public/ ./public/

RUN addgroup -S retro && adduser -S retro -G retro
USER retro

EXPOSE 3000
ENV NODE_ENV=production PORT=3000

CMD ["node", "server.js"]
