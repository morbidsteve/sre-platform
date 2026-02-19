# Ansible Configuration Management

Ansible playbooks and roles for OS hardening and RKE2 cluster installation. Ansible manages everything up to the point where Kubernetes is running — after that, Flux CD takes over.

See [Ansible patterns](../../docs/agent-docs/ansible-patterns.md) for coding conventions.

## Structure

```
ansible/
├── playbooks/        # Top-level playbooks
│   ├── site.yml      # Full run: harden + install + post-harden
│   ├── harden-os.yml # OS STIG hardening only
│   └── install-rke2.yml # RKE2 installation only
├── roles/            # Reusable roles
│   ├── os-hardening/ # Rocky Linux 9 DISA STIG
│   ├── rke2-common/  # Shared RKE2 prerequisites
│   ├── rke2-server/  # Control plane node setup
│   ├── rke2-agent/   # Worker node setup
│   └── rke2-hardening/ # RKE2-specific STIG settings
├── inventory/        # Per-environment inventories
│   ├── dev/
│   ├── staging/
│   └── production/
└── ansible.cfg       # Ansible configuration
```

## Key Rules

- Always use FQCN (e.g., `ansible.builtin.dnf`, not `dnf`)
- All tasks must be idempotent — running twice produces the same result
- Use `ansible-vault` for any sensitive variables
- Break task files by concern (sshd.yml, auditd.yml, etc.)
- Use handlers for service restarts
