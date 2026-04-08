# Deploy Your App to SRE

You have a Docker image. Here's how to get it running on the platform.

## What You Need

- Your app as a Docker image (e.g., `myapp:v1.0.0`)
- 5 minutes to fill out a form

That's it. You don't need cluster access, command-line tools, or any Kubernetes knowledge.

## The 3-Step Process

### Step 1: Package your app into a bundle

A "bundle" is just your Docker image plus a short config file called `bundle.yaml`. The config file tells the platform what your app needs -- the port it listens on, how much memory, whether it needs a database, etc.

Here's the simplest possible `bundle.yaml`:

```yaml
apiVersion: sre.io/v1alpha1
kind: DeploymentBundle
metadata:
  name: my-app
  version: "1.0.0"
  team: team-alpha
spec:
  app:
    image: images/my-app.tar
    port: 8080
    resources: small
    ingress: my-app.apps.sre.example.com
```

The easiest way to create one: open **`bundle-builder.html`** in your browser and fill out the form. It generates the bundle for you.

### Step 2: Submit through the security pipeline

Upload your bundle through the SRE Dashboard. The platform automatically scans it for:

- Known vulnerabilities in your image layers
- Secrets or credentials accidentally baked into the image
- Compliance with platform security standards

Scanning takes **2-5 minutes**. You can watch the progress in the dashboard.

### Step 3: Wait for approval, then it's live

If the scan finds security issues that need human review, an ISSM (security reviewer) looks at them. This typically takes less than 24 hours.

Once approved, the platform deploys your app automatically. You get all of this with zero configuration:

- **HTTPS** -- a valid TLS certificate for your app's URL
- **Monitoring** -- CPU, memory, and request metrics in Grafana dashboards
- **Logging** -- all your stdout/stderr collected and searchable
- **Network security** -- encrypted traffic between all services
- **SSO** -- single sign-on login (if you enable it)
- **Backups** -- automated, managed by the platform

Your app will be live at the URL you specified (e.g., `https://my-app.apps.sre.example.com`).

## Which Example Matches My App?

| I have... | Use this example |
|-----------|-----------------|
| A simple web app or API | [01 - Simple Web App](examples/01-simple-web-app/) |
| An app that needs a database | [02 - App with Database](examples/02-app-with-database/) |
| Multiple services (frontend + backend + worker) | [03 - Multi-Container](examples/03-multi-container/) |
| Commercial/vendor software I didn't build | [04 - Vendor Software](examples/04-vendor-software/) |
| An app that writes files to disk | [05 - Gitea](examples/05-gitea-self-hosted/) |
| An app that needs root access | [06 - n8n](examples/06-n8n-workflow-automation/) |

## Common Questions

### Why can't I just push my image to a registry?

Security. Every image that runs on this platform passes through vulnerability scanning, secret detection, and compliance checks first. This is what makes the platform approved for government and regulated workloads.

### What if my app needs a database?

Set `database.enabled: true` in your bundle config. The platform provisions a PostgreSQL instance for you and passes a `DATABASE_URL` environment variable to your app. You don't manage the database -- the platform does.

### What if the security scan finds problems?

You'll see the results in the dashboard with clear descriptions. Most findings are known CVEs in base image layers. You can fix them by updating your base image, mark them as accepted risks, or request an exception. Then resubmit.

### What port should I use?

Whatever port your app already listens on. Common ones: 3000 (Node.js), 5000 (Flask), 8080 (Go/Java/Spring), 8000 (Django/FastAPI).

### How do I update my app?

Build a new image with a new version tag, create a new bundle, and submit it again. Same process every time.

### What does the platform give me for free?

HTTPS certificates, monitoring dashboards, centralized logging, encrypted network traffic between services, automated backups, SSO login, vulnerability scanning, and runtime threat detection. All automatic, zero config from you.

## What Happens After You Submit

```
You upload bundle --> Security scanning (2-5 min)
                          |
                     +----+----+
                     | Issues? |
                     +----+----+
                    No    |    Yes
                     |    |     |
                     v    |     v
              ISSM Review |  Fix & resubmit
              (< 24 hrs)  |
                     |    |
                     v    |
              Approved <--+
                     |
                     v
              App is live!
              https://yourapp.apps.sre.example.com
```

## Troubleshooting

| Problem | What to do |
|---------|------------|
| Scan found critical vulnerabilities | Update your base image to a patched version and rebuild |
| "Image not signed" error | This is handled automatically -- resubmit if you see it |
| App deploys but shows 502/503 errors | Check that the port in your bundle matches what your app listens on |
| App keeps restarting | Your health check path might be wrong -- make sure `/healthz` returns 200 |
| "Resource limit exceeded" | Increase the `resources` setting from `small` to `medium` or `large` |
| Need to reach an external API | Add the domain to `externalApis` in your bundle -- outbound traffic is blocked by default |

## Need Help?

Contact your SRE platform team or open an issue in the project repository.

For a full reference of every bundle.yaml field, see [bundle.yaml.template](bundle.yaml.template).
