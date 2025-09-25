#!/usr/bin/env bash
set -euo pipefail

if [ -z "${OSSI_TOKEN:-}" ]; then
    echo "Error: OSSI_TOKEN environment variable is not set"
    echo "Please ensure the nancy-token input is provided to the action"
    exit 1
fi

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

if [ -z "${DEP_FILE}" ] || [ ! -f "${DEP_FILE}" ]; then
    echo "Error: Dependency file '${DEP_FILE}' not found or not specified"
    exit 1
fi

# OSSI_USERNAME is hardcoded to admin@wayketech.se in action.yml
# Run nancy sleuth - credentials are read from environment variables (OSSI_TOKEN and OSSI_USERNAME)
cat $DEP_FILE | nancy sleuth
