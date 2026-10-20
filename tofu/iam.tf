# ── Prod: ECS Fargate task roles ─────────────────────────────────────────────
#
# One policy per account, attached to the task role infra-terraform created for
# this service. The attachment is additive: the ecs module attaches its own
# policies to the same role through task_policy_arns_map, and two Terraform
# states each owning a different aws_iam_role_policy_attachment on one role do
# not fight. What this workspace must NOT do is manage the role itself.

resource "aws_iam_policy" "topia_prod_task_bucket" {
  name        = "${var.bucket_name}-task-bucket"
  description = "Read/write access to ${var.bucket_name} for the ${var.ecs_service_name} ECS task"
  policy      = data.aws_iam_policy_document.bucket_rw.json
}

resource "aws_iam_role_policy_attachment" "topia_prod_task_bucket" {
  role       = local.ecs_task_role_names.topia_prod
  policy_arn = aws_iam_policy.topia_prod_task_bucket.arn
}

resource "aws_iam_policy" "stride_prod_task_bucket" {
  provider = aws.stride_prod

  name        = "${var.bucket_name}-task-bucket"
  description = "Read/write access to ${var.bucket_name} for the ${var.ecs_service_name} ECS task"
  policy      = data.aws_iam_policy_document.bucket_rw.json
}

resource "aws_iam_role_policy_attachment" "stride_prod_task_bucket" {
  provider = aws.stride_prod

  role       = local.ecs_task_role_names.stride_prod
  policy_arn = aws_iam_policy.stride_prod_task_bucket.arn
}

resource "aws_iam_policy" "sspace_prod_task_bucket" {
  provider = aws.sspace_prod

  name        = "${var.bucket_name}-task-bucket"
  description = "Read/write access to ${var.bucket_name} for the ${var.ecs_service_name} ECS task"
  policy      = data.aws_iam_policy_document.bucket_rw.json
}

resource "aws_iam_role_policy_attachment" "sspace_prod_task_bucket" {
  provider = aws.sspace_prod

  role       = local.ecs_task_role_names.sspace_prod
  policy_arn = aws_iam_policy.sspace_prod_task_bucket.arn
}

# ── Dev: EKS IRSA ────────────────────────────────────────────────────────────
#
# The pod gets its own role instead of borrowing the node role. Annotate the
# ServiceAccount with dev_irsa_role_arn (see outputs.tf) or the pod falls back
# to the node identity and gets AccessDenied on the bucket.

resource "aws_iam_role" "dev_irsa" {
  provider = aws.dev

  name               = local.dev_irsa_role_name
  description        = "IRSA role for ${var.eks_dev.namespace}/${var.eks_dev.service_account} on ${var.eks_dev.cluster_name}"
  assume_role_policy = data.aws_iam_policy_document.dev_irsa_assume.json
}

resource "aws_iam_policy" "dev_irsa_bucket" {
  provider = aws.dev

  name        = "${var.bucket_name}-dev-bucket"
  description = "Read/write access to ${var.bucket_name} for the dev pod"
  policy      = data.aws_iam_policy_document.bucket_rw.json
}

resource "aws_iam_role_policy_attachment" "dev_irsa_bucket" {
  provider = aws.dev

  role       = aws_iam_role.dev_irsa.name
  policy_arn = aws_iam_policy.dev_irsa_bucket.arn
}
