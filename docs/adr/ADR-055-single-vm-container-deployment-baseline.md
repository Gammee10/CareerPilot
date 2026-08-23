# ADR-055: Use Ubuntu LTS, Docker Compose, and Caddy for the Private-Beta Deployment Baseline

## Status

Accepted — 2026-08-23

## Context

ADR-053 selects one Oracle Cloud Always Free VM for the cost-constrained private beta, but intentionally left its operating system, container runtime, and public HTTPS entry point open. The selected application contains several cooperating runtime processes while the MVP must remain $0 and operationally simple.

## Decision

- Use Ubuntu Server LTS on the approved OCI Always Free VM.
- Package and run the Next.js frontend, Express backend, Node background worker, FastAPI capability, and PostgreSQL as containers managed by Docker Compose on that VM.
- Use Caddy as the sole public HTTPS reverse proxy and route only the approved public frontend/application endpoints to the appropriate container.
- Keep PostgreSQL, the Node worker, and FastAPI private to the VM/container network; they receive no direct public route.
- Treat the Compose definition, image versions, configuration, and deployment procedure as version-controlled operational artifacts subject to the approved security/privacy release gate.

This is a single-VM private-beta baseline, not a high-availability, autoscaling, or zero-downtime deployment design. It does not select a domain/DNS provider, CI/CD product, monitoring product, backup implementation, container registry, or individual image versions.

## Alternatives Considered

### A. Ubuntu LTS with Docker Compose and Caddy

Provides simple, repeatable multi-container operation and a minimal HTTPS entry point on one VM. This is the selected option.

### B. Ubuntu LTS with Docker Compose and Nginx

Is equally viable but requires more reverse-proxy and certificate-management configuration for this small deployment.

### C. Kubernetes or a managed container platform

Offers stronger deployment and scaling capabilities but adds cost or operational complexity beyond the private beta.

## Why We Chose This

This is the smallest deployment foundation that cleanly separates public and internal runtime surfaces while remaining reproducible and compatible with a future provider migration.

## Consequences

### Positive

- One repeatable deployment definition runs the selected runtime components.
- HTTPS termination and public routing are centralized.
- Internal data and worker services avoid direct internet exposure.

### Negative

- The team operates OS patching, containers, certificates, and restarts itself.
- One VM remains a single failure and maintenance boundary.

### Risks

- Misconfigured routes, images, or secrets could expose an internal service.
- VM failure or a disruptive deploy affects the whole beta.

## Revisit Conditions

Reconsider before public launch, when scaling, availability, team operations, or deployment frequency makes the single-VM posture insufficient.
