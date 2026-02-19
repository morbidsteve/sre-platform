# Ansible Inventory

Per-environment inventory files defining target hosts and group variables.

## Structure

Each environment directory contains:

- `hosts.yml` — Host inventory with groups: `control_plane`, `workers`
- `group_vars/all.yml` — Variables shared across all hosts
- `group_vars/control_plane.yml` — Control plane-specific variables
- `group_vars/workers.yml` — Worker node-specific variables

## Sensitive Data

Use `ansible-vault` for any files containing secrets:

```bash
ansible-vault encrypt inventory/production/group_vars/all/vault.yml
```

Never commit plaintext secrets to this repository.
