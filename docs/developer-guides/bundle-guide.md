# Deployment Bundle Guide

## Overview

The SRE platform runs your applications in a secure, monitored, government-compliant environment. You do not need to understand the underlying infrastructure. You just need to package your application so the platform knows how to run it.

To deploy an application, you create a **deployment bundle** -- a `.tar.gz` file containing your container image(s) and a manifest (`bundle.yaml`) that describes how your app should run. Think of the manifest as an order form: you fill in what your app needs (name, port, resources, services) and the platform handles the rest (security, networking, monitoring, certificates).

Your platform operator uploads the bundle, automated security scanning runs against your image, a reviewer approves the results, and your application is deployed into its own isolated environment with HTTPS, logging, and monitoring configured automatically.

There are three ways to create a bundle:

- **Browser tool** -- visual form, no command line required
- **CLI tool** -- interactive shell script, good for automation
- **Manual** -- copy a template and assemble the archive yourself

---

## Before You Start

Make sure you have the following ready before building a bundle.

**Requirements:**

- [ ] Docker or Podman installed on your machine (needed to export container images as `.tar` files)
- [ ] Your application builds and runs locally in a container
- [ ] You know what port your application listens on (e.g., 3000, 8080, 8443)
- [ ] You know what backing services your app needs (database, cache, SSO, persistent storage)
- [ ] You have received the SRE Developer Kit (the folder containing `bundle-builder.html`, `sre-bundle.sh`, and `bundle.yaml.template`)

**Do not have Docker?** You can still create a bundle if you can obtain a `.tar` file of your container image by other means. Most CI systems (GitHub Actions, GitLab CI, Jenkins) can produce image archives as build artifacts. You can also pull and save images from a registry on a machine that does have Docker, then transfer the `.tar` file to your workstation.

---

## Path A: Bundle Builder (Browser)

The fastest way to create a bundle. No command line required.

1. Open `bundle-builder.html` from the Developer Kit in any web browser. It runs entirely in your browser -- nothing is uploaded to a server.
2. Fill in the **Application Details** section: name, version, team, and description.
3. Select your **application type** (web app, API service, or background worker).
4. Click **Upload Image** and select the `.tar` file of your container image. If you have not created one yet, run `docker save myapp:v1.0.0 -o myapp.tar` in your terminal first.
5. Configure **runtime settings**: port, resource size, health check paths.
6. Enable any **services** your app needs (database, Redis, SSO, persistent storage).
7. Add **environment variables** and **secret references** if needed.
8. Click **Generate Bundle**. A `.bundle.tar.gz` file will download to your machine.

Send the generated file to your platform operator.

---

## Path B: CLI Tool

For developers who prefer the terminal or need to automate bundle creation.

**Interactive mode:**

```bash
bash sre-bundle.sh
```

The script walks you through the same steps as the browser tool. It detects your local Docker images and can save them automatically -- you do not need to run `docker save` yourself.

**Automated mode (for CI pipelines):**

```bash
bash sre-bundle.sh --from-manifest bundle.yaml
```

In this mode the script reads a pre-filled `bundle.yaml`, saves the referenced container image, and produces the `.bundle.tar.gz` without any interactive prompts. This is useful for integrating bundle creation into your existing build pipeline.

**Output:** A `.bundle.tar.gz` file in your current directory, ready to hand off to your platform operator.

---

## Path C: Manual

If you want full control or cannot use the other tools.

1. Copy `bundle.yaml.template` from the Developer Kit to a new file called `bundle.yaml`.
2. Open `bundle.yaml` in a text editor and fill in your values. The template contains comments explaining every field. At minimum, fill in `name`, `version`, `team`, `description`, `image.file`, `image.ref`, and `port`.
3. Export your container image:

```bash
docker save myapp:v1.0.0 -o myapp.tar
```

4. Assemble the bundle:

```bash
mkdir my-bundle && cd my-bundle
cp /path/to/bundle.yaml .
mkdir images
docker save myapp:v1.0.0 -o images/myapp.tar
tar czf myapp-v1.0.0.bundle.tar.gz bundle.yaml images/
```

5. Verify the archive contains the right files:

```bash
tar tzf myapp-v1.0.0.bundle.tar.gz
# Expected output:
# bundle.yaml
# images/myapp.tar
```

Send the `.bundle.tar.gz` to your platform operator.

---

## Health Checks

Your application **must** respond to HTTP health check requests. The platform uses these to know whether your app is running correctly and whether it should receive traffic.

**Liveness check** -- "Is your app alive?" The platform sends an HTTP GET request to this path periodically. If it gets a 200 response, everything is fine. If it fails repeatedly, the platform restarts your container.

