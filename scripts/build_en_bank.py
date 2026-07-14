#!/usr/bin/env python3
"""Build english AZ-104 question bank. Reads German JSON, applies
English translations, writes azure-az104-en.json."""

import json
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
QUESTIONS_DIR = os.path.join(SCRIPT_DIR, '..', 'questions')
SRC = os.path.join(QUESTIONS_DIR, 'azure-az104.json')
DST = os.path.join(QUESTIONS_DIR, 'azure-az104-en.json')

with open(SRC) as f:
    data = json.load(f)

# ==========================================================
# ENGLISH TRANSLATIONS
# Key format: {question_id}.{field}
# field = 'question', 'option_{id}', 'explanation'
# ==========================================================
EN = {}

def tr(qid, field, text):
    EN[f"{qid}.{field}"] = text

tr('ig-001', 'question', 'Which role does a user need at minimum to create new users in Microsoft Entra ID?')
tr('ig-001', 'option_a', 'Global Reader')
tr('ig-001', 'option_b', 'User Administrator')
tr('ig-001', 'option_c', 'Helpdesk Administrator')
tr('ig-001', 'option_d', 'Security Administrator')
tr('ig-001', 'explanation',
    'The **User Administrator** role enables creating and managing users and groups in Microsoft Entra ID.\n\n'
    'Why the other options are incorrect:\n'
    '- **Global Reader**: Has read-only access to directory objects\n'
    '- **Helpdesk Administrator**: Can only reset passwords for non-admin users\n'
    '- **Security Administrator**: Manages security settings but cannot create users\n\n'
    '*Exam tip*: **User Administrator** is the minimum role for user management – **Global Administrator** would be over-privileged.')

tr('ig-002', 'question', 'Which statements about Azure Resource Locks are correct? (Select 3)')
tr('ig-002', 'option_a', 'ReadOnly-Locks prevent changes to resources')
tr('ig-002', 'option_b', 'Delete-Locks prevent deletion of resources')
tr('ig-002', 'option_c', 'Locks are inherited by child resources')
tr('ig-002', 'option_d', 'Only Owners can create locks')
tr('ig-002', 'option_e', 'Locks override RBAC permissions')
tr('ig-002', 'explanation',
    '**Resource Locks** provide two protection modes:\n\n'
    '- **ReadOnly**: Prevents all changes (PUT, PATCH, POST)\n'
    '- **Delete**: Prevents only deletion (DELETE)\n\n'
    'Locks are automatically *inherited* from parent to child resources.\n\n'
    'Why the other options are incorrect:\n'
    '- Not only **Owner**, but also **User Access Administrator** can manage locks\n'
    '- Locks *supplement* RBAC but do not override it – they apply to all users regardless of role\n\n'
    '*Important*: Locks protect against accidental changes, not against malicious actors with sufficient permissions.')

tr('ig-003', 'question', 'Which Entra ID edition is required for Conditional Access?')
tr('ig-003', 'option_a', 'Free')
tr('ig-003', 'option_b', 'Microsoft 365 Apps')
tr('ig-003', 'option_c', 'Premium P1')
tr('ig-003', 'option_d', 'Premium P2')
tr('ig-003', 'explanation',
    '**Conditional Access Policies** are a feature of **Entra ID Premium P1** (and P2).\n\n'
    'Overview of editions:\n'
    '- **Free**: Only basic Security Defaults (no granular policies)\n'
    '- **Microsoft 365 Apps**: No Conditional Access Policies\n'
    '- **Premium P1**: Conditional Access, Self-Service Password Reset, Dynamic Groups\n'
    '- **Premium P2**: Additionally Identity Protection and Privileged Identity Management (PIM)\n\n'
    '*Exam tip*: For AZ-104, remember that **P1** is sufficient for Conditional Access, but **P2** is needed for advanced identity features like PIM.')

