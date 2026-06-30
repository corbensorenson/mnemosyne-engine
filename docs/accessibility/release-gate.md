# Accessibility Release Gate

Mnemosyne treats accessibility as a release gate, not a late manual pass. `@mnemosyne/accessibility-core` owns the first-party checklist for the PWA surface inventory.

## API

```bash
curl "http://127.0.0.1:8787/api/accessibility/release-gate?userId=user_demo&environment=production"
```

The API returns a `mnemosyne-accessibility-release-gate-v0.1` report and audits `accessibility_release_gate_checked`.

The current gate covers:

- keyboard navigation
- visible focus treatment
- keyboard trap absence
- screen-reader labels
- icon-only button labels
- reduced-motion support
- contrast review
- text scaling review
- phone-width overflow review
- local speech plan controls
- immediate speech stop controls
- quiet-environment fallback text
- audio privacy and transcript-retention controls

## Surface Inventory

The default PWA inventory includes Onboarding, Today, Graph, Morning Forge, Tutor, GraphFeed, Paced Read, SpeedListen, WalkMode, Evening Lock-In, Sleep, Stats, Social, Wearables, Packs, Content Court, Technique Lab, Workbench, and Admin.

The gate returns per-surface checks, criterion summaries, failing surface ids, and remediation text. A release candidate should not promote while `passed` is false.

Audio-first surfaces must remain usable without sound. Morning Forge, Tutor, WalkMode, Evening Lock-In, and Sleep expose local speech controls through the first-party session speech plan contract, immediate stop controls, quiet fallback text, and privacy cues for transcript-sensitive workflows.
