#!/usr/bin/env bash
# Shared Terrakube API helpers, sourced by the GitHub workflows.
#
# Required environment:
#   TK_API        Terrakube API base URL (e.g. https://terrakube-api.topia.io)
#   TK_TOKEN      Terrakube PAT (Authorization: Bearer)
#   TK_WORKSPACE  Workspace id (optional; resolved from TK_WORKSPACE_NAME if empty)
#   TK_WORKSPACE_NAME  Workspace name fallback
#   TK_ORG        Organization id (optional; resolved from TK_ORG_NAME if empty)
#   TK_ORG_NAME   Organization name fallback (default: topia-mgmt)
#   TK_BRANCH     Branch to run (default: main)
set -euo pipefail

: "${TK_API:?TK_API is required}"
: "${TK_TOKEN:?TK_TOKEN is required}"
TK_WORKSPACE="${TK_WORKSPACE:-}"
TK_WORKSPACE_NAME="${TK_WORKSPACE_NAME:-}"
TK_ORG="${TK_ORG:-}"
TK_ORG_NAME="${TK_ORG_NAME:-topia-mgmt}"
TK_BRANCH="${TK_BRANCH:-main}"

_tk() {
  # $1 = HTTP method, $2 = path (appended to $TK_API), rest = curl args
  local method="$1" path="$2"
  shift 2
  curl -sS --fail-with-body \
    -X "$method" \
    -H "Authorization: Bearer ${TK_TOKEN}" \
    -H "Content-Type: application/vnd.api+json" \
    -H "Accept: application/vnd.api+json" \
    "$@" \
    "${TK_API}${path}"
}

tk_resolve_org() {
  # Populate TK_ORG from TK_ORG_NAME if it was not provided.
  if [ -n "${TK_ORG}" ]; then
    return 0
  fi
  TK_ORG="$(_tk GET "/api/v1/organization" \
    | jq -r --arg n "${TK_ORG_NAME}" '.data[] | select(.attributes.name==$n) | .id' | head -n1)"
  if [ -z "${TK_ORG}" ]; then
    echo "Could not resolve organization id for '${TK_ORG_NAME}'" >&2
    return 1
  fi
  echo "Resolved organization '${TK_ORG_NAME}' -> ${TK_ORG}" >&2
}

tk_resolve_workspace() {
  # Populate TK_WORKSPACE from TK_WORKSPACE_NAME if it was not provided, so the
  # repo does not have to carry a workspace UUID that Terrakube assigns.
  if [ -n "${TK_WORKSPACE}" ]; then
    return 0
  fi
  if [ -z "${TK_WORKSPACE_NAME}" ]; then
    echo "Set TK_WORKSPACE or TK_WORKSPACE_NAME" >&2
    return 1
  fi
  tk_resolve_org
  TK_WORKSPACE="$(_tk GET "/api/v1/organization/${TK_ORG}/workspace" \
    | jq -r --arg n "${TK_WORKSPACE_NAME}" '.data[] | select(.attributes.name==$n) | .id' | head -n1)"
  if [ -z "${TK_WORKSPACE}" ]; then
    echo "Could not resolve workspace id for '${TK_WORKSPACE_NAME}'" >&2
    return 1
  fi
  echo "Resolved workspace '${TK_WORKSPACE_NAME}' -> ${TK_WORKSPACE}" >&2
}

tk_template_id() {
  # $1 = template name (e.g. "Plan and apply", "Destroy")
  tk_resolve_org
  local id
  id="$(_tk GET "/api/v1/organization/${TK_ORG}/template" \
    | jq -r --arg n "$1" '.data[] | select(.attributes.name==$n) | .id' | head -n1)"
  if [ -z "$id" ]; then
    echo "Template '$1' not found in organization ${TK_ORG}" >&2
    return 1
  fi
  printf '%s' "$id"
}

tk_upsert_var() {
  # $1 key  $2 value  $3 category(TERRAFORM|ENV)  $4 sensitive(bool)  $5 hcl(bool)
  tk_resolve_workspace
  local key="$1" value="$2" category="$3" sensitive="${4:-false}" hcl="${5:-false}"
  local existing_id body
  existing_id="$(_tk GET "/api/v1/workspace/${TK_WORKSPACE}/variable" \
    | jq -r --arg k "$key" '.data[] | select(.attributes.key==$k) | .id' | head -n1)"

  body="$(jq -n \
    --arg k "$key" --arg v "$value" --arg c "$category" \
    --argjson s "$sensitive" --argjson h "$hcl" \
    '{data:{type:"variable",attributes:{key:$k,value:$v,category:$c,sensitive:$s,hcl:$h,description:"managed by github actions"}}}')"

  if [ -n "$existing_id" ]; then
    body="$(printf '%s' "$body" | jq --arg id "$existing_id" '.data.id=$id')"
    _tk PATCH "/api/v1/workspace/${TK_WORKSPACE}/variable/${existing_id}" -d "$body" >/dev/null
    echo "Updated workspace variable ${key}" >&2
  else
    _tk POST "/api/v1/workspace/${TK_WORKSPACE}/variable" -d "$body" >/dev/null
    echo "Created workspace variable ${key}" >&2
  fi
}

tk_create_job() {
  # $1 = template id -> prints job id
  tk_resolve_org
  tk_resolve_workspace
  local body
  body="$(jq -n --arg t "$1" --arg w "${TK_WORKSPACE}" --arg b "${TK_BRANCH}" \
    '{data:{type:"job",attributes:{overrideBranch:$b,templateReference:$t},relationships:{workspace:{data:{type:"workspace",id:$w}}}}}')"
  _tk POST "/api/v1/organization/${TK_ORG}/job" -d "$body" | jq -r '.data.id'
}

tk_wait_job() {
  # $1 = job id ; polls until a terminal status. Returns non-zero on failure.
  tk_resolve_org
  local id="$1" status elapsed=0 timeout="${TK_JOB_TIMEOUT:-3600}" interval=10
  while :; do
    status="$(_tk GET "/api/v1/organization/${TK_ORG}/job/${id}" | jq -r '.data.attributes.status')"
    echo "job ${id}: ${status} (${elapsed}s)"
    case "$status" in
      completed) return 0 ;;
      failed | cancelled | rejected | unknown | notExecuted) return 1 ;;
    esac
    if [ "$elapsed" -ge "$timeout" ]; then
      echo "Timed out waiting for job ${id} after ${timeout}s" >&2
      return 1
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
}

tk_outputs_json() {
  # Prints the latest terraform outputs as JSON ({} if none / not reachable).
  tk_resolve_workspace
  local state_url
  state_url="$(_tk GET "/api/v1/workspace/${TK_WORKSPACE}/history" \
    | jq -r '.data | sort_by(.attributes.createdDate // .id) | last | .attributes.output // empty')"
  if [ -z "$state_url" ]; then
    echo "{}"
    return 0
  fi
  # Terrakube stores state in `terraform show -json` form (outputs under
  # .values.outputs); fall back to raw tfstate (.outputs) just in case.
  curl -sS --fail-with-body -H "Authorization: Bearer ${TK_TOKEN}" "$state_url" \
    | jq '.values.outputs // .outputs // {}' 2>/dev/null || echo "{}"
}
