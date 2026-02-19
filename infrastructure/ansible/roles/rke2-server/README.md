# rke2-server

Installs and configures RKE2 server (control plane) nodes. This role handles prerequisites, binary installation, cluster configuration, and service management. It is designed to run after OS hardening and produces a functional RKE2 control plane with CIS 1.23 hardening profile, FIPS 140-2 mode, etcd snapshots, and a kubeconfig ready for Flux CD bootstrap.

## What It Does

1. **Prerequisites** -- Installs required packages (`container-selinux`, `iptables`, `NetworkManager`). Creates the RKE2 config and data directories. Configures NetworkManager to ignore Canal/Flannel CNI interfaces.
2. **Installation** -- Downloads the official RKE2 install script from `get.rke2.io` and runs it with the pinned version and `server` type. Skips installation if the RKE2 binary already exists (idempotent).
3. **Configuration** -- Generates `/etc/rancher/rke2/config.yaml` from a Jinja2 template. Configures the CIS hardening profile, FIPS mode, Canal CNI, TLS SANs (including optional load balancer DNS), etcd snapshot schedule, kubelet arguments, and disabled default components (ingress-nginx is disabled because Istio handles ingress).
4. **Service Management** -- Enables and starts the `rke2-server` systemd service. Waits for the node token to be generated (up to 300 seconds). Symlinks `kubectl` to `/usr/local/bin` and creates a kubeconfig symlink at `/root/.kube/config`.

## Variables

All variables are defined in `defaults/main.yml`. The `rke2_token` variable must be overridden via `ansible-vault` -- never use the placeholder value.

| Variable | Default | Description |
|----------|---------|-------------|
| `rke2_version` | `"v1.28.6+rke2r1"` | RKE2 version to install. Must be pinned explicitly. |
| `rke2_channel` | `"stable"` | RKE2 release channel (stable, latest, or specific). |
| `rke2_install_method` | `"rpm"` | Installation method. Use `"tarball"` for air-gapped environments. |
| `rke2_server_url` | `""` | Empty for the first server node (cluster init). Set to `https://<first-server>:9345` for additional server nodes joining the cluster. |
| `rke2_token` | `"REPLACE_ME"` | Shared token for node registration. Inject via ansible-vault. |
| `rke2_tls_san` | `["{{ ansible_default_ipv4.address }}"]` | TLS Subject Alternative Names for the API server certificate. |
| `rke2_api_server_lb` | `""` | API server load balancer DNS name. Automatically added to TLS SANs when set. |
| `rke2_profile` | `"cis-1.23"` | CIS hardening profile. Required for DISA STIG compliance. |
| `rke2_fips_enabled` | `true` | Enable FIPS 140-2 mode using the BoringCrypto Go module. |
| `rke2_cni` | `"canal"` | CNI plugin. Canal is the only FIPS-validated option for RKE2. |
| `rke2_disable` | `["rke2-ingress-nginx"]` | List of default RKE2 components to disable. Ingress is disabled because Istio handles ingress. |
| `rke2_etcd_snapshot_schedule` | `"0 */6 * * *"` | Cron schedule for etcd snapshots (every 6 hours by default). |
| `rke2_etcd_snapshot_retention` | `5` | Number of etcd snapshots to retain. |
| `rke2_data_dir` | `"/var/lib/rancher/rke2"` | RKE2 data directory. |
| `rke2_kubelet_args` | See defaults | Kubelet arguments. Defaults include `protect-kernel-defaults`, `streaming-connection-idle-timeout`, and `make-iptables-util-chains`. |

## Tags

| Tag | Description |
|-----|-------------|
| `prereqs` | Package installation, directory creation, NetworkManager config |
| `install` | RKE2 binary download and installation |
| `configure` | Generate RKE2 config.yaml from template |
| `service` | Enable/start rke2-server, symlink kubectl and kubeconfig |

```bash
# Run only configuration (skip install if already done)
ansible-playbook playbooks/install-rke2.yml -i inventory/dev/hosts.yml --tags configure

# Run only service management
ansible-playbook playbooks/install-rke2.yml -i inventory/dev/hosts.yml --tags service
```

## Usage

### Standalone

```bash
ansible-playbook playbooks/install-rke2.yml -i inventory/dev/hosts.yml
```

The playbook runs with `serial: 1` on `control_plane` hosts so that the first server initializes the cluster before additional servers attempt to join.

### As part of full site provisioning

```bash
ansible-playbook playbooks/site.yml -i inventory/dev/hosts.yml
```

### Multi-node control plane

For a 3-node HA control plane, set inventory variables so the first server has `rke2_server_url: ""` (cluster init) and the remaining servers point to the first:

```yaml
# inventory/dev/group_vars/control_plane.yml
rke2_token: "{{ vault_rke2_token }}"
rke2_api_server_lb: "api.sre.example.com"

# inventory/dev/hosts.yml
control_plane:
  hosts:
    cp-1:
      ansible_host: 10.0.1.10
      rke2_server_url: ""               # First node initializes
    cp-2:
      ansible_host: 10.0.1.11
      rke2_server_url: "https://10.0.1.10:9345"
    cp-3:
      ansible_host: 10.0.1.12
      rke2_server_url: "https://10.0.1.10:9345"
```

## NIST 800-53 Controls Addressed

| Control | Family | How This Role Addresses It |
|---------|--------|---------------------------|
| CM-2 | Configuration Mgmt | RKE2 configuration defined declaratively in Git, applied via Ansible |
| CM-6 | Configuration Mgmt | CIS 1.23 hardening profile applied, kubelet hardened arguments set |
| SC-13 | Cryptographic Protection | FIPS 140-2 mode enabled via BoringCrypto module |
| SI-7 | System Integrity | Etcd snapshots provide cluster state integrity verification and recovery |

## Handlers

- `Restart rke2-server` -- Triggered when `/etc/rancher/rke2/config.yaml` changes
- `Restart NetworkManager` -- Triggered when the Canal/Flannel interface exclusion config is deployed

## Platform Compatibility

- Rocky Linux 9
- AlmaLinux 9
- RHEL 9

Requires Ansible 2.15 or later. Uses FQCN for all module references.
