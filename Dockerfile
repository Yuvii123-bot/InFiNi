# INFINI AI — container image. No build step and no dependencies: the image is Node plus this repository.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY engine ./engine
COPY server ./server
COPY public ./public
COPY cli.js ./
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "--max-old-space-size=256", "server/server.js"]
