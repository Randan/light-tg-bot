FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# after npm ci: a new commit must not invalidate the dependency layer
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
CMD ["node", "dist/main.js"]
