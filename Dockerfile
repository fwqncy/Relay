FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN mkdir -p ../internal/server/dist && npm run build

FROM golang:1.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/internal/server/dist ./internal/server/dist
RUN CGO_ENABLED=0 go build -buildvcs=false -o /relay ./cmd/relay

FROM gcr.io/distroless/static-debian12
COPY --from=build /relay /relay
EXPOSE 8080
ENTRYPOINT ["/relay"]
