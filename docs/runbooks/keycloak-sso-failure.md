# Runbook: Keycloak SSO Failure

## Alert

- **Prometheus Alert:** `KeycloakDown` / `KeycloakRealmLoginFailures`
- **Grafana Dashboard:** Keycloak metrics dashboard
- **Firing condition:** Keycloak pod is not ready, or OIDC login failure rate exceeds threshold for more than 5 minutes

## Severity

**Critical** -- Keycloak SSO failure prevents authentication to all platform UIs (Grafana, Harbor, NeuVector). Users cannot log in to monitoring dashboards or the container registry.

## Impact

- Login to Grafana via Keycloak SSO fails (fallback to local admin account still works)
- Login to Harbor via OIDC fails (local admin account still works)
- OpenBao UI authentication via OIDC fails
- NeuVector UI authentication via OIDC fails
- New user provisioning and group membership changes are blocked
- NIST IA-2 (Identification and Authentication) compliance control is degraded

## Investigation Steps

1. Check Keycloak pod status:

```bash
kubectl get pods -n keycloak
```

2. Check Keycloak pod logs:

```bash
kubectl logs -n keycloak keycloak-0 --tail=200
```

3. Check if the Keycloak database (bundled PostgreSQL) is running:

```bash
kubectl get pods -n keycloak -l app.kubernetes.io/component=postgresql
kubectl logs -n keycloak -l app.kubernetes.io/component=postgresql --tail=100
```

4. Check the Keycloak HelmRelease:

```bash
flux get helmrelease keycloak -n keycloak
```

5. Test Keycloak health endpoint:

```bash
kubectl exec -n keycloak keycloak-0 -- curl -s http://localhost:8080/health/ready
```

6. Check the OIDC well-known endpoint:

```bash
kubectl port-forward -n keycloak svc/keycloak-http 8080:80 &
curl -s http://localhost:8080/realms/sre/.well-known/openid-configuration | jq .
```

7. Check Keycloak events for failed logins:

```bash
kubectl port-forward -n keycloak svc/keycloak-http 8080:80 &
# Get admin token
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=$(kubectl get secret keycloak -n keycloak -o jsonpath='{.data.admin-password}' | base64 -d)" \
  -d "grant_type=password" | jq -r '.access_token')

# Get recent events
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/admin/realms/sre/events?type=LOGIN_ERROR&max=20" | jq .
```

8. Verify Istio VirtualService for Keycloak:

```bash
kubectl get virtualservice -n keycloak
kubectl describe virtualservice keycloak -n keycloak
```

9. Check if the Keycloak service is accessible from other namespaces (e.g., Grafana):

```bash
kubectl run -n monitoring --rm -it --restart=Never curl-test --image=curlimages/curl:8.4.0 -- curl -s http://keycloak-http.keycloak.svc.cluster.local:80/realms/sre/.well-known/openid-configuration
```

## Resolution

### Keycloak pod not starting

1. Check pod events:

```bash
kubectl describe pod keycloak-0 -n keycloak
```

2. If the pod is in CrashLoopBackOff, check logs from the previous crash:

```bash
kubectl logs -n keycloak keycloak-0 --previous
```

3. Common causes:
   - Database connection failure (PostgreSQL not ready)
   - Out of memory
   - Configuration error after upgrade

4. If the database is not ready, restart it first:

```bash
kubectl rollout restart statefulset -n keycloak -l app.kubernetes.io/component=postgresql
```

5. Then restart Keycloak:

```bash
kubectl delete pod keycloak-0 -n keycloak
```

### OIDC token endpoint unreachable from Grafana

1. Grafana reaches Keycloak via internal service URL. Verify the service exists:

```bash
kubectl get svc keycloak-http -n keycloak
```

2. Check that the Grafana OIDC configuration points to the correct URL:

```bash
kubectl get helmrelease kube-prometheus-stack -n monitoring -o yaml | grep -A 5 "token_url"
```

The token URL should be: `http://keycloak-http.keycloak.svc.cluster.local:80/realms/sre/protocol/openid-connect/token`

3. If the URL is incorrect, update the monitoring HelmRelease values in Git

### SSO redirect loop

1. This usually indicates a mismatch between the Keycloak hostname and the redirect URL.

2. Check the Keycloak hostname configuration:

```bash
kubectl get pod keycloak-0 -n keycloak -o yaml | grep -A 2 "KC_HOSTNAME"
```

3. Verify `KC_HOSTNAME` matches the external URL used by clients (e.g., `keycloak.apps.sre.example.com`)

4. Check `KC_HOSTNAME_PORT` is set correctly (should be `443` for HTTPS via Istio gateway)

5. Verify the OIDC client redirect URIs in Keycloak match the actual application URLs

### OIDC client misconfigured

1. Access the Keycloak admin console (port-forward or via Istio gateway)
2. Navigate to the SRE realm -> Clients
3. Verify each client has correct:
   - Valid Redirect URIs
   - Web Origins
   - Client secret matches what is configured in the consuming service

4. For Grafana, the client configuration should be:

| Setting | Value |
|---------|-------|
| Client ID | grafana |
| Valid Redirect URIs | https://grafana.apps.sre.example.com/* |
| Web Origins | https://grafana.apps.sre.example.com |

### Keycloak database corruption

1. If Keycloak logs show database errors:

```bash
kubectl logs -n keycloak keycloak-0 --tail=200 | grep -i "database\|postgres\|sql"
```

2. Check PostgreSQL pod:

```bash
kubectl logs -n keycloak -l app.kubernetes.io/component=postgresql --tail=100
```

3. If the database is corrupted and persistence is disabled (lab environment), restart both:

```bash
kubectl delete pod -n keycloak --all
```

4. If persistence is enabled, restore from the most recent Velero backup of the keycloak namespace

### Emergency: bypass Keycloak for platform access

If Keycloak is completely down and you need access to Grafana:

1. Use the local admin account:
   - Username: `admin`
   - Password: `prom-operator` (or check `grafana-admin-credentials` secret)

2. For Harbor:
   - Username: `admin`
   - Password: check `harbor-core` secret (`HARBOR_ADMIN_PASSWORD` field)

3. For NeuVector:
   - Username: `admin`
   - Password: `admin` (default)

## Prevention

- Monitor Keycloak health via the metrics ServiceMonitor (enabled in the HelmRelease)
- Set alerts on login failure rate and pod restart count
- Back up the Keycloak realm configuration regularly (export via admin API)
- Test SSO login after any Keycloak or client application upgrade
- Maintain local admin credentials as a break-glass mechanism for all platform UIs
- Keep the `KC_HOSTNAME` and `KC_HOSTNAME_PORT` environment variables synchronized with the Istio gateway configuration

## Escalation

- If Keycloak is down and no local admin credentials are available: this is a P1 -- platform operators are locked out
- If user authentication data is lost (database corruption without backup): escalate to platform team lead for re-initialization of the SRE realm
- If SSO failures are intermittent: collect logs during failure windows and check for resource exhaustion or network instability
