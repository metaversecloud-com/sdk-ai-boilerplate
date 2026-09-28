locals {
  terrakube_role_arns = { for key, id in var.accounts : key => "arn:aws:iam::${id}:role/terrakube-role" }

  bucket_arn = "arn:aws:s3:::${var.bucket_name}"

  # Fargate task roles created by infra-terraform's ecs module. The name comes
  # from the cloudposse label there -- "<namespace>-<environment>-<name>" with
  # the "task" attribute appended, and namespace is fed the tenant. Matching
  # by name (rather than looking the roles up) keeps the plan static: these
  # roles are owned by the infra-terraform workspaces, not by this one.
  ecs_task_role_names = {
    topia_prod  = "topia-prod-${var.ecs_service_name}-task"
    stride_prod = "stride-prod-${var.ecs_service_name}-task"
    sspace_prod = "sspace-prod-${var.ecs_service_name}-task"
  }

  ecs_task_role_arns = {
    for key, name in local.ecs_task_role_names :
    key => "arn:aws:iam::${var.accounts[key]}:role/${name}"
  }

  # Same naming as the IRSA roles infra-terraform already creates for SDK apps
  # on this cluster (aws/iam_sdk_apps_irsa.tf), so the two are readable side by
  # side while apps migrate over.
  dev_irsa_role_name = "sdk-apps-dev-${trimsuffix(var.eks_dev.service_account, "-sa")}-irsa"

  # Cross-account principals only. Inside the bucket's own account an identity
  # policy is sufficient, so topia-sdk-prod's task role is deliberately absent
  # here -- it is granted in iam.tf instead, and repeating it would just be a
  # second place to forget to update.
  bucket_policy_principals = concat(
    [
      local.ecs_task_role_arns.stride_prod,
      local.ecs_task_role_arns.sspace_prod,
      aws_iam_role.dev_irsa.arn,
    ],
    var.developer_role_arn == "" ? [] : [var.developer_role_arn],
  )

  # OIDC issuer of the dev cluster, split the way an IRSA trust policy needs it.
  dev_oidc_host         = replace(data.aws_eks_cluster.dev.identity[0].oidc[0].issuer, "https://", "")
  dev_oidc_provider_arn = "arn:aws:iam::${var.accounts.dev}:oidc-provider/${local.dev_oidc_host}"

  tags = {
    App       = var.app_name
    ManagedBy = "terrakube"
    Repo      = "metaversecloud-com/${var.app_name}"
  }
}
