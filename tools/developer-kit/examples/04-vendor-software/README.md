# Example 4: Vendor Software (COTS)

Commercial off-the-shelf (COTS) software from a third-party vendor.

## What this deploys

- Vendor-provided web portal on port 443 with large resources
- SSO integration via Keycloak
- Classification: CUI (Controlled Unclassified Information)
- No source code included (vendor binary only)

## Notes

- The vendor provides the container image as a tar file
- Source code is not available — the platform will skip SAST scanning
- Security scanning (CVE, SBOM) still runs against the container image
- CUI classification triggers additional compliance controls
