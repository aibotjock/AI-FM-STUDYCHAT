FROM node:24-bookworm-slim AS voice-assets
WORKDIR /build
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tools ./tools
RUN npm run build:voice

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# Build dependencies stay in the previous image stage. Node remains dependency-free.
COPY package.json ./
COPY server ./server
COPY public ./public
COPY --from=voice-assets /build/public/voice-assets ./public/voice-assets
COPY packages ./packages
COPY content ./content

# Fail the image build if this Node image cannot supply the SQLite API.
RUN node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY)'); db.close();"

# Railway mounts the private SQLite volume here at container start.
# The default root UID matches Railway volume ownership.
EXPOSE 3000
CMD ["npm", "start"]
