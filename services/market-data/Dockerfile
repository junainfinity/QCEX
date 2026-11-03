FROM node:24.21.0-alpine@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a
WORKDIR /app
COPY --chown=node:node services/market-data/*.mjs ./
USER node
EXPOSE 8090
CMD ["node", "server.mjs"]
