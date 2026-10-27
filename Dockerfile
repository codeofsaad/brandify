# Brandify: Node server + built React app + headless Chromium for website analysis.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Install all deps (vite is needed to build), then Chromium and its system libraries.
COPY package.json package-lock.json ./
RUN npm ci --include=dev \
 && npx playwright install --with-deps chromium \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 && mkdir -p out \
 && chmod -R a+rwX out

# Heroku runs containers as an unprivileged user and supplies $PORT.
CMD ["node", "server/index.mjs"]
