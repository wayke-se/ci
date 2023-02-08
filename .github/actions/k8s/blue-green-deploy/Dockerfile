FROM alpine:edge

RUN apk update && \
    apk add \
        --no-cache \
        --upgrade \
            bash \
            curl \
            tar \
            jq \
            kustomize

RUN apk add \
        --no-cache \
        --upgrade \
        --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing/ \
            kubectl

COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]