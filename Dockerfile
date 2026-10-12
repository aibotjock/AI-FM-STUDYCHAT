# Stage 1: download the on-device speech engine and models (~60 MB) at build time,
# so phones fetch them from this app instead of third-party sites.
FROM public.ecr.aws/docker/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS speech
RUN apk add --no-cache tar bzip2
WORKDIR /build
COPY scripts/vendor/fetch-sherpa-assets.mjs ./
RUN node fetch-sherpa-assets.mjs /build/sherpa

FROM public.ecr.aws/docker/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY --from=speech /build/sherpa ./public/sherpa
COPY content ./content
RUN mkdir -p /app/data && chown node:node /app/data
# Only the fixed ownership initializer runs as root. It drops all identities
# before importing application code. Source stays root-owned and unwritable.
USER root
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server/container-start.js"]
