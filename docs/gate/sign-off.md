# ADR-030 Release-Validation Gate — Sign-Off Record (T9.3)

Gate package: `docs/gate/evidence-checklist.md` (dimension → artifact mapping),
plus the full automated suite (17 test files / 131+ tests, CI job `identity`
and `stack-tests`), the executed restore drill (`docs/dev/drill-log.md`), and
the recorded preconditions in `docs/dev/current-state.md`.

## Gate review checklist

- [x] Unauthenticated denial, user-to-user isolation, administrator least privilege — evidence compiled and green
- [x] Invitation, link, session, suspension, revocation behavior — evidence compiled and green
- [x] Exceptional-access authorization and auditability — evidence compiled
- [x] Retention, deletion, recovery-copy, preservation-hold behavior — evidence compiled; drill executed with deletion-replay proof
- [x] Telemetry/audit minimization and secrets absence from diagnostics — log-scan + secret-scan green
- [x] Source-policy and external-processor data-use restrictions — T4.0 records + Gemini verification recorded
- [x] Resistance to adversarial untrusted-content attempts — dedicated adversarial suite green (2 hardening fixes produced by this gate)

## Residual items acknowledged before onboarding

1. Wire production OCI Object Storage driver when tenancy exists.
2. Render RemoteOK attribution + direct-link obligations on public listing surfaces.
3. Use restricted Gemini API keys at deployment.

## Sign-off

| Field | Value |
|---|---|
| Decision maker | Gammee10 |
| Status | **PENDING** |
| Date | — |
| Notes | Beta onboarding is prohibited until this record is set to APPROVED by the decision maker. |
