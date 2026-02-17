# Stage 1: Build the frontend
FROM node:22-alpine AS frontend
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build the Go server
FROM golang:1.25-alpine AS backend
RUN apk add --no-cache ca-certificates
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# Copy built frontend into static/ so it gets embedded via //go:embed
COPY --from=frontend /app/server/static ./static
RUN CGO_ENABLED=0 go build -o /hn-server .

# Stage 3: Scratch runtime (tzdata embedded via time/tzdata, certs copied from build stage)
FROM scratch
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=backend /hn-server /hn-server

CMD ["/hn-server"]
