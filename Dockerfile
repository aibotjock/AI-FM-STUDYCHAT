FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY content ./content
RUN mkdir -p /app/data && chown node:node /app/data
# Only the fixed ownership initializer runs as root. It drops all identities
# before importing application code. Source stays root-owned and unwritable.
USER root
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server/container-start.js"]
