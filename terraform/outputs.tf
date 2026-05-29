output "vercel_project_id" {
  value = vercel_project.frontend.id
}

output "vercel_project_name" {
  value = vercel_project.frontend.name
}

output "vercel_custom_domain" {
  value = try(vercel_project_domain.frontend[0].domain, null)
}