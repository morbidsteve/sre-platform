# Getting Started: Deploy SRE to Proxmox VE

This guide walks you through deploying the full Secure Runtime Environment platform to a Proxmox VE hypervisor, from an empty Proxmox node to a running, hardened Kubernetes cluster with all platform services.

**Audience:** Platform engineers and operators deploying SRE infrastructure.

> **Want the fast path?** Run the automated quickstart script instead of following the manual steps below:
> ```bash
> ./scripts/quickstart-proxmox.sh
> ```
> It prompts for your Proxmox details, then handles Packer, OpenTofu, Ansible, kubeconfig retrieval, and Flux bootstrap in a single run. See [Quickstart Script](#quickstart-script) for details.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Configure Proxmox](#step-1-configure-proxmox)
4. [Step 2: Build the VM Template with Packer](#step-2-build-the-vm-template-with-packer)
5. [Step 3: Provision VMs with OpenTofu](#step-3-provision-vms-with-opentofu)
6. [Step 4: Harden OS and Install RKE2 with Ansible](#step-4-harden-os-and-install-rke2-with-ansible)
7. [Step 5: Bootstrap Flux CD](#step-5-bootstrap-flux-cd)
8. [Step 6: Verify the Platform](#step-6-verify-the-platform)
9. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The deployment pipeline for Proxmox follows this flow:

```
Your Workstation                         Proxmox VE Host
┌──────────────────┐                    ┌──────────────────────────────┐
│  Packer          │───builds───────────│  VM Template (Rocky Linux 9) │
│  OpenTofu        │───clones VMs───────│  CP Node(s) + Worker Node(s) │
│  Ansible         │───configures───────│  RKE2 Cluster (hardened)     │
│  Flux CLI        │───bootstraps───────│  Platform Services (GitOps)  │
└──────────────────┘                    └──────────────────────────────┘
```

1. **Packer** builds an immutable Rocky Linux 9 VM template on Proxmox with DISA STIG hardening and RKE2 pre-staged
2. **OpenTofu** clones that template into control plane and worker VMs
3. **Ansible** applies final OS hardening and bootstraps the RKE2 cluster
4. **Flux CD** deploys all platform services (Istio, Kyverno, monitoring, logging, secrets, etc.) from Git

---

## Prerequisites

### Proxmox VE Host Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Proxmox VE version | 8.0 | 8.2+ |
| CPU cores (total) | 12 | 24+ |
| RAM (total) | 32 GB | 64 GB+ |
| Storage | 200 GB (SSD) | 500 GB+ (NVMe) |
| Network | 1 GbE | 10 GbE |

A minimal lab deployment (1 control plane + 2 workers) uses approximately 12 cores, 24 GB RAM, and 150 GB disk.

### Local Workstation Tools

Install these tools on your local machine (macOS, Linux, or WSL2 on Windows).

#### Required tools

**OpenTofu** (infrastructure provisioning):
```bash
# macOS
brew install opentofu

# Linux (Debian/Ubuntu)
curl -fsSL https://get.opentofu.org/install-opentofu.sh | sh -s -- --install-method deb

# Linux (RHEL/Rocky)
curl -fsSL https://get.opentofu.org/install-opentofu.sh | sh -s -- --install-method rpm

# Verify
tofu version
```

**Packer** (VM image builds):
```bash
# macOS
brew install packer

# Linux
curl -fsSL https://releases.hashicorp.com/packer/1.10.3/packer_1.10.3_linux_amd64.zip -o packer.zip
unzip packer.zip && sudo mv packer /usr/local/bin/
rm packer.zip

# Verify
packer version
```

**Ansible** (OS hardening and RKE2 installation):
```bash
# macOS
brew install ansible

# Linux (pip - works everywhere)
pip3 install ansible ansible-lint

# Install required collections
ansible-galaxy collection install ansible.posix community.general

# Verify
ansible --version
```

**kubectl** (Kubernetes CLI):
```bash
# macOS
brew install kubectl

# Linux
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/

# Verify
kubectl version --client
```

**Helm** (chart management):
```bash
# macOS
brew install helm

# Linux
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify
helm version
```

**Flux CLI** (GitOps management):
```bash
# macOS
brew install fluxcd/tap/flux

# Linux
curl -s https://fluxcd.io/install.sh | bash

# Verify
flux version --client
```

#### Optional but recommended

**Task** (command runner, replaces Make):
```bash
# macOS
brew install go-task

# Linux
sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

# Verify
task --version
```

**jq** (JSON processing, used in verification scripts):
```bash
# macOS
brew install jq

# Linux (Debian/Ubuntu)
sudo apt-get install jq

# Linux (RHEL/Rocky)
sudo dnf install jq
```

### SSH Key Pair

You need an SSH key pair for Ansible to connect to the provisioned VMs. If you do not have one:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/sre-proxmox-lab -N "" -C "sre-admin@proxmox-lab"
```

This creates `~/.ssh/sre-proxmox-lab` (private key) and `~/.ssh/sre-proxmox-lab.pub` (public key).

### Git Repository

Clone the SRE platform repository:

```bash
git clone https://github.com/morbidsteve/sre-platform.git
cd sre-platform
```

---

## Step 1: Configure Proxmox

### 1.1 Upload the Rocky Linux 9 ISO

Download the Rocky Linux 9 minimal ISO and upload it to your Proxmox storage:

```bash
# On the Proxmox host (via SSH or shell)
cd /var/lib/vz/template/iso/
wget https://download.rockylinux.org/pub/rocky/9/isos/x86_64/Rocky-9.5-x86_64-minimal.iso
```

Or upload via the Proxmox web UI: **Datacenter > Storage > local > ISO Images > Upload**.

### 1.2 Create a Packer API User

Packer needs API access to create VMs. Create a dedicated user and token:

```bash
# On the Proxmox host
pveum user add packer@pve --comment "Packer image builder"
pveum aclmod / -user packer@pve -role PVEVMAdmin
pveum user token add packer@pve packer-token --privsep=0
```

Save the token output. It looks like: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. You cannot retrieve it again.

### 1.3 Verify storage pool

Confirm you have a storage pool for VM disks. The default `local-lvm` works for most setups:

```bash
# On the Proxmox host
pvesm status
```

Note the storage pool name (e.g., `local-lvm`, `ceph-pool`, `zfs-pool`). You will use this in the next steps.

### 1.4 Note your network bridge

The default network bridge is `vmbr0`. If you use VLANs or a custom bridge, note the name:

```bash
# On the Proxmox host
ip link show type bridge
```

---

## Step 2: Build the VM Template with Packer

Packer creates a reusable, hardened VM template that OpenTofu will clone for each node.

### 2.1 Initialize Packer plugins

```bash
cd infrastructure/packer/rocky-linux-9-proxmox
packer init .
```

### 2.2 Validate the template

Replace the variable values with your Proxmox details:

```bash
packer validate \
  -var "proxmox_url=https://YOUR_PROXMOX_HOST:8006/api2/json" \
  -var "proxmox_username=packer@pve!packer-token" \
  -var "proxmox_token=YOUR_PACKER_TOKEN" \
  -var "proxmox_node=YOUR_NODE_NAME" \
  -var "iso_file=local:iso/Rocky-9.5-x86_64-minimal.iso" \
  -var "vm_storage_pool=local-lvm" \
  .
```

If your Proxmox uses a self-signed TLS certificate, add:
```bash
  -var "proxmox_insecure_skip_tls_verify=true"
```

### 2.3 Build the template

```bash
packer build \
  -var "proxmox_url=https://YOUR_PROXMOX_HOST:8006/api2/json" \
  -var "proxmox_username=packer@pve!packer-token" \
  -var "proxmox_token=YOUR_PACKER_TOKEN" \
  -var "proxmox_node=YOUR_NODE_NAME" \
  -var "iso_file=local:iso/Rocky-9.5-x86_64-minimal.iso" \
  -var "vm_storage_pool=local-lvm" \
  -var "rke2_version=v1.28.6+rke2r1" \
  -var "image_version=1.0.0" \
  .
```

This takes 15-30 minutes. Packer will:
1. Create a VM and boot Rocky Linux 9 from the ISO
2. Run a kickstart installation
3. Apply DISA STIG hardening via the os-hardening Ansible role
4. Pre-install RKE2 binaries and air-gap container images
5. Convert the VM to a template

When complete, you will see a template named `sre-rocky9-rke2-1.0.0` in your Proxmox UI.

### 2.4 Verify the template

```bash
# On the Proxmox host, or via API
pvesh get /nodes/YOUR_NODE_NAME/qemu --output-format json | jq '.[] | select(.template==1) | .name'
```

You should see `sre-rocky9-rke2-1.0.0` in the output.

---

## Step 3: Provision VMs with OpenTofu

OpenTofu clones the Packer template into your cluster nodes.

### 3.1 Configure the environment

```bash
cd infrastructure/tofu/environments/proxmox-lab
```

Edit `terraform.tfvars` with your Proxmox details:

```hcl
# Proxmox connection
proxmox_endpoint  = "https://YOUR_PROXMOX_HOST:8006"
proxmox_api_token = "packer@pve!packer-token=YOUR_PACKER_TOKEN"
proxmox_node      = "YOUR_NODE_NAME"
proxmox_insecure  = true  # Set to false if you have valid TLS certs

# VM template (must match what Packer built)
template_name = "sre-rocky9-rke2-1.0.0"
storage_pool  = "local-lvm"

# Cluster sizing
server_count  = 1    # Control plane nodes (use 3 for HA)
agent_count   = 2    # Worker nodes

# Node resources
server_cores  = 4
server_memory = 8192   # MB
agent_cores   = 4
agent_memory  = 8192   # MB

# Networking
network_bridge = "vmbr0"
ip_config      = "dhcp"   # Or use static IPs (see below)

# SSH
ssh_public_key = "ssh-ed25519 AAAA... sre-admin@proxmox-lab"
```

Copy your SSH public key value from `~/.ssh/sre-proxmox-lab.pub`.

#### Static IP configuration (recommended for production)

For a stable cluster, use static IPs instead of DHCP:

```hcl
ip_config       = "192.168.1.0/24,gw=192.168.1.1"
server_ip_start = "192.168.1.10"
agent_ip_start  = "192.168.1.20"
nameserver      = "192.168.1.1"
search_domain   = "sre.local"
```

### 3.2 Initialize and plan

```bash
tofu init
tofu plan
```

Review the plan output. You should see resources for:
- Cloud-init user data file
- 1 server VM (control plane)
- 2 agent VMs (workers)

### 3.3 Apply

```bash
tofu apply
```

Type `yes` when prompted. OpenTofu will clone the template and start the VMs. This takes 2-5 minutes.

### 3.4 Note the output IPs

```bash
tofu output
```

You will see:
```
api_server_endpoint = "https://192.168.1.10:6443"
server_ips          = ["192.168.1.10"]
agent_ips           = ["192.168.1.20", "192.168.1.21"]
```

Save these IPs -- you need them for the Ansible inventory.

### 3.5 Verify SSH access

```bash
ssh -i ~/.ssh/sre-proxmox-lab sre-admin@192.168.1.10
```

You should log in without a password prompt. Type `exit` to disconnect.

---

## Step 4: Harden OS and Install RKE2 with Ansible

Ansible applies final hardening and bootstraps the RKE2 cluster.

### 4.1 Update the inventory

Edit `infrastructure/ansible/inventory/proxmox-lab/hosts.yml` with the IPs from the OpenTofu output:

```yaml
---
all:
  children:
    control_plane:
      hosts:
        cp-1:
          ansible_host: 192.168.1.10    # From tofu output server_ips
    workers:
      hosts:
        worker-1:
          ansible_host: 192.168.1.20    # From tofu output agent_ips[0]
        worker-2:
          ansible_host: 192.168.1.21    # From tofu output agent_ips[1]
  vars:
    ansible_user: sre-admin
    ansible_ssh_private_key_file: "~/.ssh/sre-proxmox-lab"
```

### 4.2 Test connectivity

```bash
cd infrastructure/ansible
ansible all -i inventory/proxmox-lab/hosts.yml -m ping
```

All hosts should return `SUCCESS`.

### 4.3 Run the full playbook

```bash
ansible-playbook playbooks/site.yml -i inventory/proxmox-lab/hosts.yml
```

This runs three stages:
1. **OS hardening** -- Applies DISA STIG configuration (SSH, auditd, sysctl, filesystem, PAM, FIPS)
2. **RKE2 server install** -- Starts RKE2 on the control plane node(s)
3. **RKE2 agent install** -- Joins worker nodes to the cluster

This takes 10-20 minutes depending on your hardware.

### 4.4 Retrieve the kubeconfig

```bash
ssh -i ~/.ssh/sre-proxmox-lab sre-admin@192.168.1.10 \
  "sudo cat /etc/rancher/rke2/rke2.yaml" > ~/.kube/sre-proxmox-lab.yaml

# Update the server address from 127.0.0.1 to the actual IP
sed -i.bak 's/127.0.0.1/192.168.1.10/g' ~/.kube/sre-proxmox-lab.yaml

export KUBECONFIG=~/.kube/sre-proxmox-lab.yaml
```

### 4.5 Verify the cluster

```bash
kubectl get nodes
```

Expected output:
```
NAME       STATUS   ROLES                       AGE   VERSION
cp-1       Ready    control-plane,etcd,master   5m    v1.28.6+rke2r1
worker-1   Ready    <none>                      3m    v1.28.6+rke2r1
worker-2   Ready    <none>                      3m    v1.28.6+rke2r1
```

All nodes should show `Ready`. If a node shows `NotReady`, wait a minute and check again -- it may still be initializing.

```bash
# Verify RKE2 system pods are running
kubectl get pods -n kube-system
```

You should see pods for `etcd`, `kube-apiserver`, `kube-controller-manager`, `kube-scheduler`, `canal`, `coredns`, and `rke2-ingress-nginx`.

---

## Step 5: Bootstrap Flux CD

Flux CD deploys and manages all platform services from the Git repository.

### 5.1 Prerequisites check

```bash
flux check --pre
```

This verifies your cluster meets Flux requirements. All checks should pass.

### 5.2 Bootstrap Flux

```bash
flux bootstrap github \
  --owner=morbidsteve \
  --repository=sre-platform \
  --path=platform/flux-system \
  --branch=main \
  --personal
```

You will be prompted for a GitHub personal access token with `repo` scope. Flux will:
1. Install its controllers onto the cluster
2. Create a GitRepository resource pointing to the sre-platform repo
3. Begin reconciling all platform services defined in `platform/`

This takes 2-3 minutes for the Flux controllers, then 10-20 minutes for all platform services to deploy.

### 5.3 Monitor the bootstrap

```bash
# Watch Flux install its components
flux get kustomizations --watch

# Check all HelmReleases
flux get helmreleases -A
```

Platform services deploy in dependency order: Istio first, then cert-manager, Kyverno, monitoring, logging, and so on.

---

## Step 6: Verify the Platform

### 6.1 Check all platform services

```bash
# All Flux kustomizations should be "Ready"
flux get kustomizations -A

# All HelmReleases should be "Ready"
flux get helmreleases -A

# All pods across platform namespaces
kubectl get pods -A | grep -v "kube-system\|Running\|Completed"
```

The last command shows any pods NOT in Running or Completed state. Ideally, nothing is returned.

### 6.2 Verify core services

```bash
# Istio
kubectl get pods -n istio-system
kubectl get peerauthentication -A  # Should show STRICT mTLS

# Kyverno
kubectl get pods -n kyverno
kubectl get clusterpolicy  # Should list all SRE policies

# Monitoring
kubectl get pods -n monitoring
kubectl get servicemonitor -A  # Should show monitors for all services

# Logging
kubectl get pods -n logging
```

### 6.3 Access Grafana (port-forward for initial setup)

```bash
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
```

Open `http://localhost:3000` in your browser. Default credentials: `admin` / `prom-operator` (change immediately).

### 6.4 Run validation

If you have `task` installed:

```bash
task validate
```

Or manually:

```bash
# Lint all manifests
helm lint apps/templates/sre-web-app/
helm lint apps/templates/sre-worker/
helm lint apps/templates/sre-cronjob/

# Check Kyverno policy compliance
kubectl get clusterpolicyreport -o wide
kubectl get policyreport -A -o wide
```

---

## Troubleshooting

### Packer build fails to connect to Proxmox

**Symptom:** `error creating virtual machine: 500 Internal Server Error`

- Verify your API token has `PVEVMAdmin` role: `pveum user permissions packer@pve --path /`
- Verify the token was created with `--privsep=0`
- Check the Proxmox URL includes `/api2/json` at the end
- If using self-signed certs, ensure `proxmox_insecure_skip_tls_verify = true`

### Packer build hangs at "Waiting for SSH"

- The VM may not be getting an IP address. Check the Proxmox console for the VM
- Verify the ISO path is correct: `pvesh get /nodes/YOUR_NODE/storage/local/content --content iso`
- The kickstart file may have an issue. Check the VM console for errors during OS installation

### OpenTofu fails to clone template

**Symptom:** `error cloning VM: template not found`

- Verify the template name matches exactly: `pvesh get /nodes/YOUR_NODE/qemu --output-format json | jq '.[].name'`
- Ensure the template VM ID exists and is marked as a template

### Ansible cannot connect to VMs

**Symptom:** `UNREACHABLE! => {"msg": "Failed to connect to the host via ssh"}`

- Verify the VMs are running in Proxmox UI
- Wait 1-2 minutes after `tofu apply` for cloud-init to complete
- Verify SSH key: `ssh -i ~/.ssh/sre-proxmox-lab -v sre-admin@IP_ADDRESS`
- Check that the QEMU guest agent is reporting the IP: in Proxmox UI, select the VM and check the **Summary** tab for the IP address

### RKE2 nodes not joining the cluster

**Symptom:** Worker nodes show `NotReady` or do not appear in `kubectl get nodes`

- Check RKE2 agent logs: `ssh sre-admin@WORKER_IP "sudo journalctl -u rke2-agent -f"`
- Verify ports 6443 and 9345 are reachable from workers to the server: `ssh sre-admin@WORKER_IP "curl -k https://SERVER_IP:9345/cacerts"`
- If using static IPs, verify all nodes can resolve each other

### Flux kustomizations stuck at "Not Ready"

- Check Flux logs: `flux logs --all-namespaces`
- A common cause is a dependency not being ready yet. Wait 5-10 minutes for the dependency chain to resolve
- Force reconciliation: `flux reconcile kustomization sre-core --with-source`

### Pods stuck in ImagePullBackOff

- If Harbor is not yet deployed, platform images may fail to pull. This is expected during initial bootstrap
- For upstream images (Istio, Prometheus, etc.), ensure the cluster has outbound internet access on port 443

---

## Quickstart Script

Instead of following the manual steps above, you can run the automated quickstart script:

```bash
./scripts/quickstart-proxmox.sh
```

The script prompts for your Proxmox connection details, then automates the entire pipeline:

1. Checks all required tools are installed
2. Prompts for Proxmox URL, node name, API token, ISO path, storage pool, and cluster sizing
3. Generates an SSH key pair (if you do not have one)
4. Runs Packer to build the hardened VM template
5. Runs OpenTofu to provision cluster VMs
6. Extracts the VM IPs from OpenTofu output and generates the Ansible inventory automatically
7. Waits for VMs to finish cloud-init and accept SSH
8. Runs Ansible to harden the OS and install RKE2
9. Retrieves the kubeconfig and configures it for kubectl
10. Optionally bootstraps Flux CD for GitOps

### Skipping steps

If you already have a Packer template built, skip the Packer step:
```bash
SKIP_PACKER=1 ./scripts/quickstart-proxmox.sh
```

To skip Flux bootstrap (deploy only the bare cluster):
```bash
SKIP_FLUX=1 ./scripts/quickstart-proxmox.sh
```

### Pre-setting values via environment variables

To skip prompts entirely (useful for CI or re-runs), export the values before running:

```bash
export PROXMOX_URL="https://192.168.1.100:8006"
export PROXMOX_NODE="pve"
export PROXMOX_USER="packer@pve!packer-token"
export PROXMOX_TOKEN="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export PROXMOX_ISO="local:iso/Rocky-9.5-x86_64-minimal.iso"
export PROXMOX_STORAGE="local-lvm"
export PROXMOX_BRIDGE="vmbr0"
export SSH_KEY_PATH="$HOME/.ssh/sre-proxmox-lab"
export SERVER_COUNT=1
export AGENT_COUNT=2

./scripts/quickstart-proxmox.sh
```

---

## Next Steps

Your SRE platform is now running on Proxmox. Here is what to do next:

1. **Onboard your first team** -- Follow the [Onboarding Guide](onboarding-guide.md) to create a tenant namespace
2. **Deploy an application** -- Follow the [Developer Getting Started Guide](getting-started-developer.md) to deploy your first app
3. **Set up SSO** -- Configure Keycloak for OIDC authentication to Grafana, Harbor, and kubectl
4. **Configure alerting** -- Set up AlertManager receivers in the monitoring stack for Slack, email, or PagerDuty
5. **Review operations** -- Read the [Operator Guide](operator-guide.md) for day-2 operations procedures

### High Availability (Production)

For production deployments, change these settings:

```hcl
# terraform.tfvars
server_count  = 3      # 3 control plane nodes for etcd quorum
agent_count   = 3      # 3+ workers for workload distribution
server_memory = 16384  # 16 GB per server
agent_memory  = 16384  # 16 GB per worker
```

You will also need a load balancer in front of the API server. See the [Proxmox module README](../infrastructure/tofu/modules/proxmox/README.md#high-availability-notes) for options (keepalived VIP, HAProxy, or external LB).