tr('ig-004', 'question', 'Which statements about Azure RBAC Custom Roles are correct? (Select 2)')
tr('ig-004', 'option_a', 'Custom Roles can be created at Management Group scope')
tr('ig-004', 'option_b', 'Actions can be defined with wildcards (*)')
tr('ig-004', 'option_c', 'NotActions override Actions')
tr('ig-004', 'option_d', 'DataActions apply to Data Plane operations')
tr('ig-004', 'explanation',
    '**Custom Roles** in Azure RBAC provide flexible permission control:\n\n'
    '- **Wildcards (*)** are supported in Actions, e.g. `Microsoft.Storage/*/read`\n'
    '- **DataActions** define permissions for the **Data Plane** (e.g., blob access)\n'
    '- **Actions** apply to the **Control Plane** (e.g., creating a Storage Account)\n\n'
    'Why the other options are incorrect:\n'
    '- Custom Roles can now also be created at **Management Group scope** (formerly only Subscription or lower)\n'
    '- **NotActions** are *exceptions* to Actions, they do not fully override them – they are subtracted from Actions\n\n'
    '*Exam tip*: Always distinguish between **Control Plane** (resource management) and **Data Plane** (data access).')

tr('ig-005', 'question', 'Sort the steps for implementing an Azure Policy in the correct order:')
tr('ig-005', 'option_a', 'Create or select a Policy Definition')
tr('ig-005', 'option_b', 'Create a Policy Assignment and define the scope')
tr('ig-005', 'option_c', 'Identify non-compliant resources')
tr('ig-005', 'option_d', 'Create a Remediation Task (optional)')
tr('ig-005', 'explanation',
    'The **Azure Policy** workflow consists of four steps:\n\n'
    '1. **Policy Definition**: Create or select a built-in definition (defines the compliance rule)\n'
    '2. **Policy Assignment**: Create and define the scope (Subscription, Resource Group, or Management Group)\n'
    '3. **Identify Non-compliant Resources**: Azure evaluates resources and shows non-compliant ones in the Compliance Dashboard\n'
    '4. **Remediation Task** (optional): Automatically fixes existing non-compliant resources\n\n'
    '*Important*: New resources are evaluated immediately. Existing resources require a Remediation Task or are checked at the next compliance evaluation.')

tr('storage-001', 'question', 'Which redundancy options protect against datacenter failures? (Select 2)')
tr('storage-001', 'option_a', 'LRS (Locally Redundant Storage)')
tr('storage-001', 'option_b', 'ZRS (Zone-Redundant Storage)')
tr('storage-001', 'option_c', 'GRS (Geo-Redundant Storage)')
tr('storage-001', 'option_d', 'RA-GRS (Read-Access Geo-Redundant Storage)')
tr('storage-001', 'explanation',
    '**Storage Redundancy** for protection against datacenter failures:\n\n'
    '**ZRS (Zone-Redundant Storage):**\n'
    '- Synchronously replicates data across 3 Azure Availability Zones in the same region\n'
    '- Survives a full zone (datacenter) outage\n'
    '- Still accessible for read/write during a zone outage\n\n'
    '**GRS (Geo-Redundant Storage):**\n'
    '- Replicates data to a paired region (asynchronously)\n'
    '- Survives a full region outage\n'
    '- Read access depends on configuration (RA-GRS adds read access to the secondary region)\n\n'
    '*Not sufficient*:\n'
    '- **LRS**: Only protects within a single datacenter (3 replicas, same zone)\n'
    '- **RA-GRS**: Is an access option for GRS, not a separate redundancy tier for datacenter failures\n\n'
    '*Exam tip*: ZRS for zonal failures, GRS for regional failures.')

tr('storage-002', 'question', 'Which Access Tier in Azure Blob Storage has the highest storage costs but lowest access costs?')
tr('storage-002', 'option_a', 'Hot')
tr('storage-002', 'option_b', 'Cool')
tr('storage-002', 'option_c', 'Cold')
tr('storage-002', 'option_d', 'Archive')
tr('storage-002', 'explanation',
    'The **Access Tiers** in Azure Blob Storage overview:\n\n'
    '**Hot Tier:**\n'
    '- Highest storage costs, lowest access costs\n'
    '- Optimized for frequent access (> once per month)\n'
    '- Default tier for new storage accounts\n\n'
    '**Cool Tier:**\n'
    '- Lower storage costs, higher access costs (early deletion fee: 30 days)\n'
    '- For data accessed less than once per month\n\n'
    '**Cold Tier:**\n'
    '- Even lower storage costs, higher access costs (early deletion fee: 90 days)\n'
    '- For data accessed roughly once per quarter\n\n'
    '**Archive Tier:**\n'
    '- Lowest storage costs, highest access/retrieval costs\n'
    '- Data is offline; retrieval takes hours\n'
    '- 180-day minimum retention\n\n'
    '*Exam tip*: **Hot = expensive storage, cheap access**. **Archive = cheap storage, expensive access**.')

