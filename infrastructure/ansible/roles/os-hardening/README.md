# os-hardening

Applies DISA STIG hardening to Rocky Linux 9 (and RHEL 9 compatible) nodes. This role configures SSH, auditd, kernel parameters, filesystem permissions, PAM password policies, FIPS 140-2 crypto policy, firewalld, and AIDE file integrity monitoring. It is designed to run before RKE2 installation and produces a baseline that satisfies CIS Level 2 and DISA STIG requirements.

## What It Does

1. **SSH Hardening** -- Deploys a locked-down `sshd_config` with FIPS-approved ciphers, MACs, and key exchange algorithms. Disables root login and password authentication. Sets a DoD-style login banner. Removes host keys shorter than 3072 bits.
2. **Audit Configuration** -- Installs and configures `auditd` with STIG-compliant rules for monitoring privileged operations, file access, and user activity. Audit logs are sized and rotated per DISA requirements.
3. **Kernel Hardening** -- Loads `br_netfilter` and `overlay` modules (required for Kubernetes), then applies sysctl settings for network security (disable redirects, enable source route validation, SYN cookies, martian logging) and kernel security (restrict ptrace, dmesg, ASLR, disable core dumps, zero swappiness).
4. **Filesystem Hardening** -- Sets restrictive permissions on `/etc/passwd`, `/etc/shadow`, `/etc/group`, and `/etc/gshadow`. Mounts `/tmp` as tmpfs with `nodev,nosuid,noexec`. Applies sticky bit to world-writable directories. Disables automounting.
5. **PAM / Password Policy** -- Enforces password complexity (minimum 15 characters, 4 character classes), aging (60-day maximum, 1-day minimum), and account lockout (3 retries, 15-minute lockout) via `pwquality.conf` and `faillock.conf`. Sets default umask to 077.
6. **Crypto Policy** -- Sets the system-wide crypto policy to FIPS and enables FIPS 140-2 kernel mode. A reboot is required after FIPS enablement.
7. **Firewall** -- Installs and enables `firewalld` with a default zone of `drop`. Only SSH is allowed by default.
8. **AIDE** -- Installs Advanced Intrusion Detection Environment, initializes the integrity database, and schedules a daily cron check at 05:30.

## Variables

All variables are defined in `defaults/main.yml` and can be overridden in inventory `group_vars`.

### FIPS Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `os_hardening_fips_enabled` | `true` | Enable FIPS 140-2 mode and set FIPS crypto policy |

### SSH (NIST AC-17, IA-2)

| Variable | Default | Description |
|----------|---------|-------------|
| `os_hardening_ssh_port` | `22` | SSH listening port |
| `os_hardening_ssh_permit_root_login` | `"no"` | Allow root login over SSH |
| `os_hardening_ssh_password_authentication` | `"no"` | Allow password-based SSH authentication |
| `os_hardening_ssh_max_auth_tries` | `3` | Maximum authentication attempts per connection |
| `os_hardening_ssh_client_alive_interval` | `600` | Seconds before sending a keepalive to idle clients |
| `os_hardening_ssh_client_alive_count_max` | `0` | Number of missed keepalives before disconnect |
| `os_hardening_ssh_x11_forwarding` | `"no"` | Allow X11 forwarding |
| `os_hardening_ssh_max_sessions` | `10` | Maximum SSH sessions per connection |
| `os_hardening_ssh_log_level` | `"VERBOSE"` | SSH log verbosity |
| `os_hardening_ssh_ciphers` | FIPS-approved AES ciphers | Allowed SSH ciphers |
| `os_hardening_ssh_macs` | HMAC-SHA2 ETM variants | Allowed SSH MACs |
| `os_hardening_ssh_kex_algorithms` | ECDH + DH group14/16/18 | Allowed key exchange algorithms |

### Audit (NIST AU-2, AU-3, AU-12)

| Variable | Default | Description |
|----------|---------|-------------|
| `os_hardening_audit_max_log_file` | `25` | Maximum audit log file size in MB |
| `os_hardening_audit_num_logs` | `5` | Number of audit log files to retain |
| `os_hardening_audit_max_log_file_action` | `"keep_logs"` | Action when max log file size is reached |
| `os_hardening_audit_space_left_action` | `"email"` | Action when disk space is low |
| `os_hardening_audit_admin_space_left_action` | `"halt"` | Action when admin space threshold is reached |
| `os_hardening_audit_disk_full_action` | `"halt"` | Action when disk is full |
| `os_hardening_audit_disk_error_action` | `"halt"` | Action on disk error |

