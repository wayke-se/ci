#!/usr/bin/env bash
set -euo pipefail

KUBECTL_CONFIG=".kubeconfig"
KUBECTL_VERSION="1.26.0"
KUSTOMIZE_VERSION="5.0.0"

APP_NAME=""
APP_VERSION=""
SERVICE_FILE=""
KUSTOMIZE=""
CREDENTIALS=""
RESOURCE_GROUP=""
CLUSTER=""

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
            shift && CLUSTER="${1}"
            ;;
    esac

    shift || break
done

###
# Expand credentials blob into required variables
###
CLIENT_ID=$(echo "${CREDENTIALS}" | jq -r '.clientId')
CLIENT_SECRET=$(echo "${CREDENTIALS}" | jq -r '.clientSecret')
TENANT_ID=$(echo "${CREDENTIALS}" | jq -r '.tenantId')
AUTHORITY=$(echo "${CREDENTIALS}" | jq -r '.activeDirectoryEndpointUrl') || "https://login.microsoftonline.com"
RESOURCE=$(echo "${CREDENTIALS}" | jq -r '.resourceManagerEndpointUrl') || "https://management.azure.com/"
SUBSCRIPTION_ID=$(echo "${CREDENTIALS}" | jq -r '.subscriptionId')

###
# Request access token from Azure
###
ACCESS_TOKEN=$(curl \
    --header "Content-Type: application/x-www-form-urlencoded; charset=utf-8" \
    --data "resource=${RESOURCE}" \
    --data "client_id=${CLIENT_ID}" \
    --data "client_secret=${CLIENT_SECRET}" \
    --data "grant_type=client_credentials" \
    --fail \
    "${AUTHORITY}/${TENANT_ID}/oauth2/token/" | jq -r '.access_token')

###
# Request Kubernetes config blob from Azure
###
KUBECONFIG_DATA=$(curl \
    --header "Authorization: Bearer ${ACCESS_TOKEN}" \
    --header "Content-Type: application/json; charset=utf-8" \
    --fail \
    "${RESOURCE}/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CLUSTER}/accessProfiles/clusterAdmin?api-version=2017-08-31")

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
# Download & install kubectl
###
curl -sLO https://storage.googleapis.com/kubernetes-release/release/v${KUBECTL_VERSION}/bin/linux/amd64/kubectl
mv kubectl /usr/bin/kubectl
chmod +x /usr/bin/kubectl

###
# Download & install kustomize
###
curl -sLO https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv${KUSTOMIZE_VERSION}/kustomize_v${KUSTOMIZE_VERSION}_linux_amd64.tar.gz
tar xvzf kustomize_v${KUSTOMIZE_VERSION}_linux_amd64.tar.gz && \
mv kustomize /usr/bin/kustomize && \
chmod +x /usr/bin/kustomize

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