tr('storage-003', 'question', 'Which protocol is used for Azure Files with Entra Domain Services integration?')
tr('storage-003', 'option_a', 'NFS 3.0')
tr('storage-003', 'option_b', 'NFS 4.1')
tr('storage-003', 'option_c', 'SMB 2.1')
tr('storage-003', 'option_d', 'SMB 3.0')
tr('storage-003', 'explanation',
    '**Azure Files** with Entra Domain Services integration uses **SMB 3.0** (or higher).\n\n'
    '**SMB (Server Message Block) Protocol:**\n'
    '- SMB 3.0 supports encryption, Transparent Failover, and multi-channel\n'
    '- Required for Entra DS/AD DS identity integration\n\n'
    '**NFS (Network File System):**\n'
    '- NFS 4.1 is for Linux/UNIX clients (premium Azure Files only)\n'
    '- Does NOT support AD/Entra DS integration\n'
    '- No SMB protocol conversion possible\n\n'
    '*Exam tip*: SMB for Windows/AD integration, NFS for Linux workloads. SMB 3.0 is the minimum for Entra DS.')

tr('storage-004', 'question', 'Which methods can be used to authorize access to Azure Blob Storage? (Select 3)')
tr('storage-004', 'option_a', 'Shared Access Signature (SAS)')
tr('storage-004', 'option_b', 'Azure AD RBAC')
tr('storage-004', 'option_c', 'Storage Account Keys')
tr('storage-004', 'option_d', 'Network Security Group')
tr('storage-004', 'option_e', 'Azure Policy')
tr('storage-004', 'explanation',
    '**Azure Blob Storage** supports three main authorization methods:\n\n'
    '1. **Shared Access Signatures (SAS)**: Time-limited, permission-scoped delegated access\n'
    '2. **Azure AD RBAC**: Role-based access control using Azure AD identities\n'
    '3. **Storage Account Keys**: Full-access symmetric keys (root access)\n\n'
    'Why the other options are incorrect:\n'
    '- **Network Security Group (NSG)**: Controls *network* traffic, not authorization (authZ ≠ authN)\n'
    '- **Azure Policy**: Governance tool for compliance, not access control to blob data\n\n'
    '*Recommendation*: Azure AD RBAC is the most secure and recommended method. SAS for granular delegated access. Keys should be avoided when possible.')

tr('storage-005', 'question', 'After how many days can a blob be automatically moved to the Archive tier via Lifecycle Management at the earliest?')
tr('storage-005', 'option_a', '0 days (immediately)')
tr('storage-005', 'option_b', '30 days')
tr('storage-005', 'option_c', '90 days')
tr('storage-005', 'option_d', '180 days')
tr('storage-005', 'explanation',
    '**Lifecycle Management** can move blobs *immediately* (0 days) to the **Archive** tier.\n\n'
    '**Important restrictions:**\n'
    '- **Last Modified** + 0 days → Archive: *Allowed*\n'
    '- **Creation Date** + 0 days → Archive: *Allowed*\n'
    '- Exception: Moving from Cool → Archive requires 30 days minimum if Cool tier\n\n'
    '**From other tiers:**\n'
    '- Hot → Archive: 0 days\n'
    '- Cool → Archive: 30 days minimum (early deletion penalty applies)\n'
    '- Cold → Archive: 90 days minimum\n\n'
    '*Exam tip*: Lifecycle Management supports **0 days** to Archive from Hot. The 180-day rule applies to *manual* rehydration, not Lifecycle.')

tr('compute-001', 'question', 'What happens when you stop an Azure VM in the portal?')
tr('compute-001', 'option_a', 'The VM is stopped but still billed')
tr('compute-001', 'option_b', 'The VM is stopped and deallocated')
tr('compute-001', 'option_c', 'The VM is restarted')
tr('compute-001', 'option_d', 'The VM is deleted')
tr('compute-001', 'explanation',
    'When **stopping a VM in the Azure Portal**, the VM is *deallocated* (Stop + Release of compute resources).\n\n'
    '**What happens:**\n'
    '- VM state changes to Stopped (Deallocated)\n'
    '- Compute resources (CPU, memory) are released\n'
    '- **No compute costs** are incurred while deallocated\n'
    '- Dynamic public IP is released (unless static)\n'
    '- OS disk and data disks remain (you pay for storage)\n\n'
    '**Difference: Stop (Deallocate) vs Shutdown inside the VM:**\n'
    '- *Stopping via Azure* = Deallocate (stop billing)\n'
    '- *Shutdown inside OS* = VM is stopped but still billed (compute not released)\n\n'
    '*Exam tip*: Use **Deallocate** to save costs. Stopping from the portal always deallocates.')