### Kernel (NIST SC-7, SI-7)

| Variable | Default | Description |
|----------|---------|-------------|
| `os_hardening_sysctl_settings` | See defaults | Dictionary of sysctl key-value pairs. Includes Kubernetes prerequisites (ip_forward, bridge-nf-call) and STIG network/kernel hardening. |

### Filesystem

| Variable | Default | Description |
|----------|---------|-------------|
| `os_hardening_tmp_mount_options` | `"nodev,nosuid,noexec"` | Mount options for /tmp |
| `os_hardening_var_tmp_mount_options` | `"nodev,nosuid,noexec"` | Mount options for /var/tmp |

### PAM / Password Policy (NIST IA-5)

| Variable | Default | Description |
|----------|---------|-------------|
| `os_hardening_password_min_length` | `15` | Minimum password length |
| `os_hardening_password_min_class` | `4` | Minimum number of character classes |
| `os_hardening_password_max_days` | `60` | Maximum password age in days |
| `os_hardening_password_min_days` | `1` | Minimum days between password changes |
| `os_hardening_password_warn_age` | `7` | Days before expiry to warn user |
| `os_hardening_max_login_retries` | `3` | Failed login attempts before lockout |
| `os_hardening_lockout_time` | `900` | Account lockout duration in seconds (15 minutes) |

### AIDE (NIST SI-7)

| Variable | Default | Description |
|----------|---------|-------------|
| `os_hardening_aide_enabled` | `true` | Install and configure AIDE file integrity monitoring |

### Firewall (NIST SC-7)

| Variable | Default | Description |
|----------|---------|-------------|
| `os_hardening_firewalld_enabled` | `true` | Enable firewalld |
| `os_hardening_firewalld_default_zone` | `"drop"` | Default firewall zone |

## Tags

Run specific hardening sections using tags:

| Tag | Description |
|-----|-------------|
| `sshd` | SSH daemon configuration |
| `audit` | auditd configuration and rules |
| `kernel` | Sysctl settings and kernel module loading |
| `filesystem` | File permissions and mount options |
| `pam` | Password policy and account lockout |
| `crypto` | FIPS crypto policy |
| `firewall` | firewalld configuration |
| `aide` | AIDE file integrity monitoring |

```bash
# Run only SSH hardening
ansible-playbook playbooks/harden-os.yml -i inventory/dev/hosts.yml --tags sshd

# Run kernel and firewall hardening
ansible-playbook playbooks/harden-os.yml -i inventory/dev/hosts.yml --tags kernel,firewall
```

## Usage

### Standalone

```bash
ansible-playbook playbooks/harden-os.yml -i inventory/dev/hosts.yml
```

### As part of full site provisioning

```bash
ansible-playbook playbooks/site.yml -i inventory/dev/hosts.yml
```

### With variable overrides

```bash
ansible-playbook playbooks/harden-os.yml -i inventory/dev/hosts.yml \
  -e os_hardening_fips_enabled=false \
  -e os_hardening_ssh_port=2222
```

## NIST 800-53 Controls Addressed

| Control | Family | How This Role Addresses It |
|---------|--------|---------------------------|
| AC-17 | Access Control | SSH hardening restricts remote access methods, ciphers, and authentication |
| AU-2 | Audit | auditd configured to capture required audit events |
| AU-3 | Audit | Audit rules generate records with required content fields |
| AU-4 | Audit | Audit log rotation and retention configured |
| AU-12 | Audit | Audit event generation enabled for privileged operations |
| CM-6 | Configuration Mgmt | All configuration applied declaratively via Ansible (idempotent) |
| IA-5 | Identification/Auth | Password complexity, aging, and lockout policies enforced |
| SC-7 | System Comms | Firewall default-deny, kernel network hardening (no redirects, source route validation) |
| SC-13 | Cryptographic Protection | FIPS 140-2 mode enabled, FIPS crypto policy enforced system-wide |
| SI-7 | System Integrity | AIDE file integrity monitoring, kernel hardening (ASLR, ptrace restriction) |

## Handlers

- `Restart sshd` -- Triggered by sshd_config changes
- `Restart auditd` -- Triggered by auditd.conf or audit rule changes (uses `service` command because auditd cannot be restarted via systemd)
- `Reload firewalld` -- Triggered by firewall zone changes
- `Reboot required` -- Advisory message printed when FIPS mode changes require a reboot

## Platform Compatibility

- Rocky Linux 9
- AlmaLinux 9
- RHEL 9

Requires Ansible 2.15 or later. Uses FQCN for all module references.
