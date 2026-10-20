# CHANGE ME when copying this into a new app: app_name, bucket_name,
# ecs_service_name and eks_dev.service_account. Everything else is shared
# across every SDK app and should be left alone.

variable "app_name" {
  description = "Repository name. Used for tags and for the STS session name on every assumed role."
  type        = string
  default     = "sdk-ai-boilerplate"
}

variable "bucket_name" {
  description = <<-EOT
    S3 bucket the app reads and writes; handed to the container as S3_BUCKET.
    S3 bucket names are GLOBAL, so keep the sdk-<repo suffix> convention that
    every other app bucket already follows.
  EOT
  type        = string
  default     = "sdk-ai-boilerplate"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "accounts" {
  description = <<-EOT
    AWS accounts this app is deployed into. The KEYS are fixed: providers.tf
    declares one aliased provider per key and Terraform cannot build provider
    configurations dynamically, so adding an account means adding a provider
    block and the resources that use it, not just an entry here.
  EOT
  type = object({
    dev         = string
    topia_prod  = string
    stride_prod = string
    sspace_prod = string
  })
  default = {
    dev         = "368076259134"
    topia_prod  = "471112828260"
    stride_prod = "637423291416"
    sspace_prod = "637423330669"
  }
}

variable "ecs_service_name" {
  description = <<-EOT
    ECS service key for this app: "<service_name><instance index>", the way
    infra-terraform's ecs module builds local.all_services from ecs_services.
    The Fargate task role is named "<tenant>-<environment>-<this>-task".
  EOT
  type        = string
  default     = "app0"
}

variable "eks_dev" {
  description = <<-EOT
    Dev EKS cluster and the ServiceAccount the app pod runs as. The IRSA role
    created here is only reachable once that ServiceAccount exists and carries
    the eks.amazonaws.com/role-arn annotation (see argo/ in this repo).
  EOT
  type = object({
    cluster_name    = string
    namespace       = string
    service_account = string
  })
  default = {
    cluster_name    = "Topia-dev-SDK-Apps"
    namespace       = "sdk-apps-dev"
    service_account = "app0-sa"
  }
}

variable "developer_role_arn" {
  description = "Human/CI role allowed to seed objects by hand, the same one every existing sdk-* bucket grants. Set to \"\" to drop the grant."
  type        = string
  default     = "arn:aws:iam::368076259134:role/DevS3Access"
}

variable "cors_allowed_origins" {
  description = "Origins allowed to fetch objects from the browser."
  type        = list(string)
  default     = ["*"]
}
