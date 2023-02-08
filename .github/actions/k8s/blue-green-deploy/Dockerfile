FROM alpine

RUN apk update && \
    apk add \
        --no-cache \
        --upgrade \
            bash \
            curl \
            tar \
            jq

COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]