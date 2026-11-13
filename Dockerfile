# INFINI AI — container image. No build step and no dependencies: the image is Node plus this repository.
# It serves the published Infinity LLM in model/. It does not train: training needs Python and PyTorch and a writable
# state directory (docs/INFINITY-LLM.md); run that on a host with `node server/server.js` or `node learning/cli.mjs cycle`.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY engine ./engine
COPY learning ./learning
COPY model ./model
COPY server ./server
COPY public ./public
COPY cli.js ./
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "--max-old-space-size=256", "server/server.js"]
