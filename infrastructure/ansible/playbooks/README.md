# Ansible Playbooks

Top-level playbooks that compose roles for specific operations.

## Playbooks

| Playbook | Purpose |
|----------|---------|
| `site.yml` | Full provisioning run: OS hardening + RKE2 install + RKE2 hardening |
| `harden-os.yml` | Apply DISA STIG to Rocky Linux 9 nodes |
| `install-rke2.yml` | Install and configure RKE2 on hardened nodes |
| `upgrade-rke2.yml` | Rolling upgrade of RKE2 across the cluster |

## Usage

```bash
# Full setup
ansible-playbook playbooks/site.yml -i inventory/dev/hosts.yml

# OS hardening only
ansible-playbook playbooks/harden-os.yml -i inventory/dev/hosts.yml --tags sshd,audit

# RKE2 install only
ansible-playbook playbooks/install-rke2.yml -i inventory/dev/hosts.yml
```