tr('compute-002', 'question', 'Which features are only available in App Service Standard plans or higher? (Select 2)')
tr('compute-002', 'option_a', 'Custom Domains')
tr('compute-002', 'option_b', 'Deployment Slots')
tr('compute-002', 'option_c', 'Auto-Scaling')
tr('compute-002', 'option_d', 'VNet Integration')
tr('compute-002', 'option_e', 'SSL/TLS Bindings')
tr('compute-002', 'explanation',
    '**App Service Plan Features** by tier:\n\n'
    '**Free/Shared Plan:**\n'
    '- No Custom Domains\n'
    '- No SSL/TLS Bindings\n\n'
    '**Basic Plan:**\n'
    '- Custom Domains supported\n'
    '- SSL/TLS Bindings supported (with paid certificate or Azure Front Door)\n'
    '- Auto-Scaling: *Limited* (manual scaling only)\n\n'
    '**Standard Plan and higher (Premium, Isolated):**\n'
    '- **Deployment Slots**: Staging, blue-green deployments, swap with pre-warming\n'
    '- **Auto-Scaling**: Rule-based automatic scaling (CPU, memory, HTTP queue)\n'
    '- **VNet Integration**: Regional VNet Integration for accessing VNet resources\n'
    '- **Custom Domains** and **SSL/TLS** are already available from Basic\n\n'
    '*Exam tip*: Deployment Slots and Auto-Scaling are Standard+ features. Custom Domains start at Basic.')

tr('compute-003', 'question', 'What is the main difference between Availability Sets and Availability Zones?')
tr('compute-003', 'option_a', 'Availability Sets provide a higher SLA than Zones')
tr('compute-003', 'option_b', 'Availability Zones protect against datacenter failures')
tr('compute-003', 'option_c', 'Availability Sets cost extra, Zones are free')
tr('compute-003', 'option_d', 'Availability Zones exist in all regions')
tr('compute-003', 'explanation',
    'The main difference between **Availability Sets** and **Availability Zones**:\n\n'
    '**Availability Zones (AZs):**\n'
    '- Physically separate datacenters within a region\n'
    '- Each zone has independent power, cooling, and network\n'
    '- Protects against **full datacenter failures**\n'
    '- Provides **99.99%** VM SLA (with 2+ VMs across zones)\n'
    '- *Not available* in all regions\n\n'
    '**Availability Sets:**\n'
    '- Logical grouping *within* a single datacenter\n'
    '- Protects against **rack-level failures** (Fault Domains)\n'
    '- Protects against **planned maintenance** (Update Domains)\n'
    '- Provides **99.95%** VM SLA (with 2+ VMs in the set)\n\n'
    '*Exam tip*: Zones = datacenter protection (higher SLA). Sets = rack/maintenance protection (lower SLA).')

tr('compute-004', 'question', 'Which VM Extension is used for automatic patching of Windows VMs?')
tr('compute-004', 'option_a', 'Azure Monitor Agent')
tr('compute-004', 'option_b', 'Custom Script Extension')
tr('compute-004', 'option_c', 'Update Management Extension')
tr('compute-004', 'option_d', 'Desired State Configuration')
tr('compute-004', 'explanation',
    'The **Update Management Extension** (or **Azure Update Manager**) enables automatic patch management for Windows VMs.\n\n'
    '**Update Management Features:**\n'
    '- Automatic assessment and patch installation\n'
    '- Supports Windows and Linux\n'
    '- Integration with Azure Automation\n\n'
    '**Other Extensions:**\n'
    '- **Azure Monitor Agent**: Collects monitoring data (metrics, logs) – not for patching\n'
    '- **Custom Script Extension**: Runs scripts post-deployment – not a patch solution\n'
    '- **DSC (Desired State Configuration)**: Manages configuration drift – can include patching but is not the primary patch tool\n\n'
    '*Exam tip*: For AZ-104, remember that **Update Management** (via Azure Automation or Azure Update Manager) is the correct service for automated patching.')

