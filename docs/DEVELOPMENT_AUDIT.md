# Checkyeerang Development Audit

Baseline: `pugmy/checkyeerang` at `cb573eb22fcff39945e298dc10c8414077267b77`.
Development branch: `15th-Gen-Kim-Woojun`.

## Safety boundaries

- This repository is a development copy; **never deploy directly to the school web app**.
- Never modify `pugmy/checkyeerang:main` as part of development.
- Do not commit credentials, sheet IDs, live attendance data, or deployment configuration.
- No GitHub Actions workflows or bot-authored commits; commits should be attributed to `WhoSia`.
- Run tests against in-memory fixtures, not the live Google Sheet.

## Findings

1. **Critical – Admin authorization:** `appsscript.json` permits anonymous web-app access and server functions for member mutation and CSV export lack role checks. Google Apps Script server methods must enforce authorization; hiding a tab is not security. Implement and test before production changes.
2. **High – Attendance deletion:** `api_deleteMember` deletes both the member and all linked `choolsuck` records. The initial fix rejects deletion of members with history and points users to graduation instead.
3. **High – CSV semantics:** `api_csv` filters by `createdAt`, not attendance `date`; this can omit records written later and include records for different days. Filter by `date` and explicitly include only duty/makeup records.
4. **High – Historical roster:** Historical attendance views rely on the current roster and schedule. Schedule snapshots or effective dates are needed for correct historical views.
5. **Medium – NEIS reliability:** A temporary NEIS failure skips absent-record generation without an independent backfill window.
6. **Medium – Makeup approvals:** `api_makeup` instantly increments `addCount`; no authorized approval workflow exists.

## Proposed validation

- Add Node-based, dependency-free tests that stub Apps Script global services and in-memory sheets.
- Test no-history deletion, rejection of deletion with attendance, and CSV filtering by attendance date.
- Later test role separation and server-side authorization before enabling real administrative operations.

## Release gate

Changes here do **not** alter the deployed Apps Script version. School operators must review diffs, confirm Google Script deployment version, test on an independent test sheet, and explicitly promote tested changes.
