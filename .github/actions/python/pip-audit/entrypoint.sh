#!/usr/bin/env bash
set -euo pipefail

REQUIREMENTS_FILE=""
CACHE_DIR="/.cache/dir"

while (( "$#" )); do
    case $1 in
        --requirements-file)
            shift && REQUIREMENTS_FILE="${1}"
            ;;
    esac

    shift || break
done

mkdir -p "${CACHE_DIR}"
pip-audit -l --cache-dir "${CACHE_DIR}" -r ${REQUIREMENTS_FILE}
