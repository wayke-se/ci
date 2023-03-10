#!/usr/bin/env bash
set -euo pipefail

NANCY_VERSION=$(curl --fail -s https://api.github.com/repos/sonatype-nexus-community/nancy/releases/latest | jq -r '.tag_name')
curl --fail -L -o nancy.apk "https://github.com/sonatype-nexus-community/nancy/releases/download/${NANCY_VERSION}/nancy_${NANCY_VERSION:1}_linux_amd64.apk"
apk add --no-progress --quiet --no-cache --allow-untrusted nancy.apk

DEP_FILE=""

while (( "$#" )); do
    case $1 in
        --dep-file)
            shift && DEP_FILE="${1}"
            ;;
    esac

    shift || break
done

cat $DEP_FILE | nancy sleuth
