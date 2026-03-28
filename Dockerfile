# wordpress-mcp-direct/Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Fix DNS: Docker inherits broken systemd-resolved chain.
# Write resolv.conf at container start before launching node.
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 9090
ENV NODE_ENV=production

ENTRYPOINT ["/app/entrypoint.sh"]
