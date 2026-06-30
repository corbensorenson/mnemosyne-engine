FROM node:22.13.0-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services
COPY infra ./infra
COPY master-graph ./master-graph
COPY tsconfig.json tsconfig.base.json ./
COPY eslint.config.js .prettierrc.json ./

RUN npm ci --omit=optional

ENV NODE_ENV=production
ENV MNEMOSYNE_OBJECT_STORAGE_ROOT=/var/lib/mnemosyne/objects

EXPOSE 8787

CMD ["npm", "run", "api:dev"]
