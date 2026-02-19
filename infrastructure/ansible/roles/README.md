# Ansible Roles

Reusable Ansible roles for the SRE platform.

## Roles

| Role | Purpose |
|------|---------|
| `os-hardening/` | Apply DISA STIG to Rocky Linux 9 (SSH, auditd, sysctl, PAM, FIPS, SELinux) |
| `rke2-common/` | Shared prerequisites for all RKE2 nodes (kernel modules, sysctl, firewall) |
| `rke2-server/` | Install and configure RKE2 server (control plane) nodes |
| `rke2-agent/` | Install and configure RKE2 agent (worker) nodes |
| `rke2-hardening/` | Apply RKE2-specific DISA STIG settings post-installation |

## Role Structure

Each role follows Ansible Galaxy structure:

```
role-name/
├── tasks/main.yml       # Task entry point (includes sub-task files)
├── handlers/main.yml    # Service restart/reload handlers
├── defaults/main.yml    # Default variables (documented)
├── templates/           # Jinja2 templates for config files
├── files/               # Static files
└── meta/main.yml        # Role metadata and dependencies
```
