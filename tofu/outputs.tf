output "bucket_name" {
  description = "Hand this to the app as S3_BUCKET."
  value       = aws_s3_bucket.app.id
}

output "bucket_arn" {
  value = aws_s3_bucket.app.arn
}

output "dev_irsa_role_arn" {
  description = "Annotate the dev ServiceAccount with this: eks.amazonaws.com/role-arn."
  value       = aws_iam_role.dev_irsa.arn
}

output "ecs_task_role_arns" {
  description = "Prod task roles granted access, by account."
  value       = local.ecs_task_role_arns
}
