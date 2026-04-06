# SRE Developer Kit

Everything you need to create a deployment bundle for the Secure Runtime Environment (SRE) platform. A bundle is a self-contained package (.tar.gz) containing your container image(s) and a deployment manifest that tells the platform how to run your application.

## What's in This Kit

| Item | Description |
|------|-------------|
| `bundle-builder.html` | Open in your browser to create a bundle with a visual form (recommended) |
| `sre-bundle.sh` | Command-line tool for creating bundles (requires bash + docker) |
| `bundle.yaml.template` | Manifest template with comments explaining every field |
| `examples/` | Five example bundles from simple to complex |
| `docs/bundle-guide.md` | Comprehensive guide covering all deployment scenarios |
| `QUICK-START.txt` | Plain text quick start (5 steps to your first bundle) |

## Quick Start

**Fastest path (no command line needed):**

1. Open `bundle-builder.html` in your web browser
2. Fill in the form with your app details
3. Upload your container image (`.tar` file from `docker save`)
4. Click "Generate Bundle"
5. Send the `.bundle.tar.gz` file to your SRE platform operator

Need to create a `.tar` file from your Docker image?

```bash
docker save myimage:v1.0.0 -o myimage.tar
```

For more options, see `docs/bundle-guide.md`.