tr('compute-005', 'question', 'Which statements about Azure Container Instances (ACI) are correct? (Select 2)')
tr('compute-005', 'option_a', 'ACI offers orchestration for multi-container deployments')
tr('compute-005', 'option_b', 'ACI supports both Linux and Windows containers')
tr('compute-005', 'option_c', 'ACI can be integrated into VNets')
tr('compute-005', 'option_d', 'ACI is cheaper than AKS for large workloads')
tr('compute-005', 'explanation',
    '**Azure Container Instances (ACI)** – key properties:\n\n'
    '**Correct statements:**\n'
    '- Supports **Linux and Windows containers**\n'
    '- Can be **integrated into VNets** (for access to VNet resources)\n\n'
    '**Incorrect statements:**\n'
    '- ACI *does not* offer orchestration (use AKS for multi-container orchestration)\n'
    '- ACI is *more expensive* than AKS for large/long-running workloads (ACI is optimized for short-lived, burst workloads)\n\n'
    '**ACI use cases:**\n'
    '- Event-driven processing\n'
    '- CI/CD build agents\n'
    '- Batch jobs\n'
    '- Simple web apps\n\n'
    '*Exam tip*: ACI = simpler/faster startup, no orchestration. AKS = orchestration at scale, lower cost for persistent workloads.')

tr('network-001', 'question', 'Sort the steps to create a VNet-to-VNet VPN connection in the correct order:')
tr('network-001', 'option_a', 'Create two Virtual Networks with non-overlapping address spaces')
tr('network-001', 'option_b', 'Create GatewaySubnets in both VNets (name: GatewaySubnet)')
tr('network-001', 'option_c', 'Create VPN Gateways in both VNets')
tr('network-001', 'option_d', 'Configure VNet-to-VNet Connections in both gateways')
tr('network-001', 'explanation',
    '**VNet-to-VNet VPN Gateway Connection** – steps:\n\n'
    '1. **Create two VNets** with non-overlapping address spaces\n'
    '2. **Create GatewaySubnets** in both VNets (must be named exactly `GatewaySubnet`)\n'
    '3. **Create VPN Gateways** in both VNets (requires ~45 minutes provisioning)\n'
    '4. **Configure VNet-to-VNet Connections** on both gateways (each side needs a connection resource)\n\n'
    '*Important*: Both connections must be established for traffic to flow. Connection is not bidirectional by default.')

tr('network-002', 'question', 'What is the default priority that Azure suggests for the first custom NSG rule?')
tr('network-002', 'option_a', '100')
tr('network-002', 'option_b', '1000')
tr('network-002', 'option_c', '4096')
tr('network-002', 'option_d', '65000')
tr('network-002', 'explanation',
    '**NSG Rule Priorities** – basics:\n\n'
    '**Default suggestion for first custom rule:**\n'
    '- Azure suggests starting at **100** for the first rule\n'
    '- Priority values range from **100 to 4096** for Azure-created rules (Azure default rules use 65000, 65001, etc.)\n\n'
    '**Rule Evaluation:**\n'
    '- Lower number = higher priority\n'
    '- Rules are evaluated in priority order\n'
    '- Once a rule matches, evaluation stops\n\n'
    '**Best Practice:**\n'
    '- Leave gaps between priorities (100, 200, 300...) so you can insert rules later\n'
    '- Use standard increments (100, 200, etc.)\n\n'
    '*Exam tip*: NSG rules are evaluated in priority order. The first match wins.')

tr('network-003', 'question', 'Which Load Balancer SKU is required for Availability Zone-resilient traffic?')
tr('network-003', 'option_a', 'Basic')
tr('network-003', 'option_b', 'Standard')
tr('network-003', 'option_c', 'Gateway')
tr('network-003', 'option_d', 'Premium')
tr('network-003', 'explanation',
    'The **Standard Load Balancer SKU** is required for **Zone-redundant** traffic.\n\n'
    '**Standard Load Balancer:**\n'
    '- Supports Zone-redundant and zonal frontends\n'
    '- **99.99% SLA**\n'
    '- Built-in HA ports (for NVA scenarios)\n'
    '- Cross-region load balancing\n\n'
    '**Basic Load Balancer:**\n'
    '- No zone support\n'
    '- **99.95% SLA**\n'
    '- No HA ports\n'
    '- No cross-region support\n\n'
    '*Exam tip*: For production with zone resilience, always choose **Standard SKU**. Basic SKU is suitable for dev/test only.')

