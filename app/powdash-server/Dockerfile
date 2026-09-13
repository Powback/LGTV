FROM node:20-alpine
WORKDIR /app
COPY server.mjs index.html ./
EXPOSE 4321
ENV PORT=4321
CMD ["node", "server.mjs"]
