# Integration Test Report: wordpress

## App Summary

| Field | Value |
|-------|-------|
| Name | [wordpress](https://hub.docker.com/_/wordpress) |
| Language | PHP (Apache) |
| Complexity | High — root, port 80, writable filesystem, needs MySQL |
| Port | 80 (privileged) |
| Health Endpoint | `GET /wp-login.php` |
| Image UID | 0 (root) |
| Volumes | /var/www/html (entire web root, writable) |
| Database | MySQL (NOT PostgreSQL) — platform only has CNPG |

## Issues Found

| # | Issue | Severity | Who Hits This | Fixed? |
|---|-------|----------|---------------|--------|
| 1 | Port 80 requires NET_BIND_SERVICE capability | High | Apache, Nginx on port 80 | Workaround: containerSecurityContext.capabilities.add in HelmRelease |
| 2 | App Contract can't add capabilities | Medium | Legacy web servers | Gap: contract needs capabilities field |
| 3 | Platform only has PostgreSQL (CNPG) — WordPress needs MySQL | High | MySQL-dependent apps (WordPress, Drupal) | Gap: no MySQL service. Document "bring your own database" pattern |
| 4 | readOnlyRootFilesystem incompatible | High | PHP, WordPress, many legacy apps | Workaround: containerSecurityContext override |
| 5 | App Contract completely unusable for this app | High | Legacy apps with multiple security overrides | Had to write raw HelmRelease manually |
| 6 | No documentation for "legacy app" deployment pattern | Medium | All legacy/COTS apps | Gap: need a "deploying legacy apps" guide |
| 7 | Kyverno may block root + capabilities at admission | Medium | All security-exception apps | Needs PolicyException or exclusion |

## Verdict

**WordPress is the worst case for the platform.** The App Contract is completely unusable — you must write a raw HelmRelease with 5+ security overrides. This is expected for a legacy app, but the platform should document the pattern and provide a "legacy app" template or contract extension.

Key missing platform features for legacy apps:
1. MySQL/MariaDB database service (CNPG is PostgreSQL only)
2. Contract schema extensions for security exceptions
3. Documentation guide for "deploying legacy apps that need root/privileged ports"
