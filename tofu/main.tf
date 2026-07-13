# ─── CertBuzz OpenTofu ───────────────────────────────────────────
# Azure infra: resource group, networking, VM with cloud-init.
# Cloud-init installs runtime (Node 20, PM2, Nginx reverse proxy).
# App code deploys via scripts/deploy-app.sh after VM is ready.
#
# Usage:
#   tofu init
#   tofu apply -var dns_name=certbuzzdemo   # provisions infra + deploys app
#   curl -k "$(tofu output -raw fqdn)"
#   tofu destroy
#
# Re-deploy after code changes (no infra change):
#   tofu apply -replace=null_resource.deploy

terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }
}

provider "azurerm" {
  features {}
}

# ─── Variables ───────────────────────────────────────────────────

variable "location" {
  description = "Azure region"
  type        = string
  default     = "polandcentral"
}

variable "dns_name" {
  description = "DNS label. Auto-generated with random suffix if empty."
  type        = string
  default     = "certbuzz"
}

variable "vm_size" {
  description = "Azure VM size"
  type        = string
  default     = "Standard_B2ls_v2"
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key for VM access"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

# ─── Random suffix for uniqueness ─────────────────────────────────

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

locals {
  # Use var.dns_name if set (non-empty), otherwise auto-generate
  suffix = var.dns_name != "" ? var.dns_name : "certbuzz-${random_string.suffix.result}"
}

# ─── Resource group ──────────────────────────────────────────────

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.suffix}"
  location = var.location
}

# ─── Networking ──────────────────────────────────────────────────

resource "azurerm_virtual_network" "main" {
  name                = "vnet-${local.suffix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = ["10.0.0.0/16"]
}

# AzureRM provider v4.x: post-create refresh can fail with
# "root object was present, but now absent". time_sleep lets Azure
# propagate before re-read. See hashicorp/terraform-provider-azurerm#26409.

resource "time_sleep" "vnet_propagation" {
  depends_on      = [azurerm_virtual_network.main]
  create_duration = "15s"
}

resource "azurerm_subnet" "main" {
  name                 = "subnet-main"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
  depends_on           = [time_sleep.vnet_propagation]
}

resource "azurerm_public_ip" "main" {
  name                = "pip-${local.suffix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = local.suffix
}

resource "azurerm_network_security_group" "main" {
  name                = "nsg-${local.suffix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "SSH"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "HTTP"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "HTTPS"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "time_sleep" "nsg_propagation" {
  depends_on      = [azurerm_network_security_group.main]
  create_duration = "10s"
}

resource "azurerm_network_interface" "main" {
  name                = "nic-${local.suffix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "ipconfig-main"
    subnet_id                     = azurerm_subnet.main.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.main.id
  }
}

resource "azurerm_network_interface_security_group_association" "main" {
  network_interface_id      = azurerm_network_interface.main.id
  network_security_group_id = azurerm_network_security_group.main.id
}

# ─── Virtual machine ─────────────────────────────────────────────

resource "azurerm_linux_virtual_machine" "main" {
  name                  = "vm-${local.suffix}"
  location              = azurerm_resource_group.main.location
  resource_group_name   = azurerm_resource_group.main.name
  size                  = var.vm_size
  admin_username        = "azureuser"
  network_interface_ids = [azurerm_network_interface.main.id]
  depends_on            = [time_sleep.vnet_propagation, time_sleep.nsg_propagation]

  admin_ssh_key {
    username   = "azureuser"
    public_key = file(pathexpand(var.ssh_public_key_path))
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  # cloud-init: install Node 20 + PM2 + Nginx reverse proxy
  custom_data = base64encode(templatefile("${path.module}/cloud-init.tftpl", {
    fqdn = "${local.suffix}.${var.location}.cloudapp.azure.com"
  }))
}

# ─── Deploy app after VM ready ──────────────────────────────────

resource "null_resource" "deploy" {
  triggers = {
    vm_id = azurerm_linux_virtual_machine.main.id
  }

  provisioner "local-exec" {
    command = "${path.module}/../scripts/deploy-app.sh ${azurerm_resource_group.main.name} ${azurerm_linux_virtual_machine.main.name}"
  }
}