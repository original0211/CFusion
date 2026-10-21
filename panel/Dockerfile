FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node src ./src
COPY --chown=node:node LICENSE NOTICE.md ./
USER node
ENV HOST=0.0.0.0 PORT=3100
EXPOSE 3100
CMD ["node", "src/server.mjs"]
