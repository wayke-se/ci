#!/usr/bin/env bash
set -euo pipefail

REQUIREMENTS_FILE=""

while (( "$#" )); do
    case $1 in
        --requirements-file)
            shift && REQUIREMENTS_FILE="${1}"
            ;;
    esac

    shift || break
done

pip-audit -l -r ${REQUIREMENTS_FILE}
