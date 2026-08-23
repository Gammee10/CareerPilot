# Dev Docs — Session Continuity Protocol

## Purpose

These files are the **working memory** between coding-agent sessions. Architecture documents (`docs/architecture.md`, `docs/adr/`, `AGENTS.md`) change only when decisions change. These files change constantly and describe *where implementation actually stands* right now.

A brand-new session with zero prior conversation must be able to reconstruct enough context to continue correctly by reading these files first.

## Mandatory Protocol

### Every session — READ FIRST, before any code:

1. `AGENTS.md` — standing rules and invariants (never violated)
2. `docs/dev/current-state.md` — what exists now: completed work, running state, file map, known issues
3. `docs/dev/session-log.md` — most recent entries only (newest first), for recent history and context

### Before a session ends — UPDATE, no exceptions:

1. **`current-state.md`**: revise to reflect reality after this session (task statuses, new files/modules of note, changed run commands, open blockers).
2. **`session-log.md`**: prepend one entry: date, what was done, what was verified/tested, decisions or deviations surfaced, exact next step for the next session.
3. If anything done this session required an architectural choice → do NOT decide silently; stop, surface it, and record it as an OPEN item in `current-state.md`.

## Rules

- These files describe reality, not intent. If the code and these files disagree, fix the files immediately.
- Keep entries factual and short. No design essays — architectural truth lives in the ADRs.
- Never delete history from `session-log.md`; it is append-only (prepend new entries).
- If a session ends without updating these files, treat that session's work state as unverified.
