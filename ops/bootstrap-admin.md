# Administrator Bootstrap Procedure (ADR-031)

Dual control requires at least two administrators, so the **initial**
administrator authority cannot be created through the dual-control API.
Bootstrap is therefore a deliberate, explicitly audited infrastructure
operation performed by the operator on the VM (or locally for development).

## Procedure

1. The first account must already exist (created by redeeming an invitation).
2. Run `scripts/bootstrap-admin.sql` with the target account's email:

```bash
docker compose exec -T postgres psql -U careerpilot -d careerpilot \
  -v target_email='operator@example.invalid' \
  -f /dev/stdin < scripts/bootstrap-admin.sql
```

3. The script:
   - sets `is_admin = true` on exactly that account;
   - refuses to run if the account does not exist or is closed;
   - writes an immutable audit event (`admin_role.bootstrap`) recording the
     procedure and the affected account id — no emails or secrets.

## Rules

- Bootstrap authority is granted ONLY to the minimum number of operators
  needed to satisfy dual control (two at private-beta start).
- Every subsequent grant/revoke MUST go through the dual-controlled API
  (`POST /api/admin/role-changes` + `/approve`) — never direct SQL.
- This procedure is subject to the ADR-030 release-validation gate review.
