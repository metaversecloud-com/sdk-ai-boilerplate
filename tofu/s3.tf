# The app's bucket, in topia-sdk-prod (the default provider). One bucket for
# every environment: S3 names are global and the dev/prod split for this app is
# by key prefix, not by bucket.
resource "aws_s3_bucket" "app" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket = aws_s3_bucket.app.id

  # ACLs stay blocked -- object ownership below turns them off entirely.
  block_public_acls  = true
  ignore_public_acls = true

  # Public POLICIES are allowed on purpose: the bucket policy grants anonymous
  # GetObject because the app hands out plain object URLs. Flipping either of
  # these to true rejects that policy.
  block_public_policy     = false
  restrict_public_buckets = false
}

# No ACLs. Public read comes from the bucket policy, so nothing needs to set
# per-object ACLs -- which is also why s3:PutObjectAcl is absent from the
# grants in data.tf, unlike the older hand-written sdk-* bucket policies.
resource "aws_s3_bucket_ownership_controls" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD", "PUT"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["Access-Control-Allow-Origin"]
    max_age_seconds = 3000
  }
}

# Ordering matters: a public policy is rejected while the public access block
# still has block_public_policy = true, so the block has to settle first.
resource "aws_s3_bucket_policy" "app" {
  bucket = aws_s3_bucket.app.id
  policy = data.aws_iam_policy_document.bucket.json

  depends_on = [
    aws_s3_bucket_public_access_block.app,
    aws_s3_bucket_ownership_controls.app,
  ]
}