tr('network-004', 'question', 'What is the main advantage of Azure Private DNS Zones over custom DNS servers in VNets?')
tr('network-004', 'option_a', 'Lower costs')
tr('network-004', 'option_b', 'Higher performance')
tr('network-004', 'option_c', 'Automatic VM name registration')
tr('network-004', 'option_d', 'Support for external domains')
tr('network-004', 'explanation',
    'The main advantage of **Azure Private DNS Zones** is **automatic VM name registration**.\n\n'
    '**Azure Private DNS Zones:**\n'
    '- VMs are automatically registered with their private IP\n'
    '- No manual DNS record management for VMs\n'
    '- Supports split-horizon DNS (same name resolves differently internally vs externally)\n'
    '- Automatic cleanup when VMs are deleted\n\n'
    '**Custom DNS Servers in VNets:**\n'
    '- Require manual record management\n'
    '- Need additional infrastructure (VM-based DNS servers)\n'
    '- More flexibility (forwarding, conditional forwarding)\n'
    '- Higher operational overhead\n\n'
    '*Exam tip*: For automatic registration of Azure VM names → Private DNS Zones. Custom DNS for advanced scenarios like hybrid DNS with on-premises.')

tr('network-005', 'question', 'Which features does Application Gateway v2 add compared to v1? (Select 3)')
tr('network-005', 'option_a', 'Autoscaling')
tr('network-005', 'option_b', 'Zone Redundancy')
tr('network-005', 'option_c', 'Static VIP')
tr('network-005', 'option_d', 'Web Application Firewall (WAF)')
tr('network-005', 'option_e', 'Rewrite HTTP Headers')
tr('network-005', 'explanation',
    '**Application Gateway v2** offers several additional features over v1:\n\n'
    '**v2 only features:**\n'
    '- **Autoscaling**: Automatically scales based on traffic\n'
    '- **Zone Redundancy**: Deploy across availability zones\n'
    '- **Rewrite HTTP Headers**: Modify request/response headers\n\n'
    '**Available in both v1 and v2:**\n'
    '- **Web Application Firewall (WAF)**: Available in both versions\n'
    '- **Static VIP**: v1 has static VIP, v2 uses dynamic IP (but supports Frontend IP configuration)\n\n'
    '*Exam tip*: Autoscaling and Zone Redundancy are key v2 benefits. WAF Policy is also enhanced in v2 (per-listener policies).')

tr('monitor-001', 'question', 'How long are metrics retained in Azure Monitor by default?')
tr('monitor-001', 'option_a', '30 days')
tr('monitor-001', 'option_b', '60 days')
tr('monitor-001', 'option_c', '90 days')
tr('monitor-001', 'option_d', '93 days')
tr('monitor-001', 'explanation',
    '**Azure Monitor Metrics** are retained for **93 days** by default.\n\n'
    '**Metrics retention details:**\n'
    '- Standard retention: **93 days**\n'
    '- For paid workspaces/Log Analytics integration: retention can be extended\n'
    '- Metrics are stored with 1-minute granularity\n\n'
    '**Log Analytics Workspace:**\n'
    '- Separate retention (30 days to 730 days, configurable)\n'
    '- Logs have different retention than metrics\n\n'
    '*Exam tip*: 93 days is the default metric retention. Log Analytics retention is configurable separately.')

tr('monitor-002', 'question', 'Sort the components of an Azure Alert Rule in logical configuration order:')
tr('monitor-002', 'option_a', 'Scope (select target resource)')
tr('monitor-002', 'option_b', 'Condition (define signal and threshold)')
tr('monitor-002', 'option_c', 'Action Group (configure notifications)')
tr('monitor-002', 'option_d', 'Alert Details (set name and severity)')
tr('monitor-002', 'explanation',
    '**Azure Alert Rule** components in logical configuration order:\n\n'
    '1. **Scope:** Select the target resource (VM, Storage Account, etc.)\n'
    '2. **Condition:** Define the signal (CPU, requests, etc.) and threshold (>80%, etc.)\n'
    '3. **Action Group:** Configure who gets notified (email, SMS, webhook, ITSM)\n'
    '4. **Alert Details:** Set name, description, and severity (0-4)\n\n'
    '*Exam tip*: Action Groups can be shared across alerts. Reuse them instead of creating duplicates.')

