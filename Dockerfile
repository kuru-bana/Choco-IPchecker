FROM node:20-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data && chmod +x setup.sh docker-entrypoint.sh

ENV NODE_ENV=production

EXPOSE 10000

CMD ["./docker-entrypoint.sh"]
