# Proxmox VE Compute Module

Provisions RKE2 cluster nodes on Proxmox VE by cloning a Packer-built VM template. Supports single-node and multi-node clusters with configurable storage, networking, and IP assignment (DHCP or static).

## NIST Controls

- **CM-2** — VMs cloned from a hardened, versioned template (immutable baseline)
- **CM-6** — Configuration applied via cloud-init from a known-good state
- **AC-17** — SSH key-based authentication only, password login disabled
- **IA-5** — SSH public key injected via cloud-init, no shared credentials

## Resources Created

- `proxmox_virtual_environment_vm.server` — RKE2 control plane nodes (cloned from template)
- `proxmox_virtual_environment_vm.agent` — RKE2 worker nodes (cloned from template)
- `proxmox_virtual_environment_file.cloud_init_user_data` — Cloud-init snippet for user setup

## Prerequisites

- A Packer-built VM template must exist on the target Proxmox node (see `infrastructure/packer/rocky-linux-9-proxmox/`)
- The Proxmox provider must be configured at the environment level (not in this module)

## Usage

```hcl
module "proxmox_cluster" {
  source = "../../modules/proxmox"

  environment   = "lab"
  proxmox_node  = "pve"
  template_name = "sre-rocky9-rke2"
  storage_pool  = "local-lvm"

  server_count  = 1
  server_cores  = 4
  server_memory = 8192

  agent_count   = 2
  agent_cores   = 4
  agent_memory  = 8192

  network_bridge = "vmbr0"
  ip_config      = "dhcp"

  ssh_public_key = var.ssh_public_key
}
```

### Static IP Configuration

```hcl
module "proxmox_cluster" {
  source = "../../modules/proxmox"

  environment   = "lab"
  proxmox_node  = "pve"
  template_name = "sre-rocky9-rke2"
  storage_pool  = "local-lvm"

  server_count = 3
  agent_count  = 3

  network_bridge = "vmbr0"
  vlan_tag       = 100
  ip_config      = "10.0.1.0/24,gw=10.0.1.1"
  server_ip_start = "10.0.1.10"
  agent_ip_start  = "10.0.1.20"
  nameserver      = "10.0.1.1"
  search_domain   = "sre.local"

  ssh_public_key = var.ssh_public_key
}
```

## Inputs

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `environment` | `string` | `"lab"` | Deployment environment name |
| `proxmox_node` | `string` | *(required)* | Proxmox node name |
| `template_name` | `string` | *(required)* | Packer template name to clone |
| `storage_pool` | `string` | *(required)* | Proxmox storage pool for disks |
| `server_count` | `number` | `1` | Control plane nodes (odd, 1-7) |
| `server_cores` | `number` | `4` | CPU cores per server |
| `server_memory` | `number` | `8192` | Memory in MB per server |
| `server_disk_size` | `number` | `50` | Root disk GB per server |
| `agent_count` | `number` | `2` | Worker nodes (1-20) |
| `agent_cores` | `number` | `4` | CPU cores per agent |
| `agent_memory` | `number` | `8192` | Memory in MB per agent |
| `agent_disk_size` | `number` | `50` | Root disk GB per agent |
| `network_bridge` | `string` | `"vmbr0"` | Proxmox network bridge |
| `vlan_tag` | `number` | `-1` | VLAN tag (-1 = none) |
| `ip_config` | `string` | `"dhcp"` | IP mode: `dhcp` or `CIDR,gw=GW` |
| `server_ip_start` | `string` | `""` | First server static IP |
| `agent_ip_start` | `string` | `""` | First agent static IP |
| `nameserver` | `string` | `""` | DNS server for static IP mode |
| `search_domain` | `string` | `""` | DNS search domain |
| `ssh_public_key` | `string` | *(required)* | SSH public key for sre-admin |
| `common_tags` | `list(string)` | `["sre-platform", ...]` | Proxmox VM tags |

## Outputs

| Name | Description |
|------|-------------|
| `server_ips` | IP addresses of control plane nodes |
| `agent_ips` | IP addresses of worker nodes |
| `api_server_endpoint` | Kubernetes API URL (first server, port 6443) |
| `server_vm_ids` | Proxmox VM IDs of server nodes |
| `agent_vm_ids` | Proxmox VM IDs of agent nodes |
| `server_vm_names` | Proxmox VM names of server nodes |
| `agent_vm_names` | Proxmox VM names of agent nodes |

## Required Network Ports

Ensure these ports are open between all cluster nodes:

| Port | Protocol | Purpose |
|------|----------|---------|
| 6443 | TCP | Kubernetes API server |
| 9345 | TCP | RKE2 supervisor API (join) |
| 2379-2380 | TCP | etcd client and peer |
| 10250 | TCP | kubelet API |
| 8472 | UDP | VXLAN (Canal CNI) |

## High Availability Notes

Proxmox VE does not provide a built-in load balancer resource. For HA setups with 3+ server nodes:

1. **Option A: keepalived** — Deploy a virtual IP (VIP) shared between server nodes using keepalived. Set `rke2_tls_san` in Ansible to include the VIP.
2. **Option B: HAProxy** — Run HAProxy on a separate VM or LXC container, load balancing TCP 6443 and 9345 across server nodes.
3. **Option C: External LB** — Use an external hardware or software load balancer if available on your network.

The `api_server_endpoint` output points to the first server node. Replace this with your VIP or load balancer address in the Ansible inventory for HA deployments.