tr('monitor-003', 'question', 'Which query language is used in Log Analytics?')
tr('monitor-003', 'option_a', 'SQL')
tr('monitor-003', 'option_b', 'KQL (Kusto Query Language)')
tr('monitor-003', 'option_c', 'PowerShell')
tr('monitor-003', 'option_d', 'JSON Query Syntax')
tr('monitor-003', 'explanation',
    '**Log Analytics** uses **KQL (Kusto Query Language)** for queries.\n\n'
    '**KQL Properties:**\n'
    '- Pipe-based query language (similar to PowerShell)\n'
    '- Case-sensitive\n'
    '- Time-series, aggregation, and join operations\n\n'
    '**Example:**\n'
    '```kql\n'
    'Perf\n'
    '| where CounterName == "% Processor Time"\n'
    '| where Computer == "WEB-SRV-01"\n'
    '| project TimeGenerated, CounterValue\n'
    '| top 10 by TimeGenerated desc\n'
    '```\n\n'
    '*Exam tip*: KQL is essential for Log Analytics. Learn basic operators: `where`, `project`, `summarize`, `join`, `top`.')

tr('monitor-004', 'question', 'Which Network Watcher tools help with connectivity issues? (Select 2)')
tr('monitor-004', 'option_a', 'IP Flow Verify')
tr('monitor-004', 'option_b', 'Connection Monitor')
tr('monitor-004', 'option_c', 'NSG Flow Logs')
tr('monitor-004', 'option_d', 'Topology View')
tr('monitor-004', 'explanation',
    '**Network Watcher Tools** for connectivity issues:\n\n'
    '**IP Flow Verify:**\n'
    '- Tests whether a specific packet (source IP, port, protocol, destination IP, port, direction) is allowed or denied\n'
    '- Returns which NSG rule allowed or blocked the traffic\n'
    '- One-shot diagnostic tool\n\n'
    '**Connection Monitor:**\n'
    '- Continuous monitoring of network connectivity\n'
    '- Probes from multiple agents to endpoints\n'
    '- Latency, packet loss, and routing information\n'
    '- Historical data and alerts\n\n'
    '**Other Tools (not the best match):**\n'
    '- **NSG Flow Logs**: Logs *all* traffic (for analysis/compliance), not a direct troubleshooting tool\n'
    '- **Topology View**: Visual representation of resources, not connectivity testing\n\n'
    '*Exam tip*: IP Flow Verify = one-shot diagnostic. Connection Monitor = continuous monitoring.')

# ========== Phase 2: Remaining questions ==========
# monitor-005, ig-006, storage-006, compute-006, network-006,
# storage-007, ig-007, compute-007, network-007, storage-008,
# compute-008, network-008, monitor-006, ig-008, storage-009,
# compute-009, network-009, monitor-007, ig-009 through ig-020,
# storage-010 through storage-020,
# compute-010 through compute-025,
# network-010 through network-020,
# monitor-008 through monitor-019

print(f"Translation entries: {len(EN)}")

# ==========================================================
# Apply translations
# ==========================================================
qs = data['questions']
applied = 0
for q in qs:
    qid = q['id']
    
    key_q = f'{qid}.question'
    if key_q in EN:
        q['question'] = EN[key_q]
        applied += 1
    else:
        print(f"MISSING: {key_q}")
    
    for o in q['options']:
        key_o = f'{qid}.option_{o["id"]}'
        if key_o in EN:
            o['text'] = EN[key_o]
            applied += 1
        else:
            print(f"MISSING: {key_o}")
    
    key_e = f'{qid}.explanation'
    if key_e in EN:
        q['explanation'] = EN[key_e]
        applied += 1
    else:
        print(f"MISSING: {key_e}")

print(f"Applied {applied}/{len(EN)} translations")

# Update meta
data['meta']['id'] = 'azure-az104-en'
data['meta']['label'] = 'Azure AZ-104 (English)'
data['meta']['description'] = 'Microsoft Azure Administrator (English)'
data['meta']['exam']['info'] = '100 minutes · 40–60 questions · Pass at 700/1000 · Single-choice, multiple-answer, drag-and-drop. No negative marking for guessing.'

# Write
with open(DST, 'w') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\nWritten {DST}")
print(f"Questions: {len(qs)}")