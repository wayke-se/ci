FROM golang:alpine
WORKDIR /github/workspace

RUN apk update && \
    apk add \
        --no-cache \
        --upgrade \
            bash \
            curl \
            jq

COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]