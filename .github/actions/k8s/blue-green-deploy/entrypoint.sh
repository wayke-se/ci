#!/usr/bin/env bash
set -euo pipefail

KUBECTL_CONFIG=".kubeconfig"

APP_NAME=""
APP_VERSION=""
SERVICE_FILE=""
KUSTOMIZE=""
CREDENTIALS=""
RESOURCE_GROUP=""
CLUSTER_NAME=""

while (( "$#" )); do
    case $1 in
        --app)
            shift && APP_NAME="${1}"
            ;;
        --app-version)
            shift && APP_VERSION="${1:0:7}"
            ;;
        --service-file)
            shift && SERVICE_FILE="${1}"
            ;;
        --kustomize)
            shift && KUSTOMIZE="${1}"
            ;;
        --credentials)
            shift && CREDENTIALS="${1}"
            ;;
        --resource-group)
            shift && RESOURCE_GROUP="${1}"
            ;;
        --cluster)
            shift && CLUSTER_NAME="${1}"
            ;;
    esac

    shift || break
done

echo "Starting deploy for ${RESOURCE_GROUP}/${CLUSTER_NAME}..."

###
# Expand credentials blob into required variables
###
CLIENT_ID=$(echo "${CREDENTIALS}" | jq -r '.clientId')
CLIENT_SECRET=$(echo "${CREDENTIALS}" | jq -r '.clientSecret')
TENANT_ID=$(echo "${CREDENTIALS}" | jq -r '.tenantId')
AUTHORITY_HOST=$(echo "${CREDENTIALS}" | jq -r '.activeDirectoryEndpointUrl') || "https://login.microsoftonline.com"
RESOURCE_HOST=$(echo "${CREDENTIALS}" | jq -r '.resourceManagerEndpointUrl') || "https://management.azure.com/"
SUBSCRIPTION_ID=$(echo "${CREDENTIALS}" | jq -r '.subscriptionId')

###
# Request access token from Azure
###
ACCESS_TOKEN=$(curl \
    --header "Content-Type: application/x-www-form-urlencoded; charset=utf-8" \
    --data "resource=${RESOURCE_HOST}" \
    --data "client_id=${CLIENT_ID}" \
    --data "client_secret=${CLIENT_SECRET}" \
    --data "grant_type=client_credentials" \
    --silent \
    --fail \
    "${AUTHORITY_HOST}/${TENANT_ID}/oauth2/token/" | jq -r '.access_token')

###
# Request Kubernetes config blob from Azure
###
KUBECONFIG_DATA=$(curl \
    --header "Authorization: Bearer ${ACCESS_TOKEN}" \
    --header "Content-Type: application/json; charset=utf-8" \
    --silent \
    --fail \
    "${RESOURCE_HOST}subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CLUSTER_NAME}/accessProfiles/clusterAdmin?api-version=2017-08-31")

K8SCFG=""
PROPERTIES_DATA=$(echo KUBECONFIG_DATA | jq -r '.properties.kubeConfig')
if [ ! -z "${PROPERTIES_DATA}" ]; then
    K8SCFG=$(echo "${PROPERTIES_DATA}" | base64 -d)
else
    K8SCFG="${KUBECONFIG_DATA}"
fi

echo "${K8SCFG}" > "${KUBECTL_CONFIG}"
export KUBECONFIG="${KUBECTL_CONFIG}"

###
# Store a flag to determine if there's a deployment active
###
RUNNING_VERSION=$(kubectl get deploy -l app=${APP_NAME} -o json | jq -r '.items[0].metadata.name')

###
# If there's no existing Service resource, let's create it
# - since it's not part of Kustomize deployment due to
# blue/green deployment handling
###
if [ "$(kubectl get svc -l app=${APP_NAME} -o json | jq -r '.items')" == "[]" ]; then
    kubectl apply -f "${SERVICE_FILE}"
fi

###
# Inject blue/green deploy values into Kubernetes deployment definition
###
WRKDIR=$(dirname("${SERVICE_FILE}"))
pushd $WORKDIR
kustomize edit set namesuffix -- "-${APP_VERSION}"
kustomize edit add label "release-tag:${APP_VERSION}"
popd

###
# Apply Kustomize resources
###
kubectl apply --kustomize "${KUSTOMIZE}"

###
# Watch and await the rollout before continuing
# with blue/green deployment
###
NEXT_VERSION=$(kubectl get deploy -l app=${APP_NAME} -o json | jq -r '.items[1].metadata.name')
if [ -z "${NEXT_VERSION}" ]; then
    NEXT_VERSION=$(kubectl get deploy -l app=${APP_NAME} -o json | jq -r '.items[0].metadata.name')
fi
kubectl rollout status deploy/"${NEXT_VERSION}" --watch --timeout 10m

###
# Create a patch file to match the new deployment
###
PATCH_FILE="patch-file-${APP_VERSION}.yaml"
cat << EOF > "${PATCH_FILE}"
spec:
  selector:
    release-tag: "${APP_VERSION}"
EOF

###
# Patch the Service resource with the selector of
# the newly created deployment
###
kubectl patch svc/"${APP_NAME}" --patch "$(cat "${PATCH_FILE})"

###
# If we had an active deployment before this release,
# clean it up
###
if [ ! -z "${RUNNING_VERSION}" ]; then
    kubectl delete deploy "${RUNNING_VERSION}"
fi
