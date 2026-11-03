FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# No npm installation is needed: the app only uses Node.js built-in modules.
# Copy an allowlist, never local databases, credentials, or browser sessions.
COPY package.json server.js ./
COPY public/ ./public/
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "server.js"]
