# 🤖 CareerPilot

> **An autonomous job-search and application agent.** CareerPilot helps job
> seekers discover openings, tailor applications, and track the whole pipeline —
> powered by an AI service and a containerized full-stack architecture.

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)

---

## ✨ What It Does

CareerPilot automates the repetitive parts of a job hunt while keeping the
candidate in control:

- 🔎 **Finds** relevant job listings from multiple sources
- ✍️ **Tailors** applications and cover letters to each posting
- 📊 **Tracks** applications, stages, and outcomes in a single dashboard
- 🤖 **Uses AI** (Gemini) behind an internal, authenticated service

---

## 🏗️ Architecture

The project is containerized and split into focused services:

| Component | Stack | Role |
|---|---|---|
| `apps/backend` | Express + TypeScript | Authoritative API & background worker |
| `apps/frontend` | Next.js | Dashboard (presentation only) |
| `services/ai` | FastAPI (Python) | Internal AI capability (Phase 1 shell) |
| `db/` | PostgreSQL | Migrations + schema acceptance tests |
| `caddy/` | Caddy | Public entry point & routing |

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────┐
│  Next.js    │──▶│  Express API     │──▶│ PostgreSQL  │
│  Dashboard  │    │  + Worker        │    └─────────────┘
└─────────────┘    └────────┬─────────┘
                            │
                       ┌────▼─────────┐
                       │  FastAPI AI  │  (internal)
                       └──────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- [Docker](https://www.docker.com) and Docker Compose
- [PowerShell](https://learn.microsoft.com/powershell/) (Windows) or Bash (macOS/Linux)

### Run the stack

```powershell
powershell -File scripts/dev-up.ps1
```

Then open **http://localhost:8080** for the dashboard and check the service
health at **http://localhost:8080/api/readyz**.

Full local development details: [`docs/dev/local-dev.md`](docs/dev/local-dev.md).

---

## 🗂️ Project Layout

```
CareerPilot/
├── apps/
│   ├── backend/      Express + TypeScript API & worker
│   └── frontend/     Next.js dashboard
├── services/
│   └── ai/           Internal FastAPI service (Gemini)
├── db/
│   ├── migrations/   SQL migrations
│   └── tests/        Schema acceptance tests
├── caddy/            Public entry point config
├── scripts/          Dev environment, secrets, test harness
└── docs/             Architecture, product, and dev docs
```

---

## 🧪 Testing

```powershell
# Schema acceptance tests
powershell -File scripts/test-schema.ps1

# Operations checks
powershell -File scripts/test-ops.ps1
```

---

## 📚 Documentation

| Document | Purpose |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | High-level architecture |
| [`docs/product-definition.md`](docs/product-definition.md) | Product scope & goals |
| [`docs/domain-model.md`](docs/domain-model.md) | Domain & data model |
| [`docs/user-flows.md`](docs/user-flows.md) | End-to-end user flows |
| [`docs/dev/`](docs/dev/) | Development guides & runbooks |

---

## 🔒 Security

- Secrets are mounted from files — never stored in env vars, images, or git
- The AI service is internal-only and requires authentication
- Rate limiting and hardened headers enabled on the API

---

## 📄 License

This project is available for personal and educational use.
