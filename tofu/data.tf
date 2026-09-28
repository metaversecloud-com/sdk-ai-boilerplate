# The dev cluster's OIDC issuer, for the IRSA trust policy. Read rather than
# hardcoded: the issuer changes if the cluster is ever rebuilt, and a stale
# hardcoded value fails as a silent 403 at pod start instead of at plan time.
data "aws_eks_cluster" "dev" {
  provider = aws.dev
  name     = var.eks_dev.cluster_name
}

# Identity-side grant, attached to every principal that runs this app. Cross
# account S3 needs BOTH this and a matching bucket-policy statement; in the
# bucket's own account this alone is enough.
data "aws_iam_policy_document" "bucket_rw" {
  statement {
    sid       = "ListBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [local.bucket_arn]
  }

  statement {
    sid    = "Objects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
    ]
    resources = ["${local.bucket_arn}/*"]
  }
}

data "aws_iam_policy_document" "bucket" {
  # The app serves these objects straight to browsers, so reads are open. Only
  # GetObject: public ListBucket would let anyone enumerate the bucket, and
  # nothing in the app needs it.
  statement {
    sid       = "PublicReadGetObject"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${local.bucket_arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }

  statement {
    sid    = "CrossAccountReadWrite"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
    ]
    resources = [local.bucket_arn, "${local.bucket_arn}/*"]

    principals {
      type        = "AWS"
      identifiers = local.bucket_policy_principals
    }
  }
}

data "aws_iam_policy_document" "dev_irsa_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.dev_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.dev_oidc_host}:sub"
      values   = ["system:serviceaccount:${var.eks_dev.namespace}:${var.eks_dev.service_account}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.dev_oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}
