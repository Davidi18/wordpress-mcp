# wordpress-mcp-direct/Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 9090
ENV NODE_ENV=production

CMD ["node", "wordpress-mcp-server.js"]
