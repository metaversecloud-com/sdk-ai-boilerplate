# tofu/

The AWS resources an SDK app owns, applied by **Terrakube** — not by the
runner, and not from `infra-terraform`.

App infrastructure used to be scattered across `infra-terraform`: the bucket in
one workspace, its IAM in another, the cross-account grants in a third. Now that
apps are GitOps-deployed, this directory keeps an app's infrastructure next to
its code so a feature and the bucket it needs move in the same PR.

## What it creates

For an app deployed to ECS in the three prod accounts and to EKS in dev:

| Where | What |
| --- | --- |
| topia-sdk-prod `471112828260` | the S3 bucket and its bucket policy (public read, CORS, SSE-S3, ACLs off) |
| topia-sdk-prod `471112828260` | `<bucket>-task-bucket` policy → `topia-prod-<svc>-task` |
| stride-sdk-prod `637423291416` | `<bucket>-task-bucket` policy → `stride-prod-<svc>-task` |
| schoolspace-prod `637423330669` | `<bucket>-task-bucket` policy → `sspace-prod-<svc>-task` |
| dev / infra-sandbox `368076259134` | IRSA role for `sdk-apps-dev:<svc>-sa` |

The bucket lives in **one** account; every other account reaches it
cross-account, which needs a grant on both sides — an identity policy on the
principal *and* a statement in the bucket policy. Inside the bucket's own
account the identity policy alone suffices, so the bucket policy only names the
foreign principals.

## How four accounts work from one workspace

Terrakube issues one web-identity JWT per job with subject
`organization:topia-mgmt:workspace:<workspace>`. Every account already has a
`terrakube-role` trusting `organization:topia-mgmt:workspace:*`, so the same
token assumes the role in each account directly — `providers.tf` declares one
aliased provider per account and only overrides `role_arn`. No role chaining, no
extra trust policies, no static keys.

Provider aliases cannot be generated from a map: adding an account means adding
a provider block *and* the resources that use it, not just an entry in
`var.accounts`.

## Adapting this to your app

1. `tofu/variables.tf` — set `app_name`, `bucket_name`, `ecs_service_name`
   (the `<service_name><index>` key from `ecs_services` in infra-terraform) and
   `eks_dev.service_account`.
2. `tofu/backend.tf` and `.github/workflows/tofu.yml` — set the Terrakube
   workspace name.
3. Add the workspace to `TERRAKUBE_WORKSPACES_VCS` in Doppler, with
   `folder: "tofu"`, `iac_type: "tofu"`, `iac_version: "1.11.5"` and
   `aws_dynamic_credentials: true`. That last flag is the whole AWS credential
   setup — it references the shared `aws-dynamic-credentials` collection
   (infra-terrkube `03-terrakube/collections.tf`), so there are no per-workspace
   ENV variables to set.
4. Wire the bucket into the app. `server/routes.ts` reads `S3_BUCKET`:
   - **dev** — put it in the overlay ConfigMap, and annotate the pod's
     ServiceAccount with the `dev_irsa_role_arn` output
     (`eks.amazonaws.com/role-arn`). Without the annotation the pod falls back
     to the node role and every call is AccessDenied.
   - **prod** — the `secrets` map for the service in each account's
     `ecs_services` input.
5. If the app needs **no** bucket, delete this directory, `scripts/terrakube.sh`
   and `.github/workflows/tofu.yml`.

## Running it

Actions → **Tofu (plan / apply / destroy)**. The workflow calls the Terrakube
API and waits for the job; it never runs tofu on the runner. It needs a
`TERRAKUBE_TOKEN` secret, org-level in metaversecloud-com alongside the `PAT`
and `AWS_ROLE_ARN` secrets the release workflows already use.
