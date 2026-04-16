# OpenBao Secret Seeding Runbook

## When to use this runbook

Run through this procedure **before merging** any change that converts a plaintext
`kind: Secret` manifest into an `ExternalSecret`. If the target path in OpenBao is
not populated, the ExternalSecret will stay in `SecretSyncedError` and any
workload that depends on the resulting K8s `Secret` will fail to start.

## Paths that must be seeded for the credential-remediation change

The secret-remediation commit moved the following plaintext secrets from Git to
OpenBao-backed ExternalSecrets. Seed each path **before** merging to `main`,
otherwise Flux will deploy ExternalSecrets pointing at empty OpenBao keys.

| OpenBao path | Keys | Consumer | Existing value (from MEMORY.md) |
|--------------|------|----------|----------------------------------|
| `sre/platform/oauth2-proxy` | `client-id`, `client-secret`, `cookie-secret` | `oauth2-proxy` Deployment | `client-secret=TtZuIm3Igj088TtY4cw3xfXf5U1I8f9z`, `cookie-secret` = 32-byte random base64 (regenerate), `client-id=oauth2-proxy` |
| `sre/platform/openbao-oidc` | `client-secret` | OpenBao OIDC (Keycloak login on OpenBao UI) | `LMEeknLI2RKfPwzhIPhUZlFk4PUEexb9` |
| `sre/platform/grafana-oidc` | `client-secret` | Grafana SSO | `grafana-client-secret` |
| `sre/platform/sre-admin` | `username`, `password` | Dashboard `/api/credentials` endpoint | `sre-admin` / `SreAdmin123!` |
| `sre/platform/harbor-admin` | `username`, `password` | Dashboard Harbor breakglass + CVE scan | `admin` / `Harbor12345` |
| `sre/demo-fullstack/postgres` | `username`, `password`, `database` | `demo-fullstack` backend | Pick new values — this is a demo app, no prior production value |

> **Rotate before seeding.** Because all six values leaked into Git history, treat
> them as burned. Generate new secrets (e.g., `openssl rand -base64 32`) and
> also rotate the corresponding client secrets in Keycloak for the three OIDC
> clients. See [Rotate in Keycloak](#rotate-in-keycloak) below.

## Procedure — seeding via the Dashboard UI

The platform Dashboard's OpenBao panel is the supported path (no kubectl/SSH
required). Steps:

1. Open the Dashboard at `https://dashboard.apps.sre.example.com/`.
2. Sign in as `sre-admin`.
3. Navigate to the **Security** tab → **OpenBao** panel.
4. For each path in the table above:
   - Click **Write secret**.
   - Path: e.g. `sre/platform/oauth2-proxy`.
   - Add each key-value pair from the table.
   - Save.
5. After all paths are seeded, navigate to **Operations** → **ExternalSecret status**
   and confirm that each of the following is `SecretSynced: True`:
   - `oauth2-proxy-credentials` in `oauth2-proxy` namespace
   - `openbao-oidc-client` in `openbao` namespace
   - `grafana-oidc` in `monitoring` namespace
   - `sre-admin-creds` in `sre-dashboard` namespace
   - `harbor-admin-creds` in `sre-dashboard` namespace
   - `demo-db-credentials` + `demo-db-url` in `demo-fullstack` namespace

## Rotate in Keycloak

Three of the six values are OIDC client secrets configured in Keycloak's `sre`
realm. After you write the new value to OpenBao, also update Keycloak so the
two sides match:

1. Open Keycloak at `https://keycloak.apps.sre.example.com/`.
2. Sign in as the master-realm `admin`.
3. Switch to the `sre` realm.
4. Clients → select the client (`oauth2-proxy`, `openbao`, `grafana`) → **Credentials** tab.
5. Click **Regenerate** to mint a new client secret, or **paste** the value you
   just wrote to OpenBao.
6. Save.

The `sre-dashboard` and `neuvector` OIDC clients were **not** changed by this
remediation and do not need rotation right now.

## Procedure — seeding via CLI (operator override only)

Only use this path if the Dashboard OpenBao panel is unavailable. Requires the
OpenBao root token from the `openbao-init-keys` secret.

```bash
export BAO_ADDR="https://openbao.apps.sre.example.com"
export BAO_TOKEN="$(kubectl -n openbao get secret openbao-init-keys -o jsonpath='{.data.root_token}' | base64 -d)"

bao kv put sre/platform/oauth2-proxy \
  client-id="oauth2-proxy" \
  client-secret="$(openssl rand -base64 32)" \
  cookie-secret="$(openssl rand -base64 32)"

bao kv put sre/platform/openbao-oidc client-secret="$(openssl rand -base64 32)"
bao kv put sre/platform/grafana-oidc client-secret="$(openssl rand -base64 32)"

bao kv put sre/platform/sre-admin username="sre-admin" password="$(openssl rand -base64 24)"
bao kv put sre/platform/harbor-admin username="admin" password="$(openssl rand -base64 24)"

bao kv put sre/demo-fullstack/postgres \
  username="demo" \
  password="$(openssl rand -base64 24)" \
  database="demo_fullstack"
```

Then paste each generated client-secret back into the matching Keycloak client as
described in [Rotate in Keycloak](#rotate-in-keycloak).

## Post-merge verification

After Flux reconciles:

```
flux get kustomizations -A | grep -v True
flux get helmreleases -A | grep -v True
kubectl get externalsecrets -A | grep -v SecretSynced
```

All three should return only the header line (no non-Ready entries).

If any ExternalSecret is stuck, see
[external-secrets-sync-failure.md](external-secrets-sync-failure.md).

## Dashboard image rebuild

The dashboard `server.js` was also changed in this remediation. Those changes
only take effect after the dashboard container image is rebuilt and pushed to
Harbor. Run from a workstation that has Docker + push access to Harbor:

```bash
cd apps/dashboard
./build-and-deploy.sh
```

This builds a new image, pushes to `harbor.apps.sre.example.com/platform/sre-dashboard`
with a new tag, and bumps the HelmRelease image tag in Git so Flux rolls the
deployment.
