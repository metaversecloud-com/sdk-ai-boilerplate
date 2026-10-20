# One Terrakube run, four AWS accounts.
#
# Terrakube's dynamic credentials generate a single web-identity JWT per job,
# whose subject is "organization:topia-mgmt:workspace:<workspace name>", and
# write it to a file the executor exposes as AWS_WEB_IDENTITY_TOKEN_FILE.
# Every account already has a `terrakube-role` (infra-terraform aws/iam.tf) that
# trusts that issuer with StringLike "...:sub" = "organization:topia-mgmt:workspace:*".
#
# So the SAME token assumes the role in each account directly -- no role
# chaining, no cross-account trust to add, no static keys. Each provider only
# overrides role_arn; web_identity_token_file is left out on purpose so the
# provider picks up the executor's env var (values set in the block take
# precedence over the environment, which is exactly what we do NOT want here).
#
# The ENV wiring that switches this on comes from the shared
# `aws-dynamic-credentials` Terrakube collection (infra-terrkube
# 03-terrakube/collections.tf), which the workspace opts into with
# "aws_dynamic_credentials": true. Nothing to set per workspace.
#
# That collection's WORKLOAD_IDENTITY_ROLE_AWS points at the DEV account. It is
# only the fallback for the default credential chain; every provider below names
# its role explicitly, so the fallback is never used. Leave the blocks explicit:
# drop one and that provider silently lands in dev.

# Default provider = topia-sdk-prod, the account that owns the bucket.
provider "aws" {
  region = var.region

  assume_role_with_web_identity {
    role_arn     = local.terrakube_role_arns.topia_prod
    session_name = "terrakube-${var.app_name}"
  }

  default_tags {
    tags = local.tags
  }
}

provider "aws" {
  alias  = "dev"
  region = var.region

  assume_role_with_web_identity {
    role_arn     = local.terrakube_role_arns.dev
    session_name = "terrakube-${var.app_name}"
  }

  default_tags {
    tags = local.tags
  }
}

provider "aws" {
  alias  = "stride_prod"
  region = var.region

  assume_role_with_web_identity {
    role_arn     = local.terrakube_role_arns.stride_prod
    session_name = "terrakube-${var.app_name}"
  }

  default_tags {
    tags = local.tags
  }
}

provider "aws" {
  alias  = "sspace_prod"
  region = var.region

  assume_role_with_web_identity {
    role_arn     = local.terrakube_role_arns.sspace_prod
    session_name = "terrakube-${var.app_name}"
  }

  default_tags {
    tags = local.tags
  }
}
