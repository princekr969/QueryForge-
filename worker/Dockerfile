FROM node:20-alpine

WORKDIR /app

# Proto file (shared between coordinator and worker)
COPY proto/ /proto/

# Install dependencies — npm ci is reproducible
COPY worker/package.json worker/package-lock.json* ./
RUN npm install --omit=dev

# Copy worker source
COPY worker/ .

EXPOSE 50051 9464

CMD ["node", "-r", "./tracing.js", "src/index.js"]