**Readiness check** -- "Is your app ready for traffic?" Same mechanism, but failure means your app temporarily stops receiving requests (without being restarted). Useful during startup while your app connects to a database or loads configuration.

The default paths are `/healthz` (liveness) and `/readyz` (readiness). You can set them to any path in your `bundle.yaml`. If your app does not have dedicated health endpoints, add them. Here are minimal examples:

**Node.js (Express):**
```javascript
app.get('/healthz', (req, res) => res.sendStatus(200));
app.get('/readyz', (req, res) => res.sendStatus(200));
```

**Python (Flask):**
```python
@app.route('/healthz')
def health():
    return 'ok', 200

@app.route('/readyz')
def ready():
    return 'ok', 200
```

**Go:**
```go
http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
})
http.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
})
```

**Java (Spring Boot):**
```java
@GetMapping("/healthz")
public ResponseEntity<String> health() {
    return ResponseEntity.ok("ok");
}

@GetMapping("/readyz")
public ResponseEntity<String> ready() {
    return ResponseEntity.ok("ok");
}
```

If your readiness check should verify downstream dependencies (database connectivity, cache availability), add that logic to the `/readyz` handler. Keep `/healthz` simple -- it should only confirm the process is running.

---

## Environment Variables and Secrets

You can pass configuration to your application through environment variables.

**Plain values** go directly in `bundle.yaml` under the `env` section:

```yaml
env:
  LOG_LEVEL: "info"
  MAX_CONNECTIONS: "100"
  FEATURE_NEW_UI: "true"
```

**Secrets** (passwords, API keys, tokens, connection strings) must never appear in the bundle file. Instead, list the secret names your app needs under the `secrets` section:

```yaml
secrets:
  - DATABASE_PASSWORD
  - API_KEY
  - JWT_SECRET
```

Your platform operator provisions the actual secret values in the platform's secure vault before deploying your bundle. You just reference the name -- at runtime, the secret value is injected into your container as an environment variable with the same name.

Coordinate secret names with your operator ahead of time so they can create the entries before your deployment.

**Never put real passwords, API keys, tokens, or connection strings in `bundle.yaml` or anywhere in the bundle archive.** The bundle may be stored, transmitted, or logged in ways that are not appropriate for sensitive data.

---

## What Happens After You Submit

Once you hand the `.bundle.tar.gz` to your platform operator, the following happens:

1. **Upload** -- The operator uploads your bundle to the platform through the deployment wizard.
2. **Image import** -- Your container image is extracted and loaded into the platform's internal registry.
3. **Vulnerability scan** -- An automated scanner checks your image for known security vulnerabilities (CVEs) and generates a software inventory (SBOM) listing every package and library in your image.
4. **Static analysis** -- If you included source code in the bundle, automated static analysis scans for common security issues (SQL injection, cross-site scripting, hardcoded secrets).
5. **Security review** -- A security reviewer examines the scan results. They may approve, request changes, or ask questions.
6. **Deployment** -- Once approved, your application is deployed into its own isolated environment with HTTPS, monitoring, and logging enabled automatically.
7. **Access** -- You receive a URL for your application (if external access was enabled) and access to monitoring dashboards and log viewers.

The process typically takes one to two hours, depending on the review queue. Your operator can give you a more specific timeline.

---

## Troubleshooting

**"My app crashes shortly after deployment."**
Check that your health check endpoints return a 200 status code. If the liveness check fails, the platform restarts your container in a loop. Also verify that your resource limits are not too small -- if your app needs more memory than the limit allows, it will be terminated.

**"I need to call an external API or service outside the platform."**
By default, outbound traffic from your app is restricted. Contact your platform operator and provide the hostname and port of the external service. They will configure an exception for your namespace.

**"I do not have source code (vendor or commercial software)."**
Set `source.included: false` in your `bundle.yaml`. The platform will still scan the container image for vulnerabilities but will skip static analysis.

**"My app uses a custom port."**
Set the `runtime.port` field in `bundle.yaml` to whatever port your application listens on.

**"My app runs on port 80 or 443."**
The platform requires applications to run as a non-root user, which means you cannot bind to ports below 1024. Reconfigure your application to listen on a higher port such as 8080 or 8443. The platform handles TLS termination and port mapping externally -- your users will still access your app over standard HTTPS (port 443).

**"I need more resources than the 'large' preset."**
Contact your platform team. They can create a custom resource allocation for your application.

**"The bundle file is too large to email."**
Use a secure file transfer method: shared network drive, SFTP, or whatever secure transfer tool your organization provides. Do not use consumer file-sharing services for bundles containing sensitive or government-related software.

**"My image is too large to export."**
Consider using a smaller base image. Alpine-based and distroless images are typically 10-100x smaller than full OS images. If reducing the image size is not feasible, coordinate with your operator on an alternative transfer method.
