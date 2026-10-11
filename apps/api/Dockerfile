FROM golang:1.27-alpine AS build
WORKDIR /src
# Dependencies first, on their own layer: it is rebuilt only when go.mod or
# go.sum change, not on every code edit.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/prismo ./cmd/prismo

# One image, two roles: `prismo serve` (API) and `prismo work` (ffmpeg jobs).
FROM alpine:3.22
RUN apk add --no-cache ffmpeg ca-certificates tzdata && adduser -D -u 10001 prismo
USER prismo
COPY --from=build /out/prismo /usr/local/bin/prismo
EXPOSE 8080
ENTRYPOINT ["prismo"]
CMD ["serve"]
