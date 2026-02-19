# Ansible Patterns for SRE

Read this before creating or modifying anything in `infrastructure/ansible/`.

## Purpose

Ansible handles two things in SRE:

1. **OS Hardening** — Apply DISA STIGs to Rocky Linux 9 base images and running nodes
2. **RKE2 Installation** — Bootstrap and configure RKE2 clusters on hardened nodes

Ansible does NOT manage Kubernetes resources after RKE2 is running — that is Flux CD's job.

## Directory Structure

```
infrastructure/ansible/
├── inventory/
│   ├── dev/
│   │   ├── hosts.yml           # Inventory for dev environment
│   │   └── group_vars/
│   │       ├── all.yml         # Shared variables
│   │       ├── control_plane.yml
│   │       └── workers.yml
│   ├── staging/
│   └── production/
├── roles/
│   ├── os-hardening/           # DISA STIG application for Rocky Linux 9
│   │   ├── tasks/
│   │   │   ├── main.yml
│   │   │   ├── sshd.yml
│   │   │   ├── auditd.yml
│   │   │   ├── filesystem.yml
│   │   │   ├── kernel.yml
│   │   │   ├── firewall.yml
│   │   │   ├── crypto-policy.yml
│   │   │   └── aide.yml
│   │   ├── handlers/
│   │   │   └── main.yml
│   │   ├── defaults/
│   │   │   └── main.yml
│   │   ├── templates/
│   │   ├── files/
│   │   └── meta/
│   │       └── main.yml
│   ├── rke2-common/            # Shared RKE2 prereqs (kernel modules, sysctl)
│   ├── rke2-server/            # RKE2 control plane install and config
│   ├── rke2-agent/             # RKE2 worker node install and config
│   └── rke2-hardening/         # RKE2-specific DISA STIG settings
├── playbooks/
│   ├── site.yml                # Full run: harden + install + harden RKE2
│   ├── harden-os.yml           # OS hardening only
│   ├── install-rke2.yml        # RKE2 install only
│   └── upgrade-rke2.yml        # Rolling RKE2 upgrade
└── ansible.cfg
```

## ansible.cfg

```ini
[defaults]
inventory = inventory/dev/hosts.yml
roles_path = roles
host_key_checking = False
retry_files_enabled = False
stdout_callback = yaml
collections_paths = ~/.ansible/collections

[privilege_escalation]
become = True
become_method = sudo

[ssh_connection]
pipelining = True
ssh_args = -o ControlMaster=auto -o ControlPersist=60s
```

## FQCN Requirement

ALWAYS use Fully Qualified Collection Names. Never use short module names.

```yaml
# CORRECT
- name: Install required packages
  ansible.builtin.dnf:
    name: "{{ item }}"
    state: present
  loop:
    - audit
    - aide
    - firewalld

# WRONG — never do this
- name: Install required packages
  dnf:
    name: "{{ item }}"
    state: present
```

## Role Conventions

### defaults/main.yml — document every variable

```yaml
---
# Whether to enable FIPS 140-2 mode on the OS
os_hardening_fips_enabled: true

# SSH settings
os_hardening_ssh_port: 22
os_hardening_ssh_permit_root_login: "no"
os_hardening_ssh_password_authentication: "no"
os_hardening_ssh_max_auth_tries: 3
os_hardening_ssh_client_alive_interval: 600
os_hardening_ssh_client_alive_count_max: 0

# Audit settings
os_hardening_audit_max_log_file: 25
os_hardening_audit_space_left_action: email
```

### Task files — one concern per file

Break `tasks/main.yml` into includes by topic:

