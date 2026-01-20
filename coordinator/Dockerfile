FROM node:20-alpine

WORKDIR /app

# Proto file (shared between coordinator and worker)
COPY proto/ /proto/

# Install dependencies — npm ci is reproducible (uses lockfile)
COPY coordinator/package.json coordinator/package-lock.json* ./
RUN npm install --omit=dev

# Copy coordinator source
COPY coordinator/ .

EXPOSE 3000 50050 9464

CMD ["node", "-r", "./tracing.js", "src/index.js"]
