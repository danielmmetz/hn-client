# syntax=docker/dockerfile:1

# Stage 1: Build the frontend
FROM node:22-alpine AS frontend
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build the Go server
FROM golang:1.25-alpine AS backend
RUN apk add --no-cache ca-certificates
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY server/ ./
# Copy built frontend into static/ so it gets embedded via //go:embed
COPY --from=frontend /app/server/static ./static
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -o /hn-server .

# Stage 3: Scratch runtime (tzdata embedded via time/tzdata, certs copied from build stage)
FROM scratch
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=backend /hn-server /hn-server

CMD ["/hn-server"]
