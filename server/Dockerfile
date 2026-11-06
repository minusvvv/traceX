FROM node:24-bookworm-slim
WORKDIR /app/server
ENV NODE_ENV=production
COPY --chown=node:node server/package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server/ ./
USER node
EXPOSE 5000
CMD ["node", "server.js"]
