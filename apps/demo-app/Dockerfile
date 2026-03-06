FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /demo-app .

FROM scratch
COPY --from=builder /demo-app /demo-app
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["/demo-app"]
