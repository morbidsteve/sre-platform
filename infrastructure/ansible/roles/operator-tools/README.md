# Operator Tools Role

Installs CLI tools for Kubernetes cluster operators on RKE2 nodes.

## Tools Installed

| Tool | Default Version | Purpose |
|------|----------------|---------|
| **k9s** | v0.32.7 | Terminal UI for Kubernetes — view pods, logs, exec into containers |
| **Helm** | v3.16.4 | Kubernetes package manager for chart installation/debugging |
| **kubectl** | (symlink) | Links RKE2's bundled kubectl to `/usr/local/bin/kubectl` |

## Usage

Run as part of the full site playbook:

```bash
ansible-playbook playbooks/site.yml -i inventory/dev/hosts.yml
```

Or run standalone:

```bash
ansible-playbook playbooks/install-operator-tools.yml -i inventory/dev/hosts.yml
```

Install only k9s:

```bash
ansible-playbook playbooks/install-operator-tools.yml -i inventory/dev/hosts.yml --tags k9s
```

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `operator_tools_k9s_enabled` | `true` | Install k9s |
| `operator_tools_k9s_version` | `v0.32.7` | k9s release version |
| `operator_tools_k9s_arch` | `amd64` | CPU architecture (`amd64`, `arm64`) |
| `operator_tools_helm_enabled` | `true` | Install Helm |
| `operator_tools_helm_version` | `v3.16.4` | Helm release version |
| `operator_tools_kubectl_symlink` | `true` | Create `/usr/local/bin/kubectl` symlink to RKE2 binary |

## After Installation

SSH to any node and run:

```bash
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
k9s
```

k9s provides a full terminal UI for managing pods, deployments, services, logs, and exec sessions without memorizing kubectl commands.
