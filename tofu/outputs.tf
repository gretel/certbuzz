# ─── Outputs ──────────────────────────────────────────────────────

output "fqdn" {
  description = "Full URL to visit"
  value       = "https://${azurerm_public_ip.main.domain_name_label}.${azurerm_resource_group.main.location}.cloudapp.azure.com/"
}

output "public_ip" {
  description = "Public IP address"
  value       = azurerm_public_ip.main.ip_address
}

output "resource_group" {
  description = "Azure resource group name (for scripts/deploy-app.sh)"
  value       = azurerm_resource_group.main.name
}

output "vm_name" {
  description = "VM name (for scripts/deploy-app.sh)"
  value       = azurerm_linux_virtual_machine.main.name
}

output "ssh" {
  description = "SSH command to connect"
  value       = "ssh azureuser@${azurerm_public_ip.main.ip_address}"
}

output "dozent_password" {
  description = "Dozent panel password"
  value       = random_password.dozent_password.result
  sensitive   = true
}

output "cleanup" {
  description = "Destroy everything"
  value       = "tofu destroy"
}