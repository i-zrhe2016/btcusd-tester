FROM node:22-alpine
WORKDIR /app
COPY services/payments/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY services/payments/src ./src
USER node
ENV NODE_ENV=production PORT=8083
EXPOSE 8083
CMD ["node", "src/server.js"]
