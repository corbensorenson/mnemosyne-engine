# Incident Response

Mnemosyne incident response starts from first-party monitoring data. The platform does not need a hosted pager service to decide whether release promotion should stop, which services are affected, or what evidence should be attached to an incident.

## Incident Report Artifact

Create an incident response report:

```bash
curl -X POST http://127.0.0.1:8787/api/ops/incidents/reports \
  -H 'Content-Type: application/json' \
  -d '{"operatorId":"user_demo","environment":"production"}'
```

The API builds a system-wide monitoring snapshot, classifies severity, writes a `mnemosyne-incident-response-v0.1` JSON artifact to the `evidence` bucket, persists the object manifest, and audits `ops_incident_report_stored`.

The PWA Admin surface includes an Incident Command panel that previews the same first-party incident report contract, stages a local report artifact with a browser-computed SHA-256 manifest preview, and records the action in the local audit log.

Severity mapping:

- `sev1`: security or dependency critical alerts, or three or more critical alerts.
- `sev2`: at least one critical alert.
- `sev3`: warning alerts without critical alerts.
- `none`: no active alerts; the artifact is a no-action drill record.

Active incident artifacts use `legal_hold` retention. No-action drill artifacts use `product` retention.

## Response Loop

1. Generate an incident report artifact.
2. Assign an incident commander for `sev1` or `sev2`.
3. Freeze release promotion while critical release blockers remain.
4. Work recommended actions in priority order.
5. Rerun `GET /api/ops/monitoring` after each mitigation.
6. Generate a new incident report artifact for the post-mitigation state.
7. Close only when monitoring is nominal or accepted residual risk is documented.

## Evidence

Each report includes:

- monitoring status and release gates
- alert counts and primary alert ids
- impacted services
- release blocker alert ids
- recommended actions with owners and runbook references
- service levels and ops totals

This report is intentionally an operations artifact. It contains alert metadata and aggregate ops counts, not raw learner payloads.
