# rke2-agent

Installs and configures RKE2 agent (worker) nodes that join an existing RKE2 cluster. This role handles prerequisites, binary installation, agent configuration, and service management. It is designed to run after the `rke2-server` role has initialized the control plane, and requires a valid `rke2_server_url` and `rke2_token` to join the cluster.

## What It Does

1. **Validation** -- Asserts that `rke2_server_url` is set and `rke2_token` is not the placeholder value. Fails early with a clear message if either is missing.
2. **Prerequisites** -- Installs required packages (`container-selinux`, `iptables`, `NetworkManager`). Creates the RKE2 config directory. Configures NetworkManager to ignore Canal/Flannel CNI interfaces.
3. **Installation** -- Downloads the official RKE2 install script from `get.rke2.io` and runs it with the pinned version and `agent` type. Skips installation if the RKE2 binary already exists (idempotent).
4. **Configuration** -- Generates `/etc/rancher/rke2/config.yaml` from a Jinja2 template. Configures the server URL to join, registration token, node labels, and kubelet arguments.
5. **Service Management** -- Enables and starts the `rke2-agent` systemd service. Waits for the kubelet kubeconfig to appear (up to 300 seconds), confirming the node has joined the cluster.

## Variables

All variables are defined in `defaults/main.yml`. Both `rke2_server_url` and `rke2_token` must be overridden -- the role will fail if they are left at their defaults.

| Variable | Default | Description |
|----------|---------|-------------|
| `rke2_version` | `"v1.28.6+rke2r1"` | RKE2 version to install. Must match the server version. |
| `rke2_channel` | `"stable"` | RKE2 release channel. |
| `rke2_install_method` | `"rpm"` | Installation method. Use `"tarball"` for air-gapped environments. |
| `rke2_server_url` | `""` | **Required.** URL of the RKE2 server to join (e.g., `https://10.0.1.10:9345`). |
| `rke2_token` | `"REPLACE_ME"` | **Required.** Shared token for node registration. Inject via ansible-vault. |
| `rke2_data_dir` | `"/var/lib/rancher/rke2"` | RKE2 data directory. |
| `rke2_node_labels` | `["node-role.kubernetes.io/worker=true"]` | Kubernetes labels applied to the agent node. |
| `rke2_kubelet_args` | See defaults | Kubelet arguments. Defaults include `protect-kernel-defaults`, `streaming-connection-idle-timeout`, and `make-iptables-util-chains`. |

## Tags

| Tag | Description |
|-----|-------------|
| `always` | Variable validation (runs regardless of tag filters) |
| `prereqs` | Package installation, directory creation, NetworkManager config |
| `install` | RKE2 binary download and installation |
| `configure` | Generate RKE2 agent config.yaml from template |
| `service` | Enable/start rke2-agent, wait for cluster join |

```bash
# Run only configuration (skip install if already done)
ansible-playbook playbooks/install-rke2.yml -i inventory/dev/hosts.yml --tags configure --limit workers

# Run only service management
ansible-playbook playbooks/install-rke2.yml -i inventory/dev/hosts.yml --tags service --limit workers
```

## Usage

### Standalone (workers only)

```bash
ansible-playbook playbooks/install-rke2.yml -i inventory/dev/hosts.yml --limit workers
```

### As part of full site provisioning

```bash
ansible-playbook playbooks/site.yml -i inventory/dev/hosts.yml
```

The `install-rke2.yml` playbook runs the `rke2-server` role on `control_plane` hosts first (serially), then runs this role on `workers` hosts. This ordering ensures the cluster is initialized before agents attempt to join.

### Inventory example

```yaml
# inventory/dev/group_vars/workers.yml
rke2_server_url: "https://10.0.1.10:9345"
rke2_token: "{{ vault_rke2_token }}"

# inventory/dev/hosts.yml
workers:
  hosts:
    worker-1:
      ansible_host: 10.0.2.10
    worker-2:
      ansible_host: 10.0.2.11
    worker-3:
      ansible_host: 10.0.2.12
```

### Adding custom node labels

Override `rke2_node_labels` per host or group to assign workload-specific labels:

```yaml
# inventory/dev/host_vars/worker-1.yml
rke2_node_labels:
  - "node-role.kubernetes.io/worker=true"
  - "topology.kubernetes.io/zone=us-east-1a"
  - "workload-type=general"
```

## NIST 800-53 Controls Addressed

| Control | Family | How This Role Addresses It |
|---------|--------|---------------------------|
| CM-2 | Configuration Mgmt | Agent configuration defined declaratively in Git, applied via Ansible |
| CM-6 | Configuration Mgmt | Kubelet hardened arguments enforce secure defaults |

## Handlers

- `Restart rke2-agent` -- Triggered when `/etc/rancher/rke2/config.yaml` changes
- `Restart NetworkManager` -- Triggered when the Canal/Flannel interface exclusion config is deployed

## Platform Compatibility

- Rocky Linux 9
- AlmaLinux 9
- RHEL 9

Requires Ansible 2.15 or later. Uses FQCN for all module references.