```yaml
# tasks/main.yml
---
- name: Include SSHD hardening
  ansible.builtin.include_tasks: sshd.yml
  tags: [sshd]

- name: Include audit configuration
  ansible.builtin.include_tasks: auditd.yml
  tags: [audit]

- name: Include filesystem hardening
  ansible.builtin.include_tasks: filesystem.yml
  tags: [filesystem]

- name: Include kernel hardening
  ansible.builtin.include_tasks: kernel.yml
  tags: [kernel]

- name: Include firewall configuration
  ansible.builtin.include_tasks: firewall.yml
  tags: [firewall]

- name: Include crypto policy
  ansible.builtin.include_tasks: crypto-policy.yml
  tags: [crypto]

- name: Include AIDE configuration
  ansible.builtin.include_tasks: aide.yml
  tags: [aide]
```

### Handlers — use them for service restarts

```yaml
# handlers/main.yml
---
- name: Restart sshd
  ansible.builtin.systemd:
    name: sshd
    state: restarted

- name: Restart auditd
  ansible.builtin.command: service auditd restart
  # auditd cannot be restarted via systemd — this is intentional

- name: Reload firewalld
  ansible.builtin.systemd:
    name: firewalld
    state: reloaded
```

## Idempotency Rules

Every task MUST be idempotent — running the playbook twice produces the same result.

```yaml
# CORRECT — idempotent
- name: Set kernel parameter for IP forwarding
  ansible.posix.sysctl:
    name: net.ipv4.ip_forward
    value: "1"
    state: present
    sysctl_set: true
    reload: true

# WRONG — not idempotent (appends every run)
- name: Set kernel parameter
  ansible.builtin.shell: echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
```

Rules:
- Use modules (dnf, systemd, sysctl, template, copy) instead of shell/command
- If you must use `ansible.builtin.command` or `ansible.builtin.shell`, ALWAYS include `creates`, `removes`, or `when` conditions
- Use `ansible.builtin.template` with Jinja2 instead of `ansible.builtin.lineinfile` for complex files
- Test idempotency by running the playbook twice and confirming zero changes on the second run

## Inventory Conventions

```yaml
# inventory/dev/hosts.yml
---
all:
  children:
    control_plane:
      hosts:
        cp-1:
          ansible_host: 10.0.1.10
        cp-2:
          ansible_host: 10.0.1.11
        cp-3:
          ansible_host: 10.0.1.12
    workers:
      hosts:
        worker-1:
          ansible_host: 10.0.2.10
        worker-2:
          ansible_host: 10.0.2.11
        worker-3:
          ansible_host: 10.0.2.12
  vars:
    ansible_user: sre-admin
    ansible_ssh_private_key_file: ~/.ssh/sre-dev
```

## Sensitive Data

- NEVER put secrets in plain text in inventory or vars files
- Use `ansible-vault` for encrypting variable files
- Vault password is stored outside the repo and referenced via `--vault-password-file`

```bash
# Encrypt a vars file
ansible-vault encrypt inventory/production/group_vars/all/vault.yml

# Run with vault
ansible-playbook playbooks/site.yml --vault-password-file ~/.vault_pass
```

## Tags Strategy

Use tags consistently so operators can run subsets:

```bash
# Run only SSH hardening
ansible-playbook playbooks/harden-os.yml --tags sshd

# Run only RKE2 install (skip OS hardening)
ansible-playbook playbooks/install-rke2.yml

# Run everything
ansible-playbook playbooks/site.yml
```

## Linting

```bash
ansible-lint                  # Lint all playbooks and roles
ansible-lint roles/os-hardening/

# Also run via task
task lint                     # Includes ansible-lint
```

## Common Mistakes

- Using short module names instead of FQCN — always use `ansible.builtin.*`
- Using `shell` or `command` without idempotency guards — add `creates`, `removes`, or `when`
- Using `lineinfile` for complex config files — use `template` instead
- Putting secrets in plain text vars — use `ansible-vault`
- Missing tags on task includes — operators cannot run subsets
- Missing handlers for service restarts — config changes require service reload
- Forgetting to test idempotency — run twice and check for zero changes on second run
- Not using `become: true` for tasks that need root — set at play level or task level
