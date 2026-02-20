# Proxmox Lab Environment — Example Variable Values
# Copy this file and update with your Proxmox environment details.
# Sensitive values (API token, SSH key) should be injected via environment variables:
#   export TF_VAR_proxmox_api_token="user@pve!token=secret-value"
#   export TF_VAR_ssh_public_key="ssh-ed25519 AAAA..."

proxmox_endpoint = "https://pve.example.com:8006"
proxmox_insecure = true
proxmox_node     = "pve"
storage_pool     = "local-lvm"
template_name    = "sre-rocky9-rke2"

# Minimal lab cluster: 1 CP + 2 workers
server_count  = 1
agent_count   = 2
server_cores  = 4
server_memory = 8192
agent_cores   = 4
agent_memory  = 8192

network_bridge = "vmbr0"
ip_config      = "dhcp"
