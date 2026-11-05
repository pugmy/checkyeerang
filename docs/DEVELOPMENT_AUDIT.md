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
6. **Operational boundary – Student kiosk:** Ordinary attendance and makeup remain direct submissions on the designated library PC. Student login and makeup approval are intentionally out of scope.

## Development status (not deployed)

| Area | Branch implementation | Remaining validation |
| --- | --- | --- |
| Admin access | Server-side authorization for all 8 privileged APIs, login, logout, short-lived cache session | Verify Script Properties and web-app browser flow in independent Apps Script deployment |
| Maintenance API exposure | Renamed setup, NEIS setup, absence trigger and yearly promotion entrypoints with private suffix | Re-run setup_ in test script to migrate old triggers |
| History preservation | Refuses permanent deletion when attendance history exists | Confirm operator's expectations and backup policy |
| CSV | Filters by actual attendance date, excludes absences, uses recorded duty day | Historical grade and schedule still depend on current User row |
| UX | Clearer empty states, deletion errors and login expiry feedback | Real browser keyboard/mobile testing |

### Residual risks

- Student attendance and makeup intentionally do not require individual login or approval; the intended operating environment is a supervised library kiosk. Note: an Apps Script deployment configured for anonymous access is not technically restricted to that PC, even when the kiosk is the intended place of use.
- Admin credentials use a random high-entropy password and salted SHA-256 hash; a predictable or reused password would not meet the design assumption.
- Failed login counters live in a shared, best-effort Apps Script cache. This is not a robust distributed anti-abuse service and can temporarily lock out the administrator.
- Session cache eviction can end an administrator session before four hours.
- `RosterHistory.gs` adds an initial baseline and timestamped field deltas. Pre-baseline roster data cannot be recovered reliably, and Google Sheets multi-sheet writes are not transactional.
- Google Apps Script deployments are versioned separately from GitHub: pushing a branch does not update the deployed web app.

## Temporal model implementation

- `RosterHistory` stores one initial state per existing member, then only changed fields with UTC effective timestamps. More information: [Temporal Roster](TEMPORAL_ROSTER.md).
- Member updates, add, graduation, restoration and annual promotion append events. Removing an attendance-free member is a logical removal (`type=-1`), preserving historical assignments.
- Historical views reconstruct each shift at the applicable deadline; CSV recovers name, grade and assignment from the corresponding point in time. Pre-migration rows are marked unverified.
- Automatic absence checks now inspect the roster as it existed at each shift deadline.
- Admin sessions lock after 15 minutes of inactivity on administrator pages; student use on the home page does not extend a session.

## Deferred validation

- Run Node tests under the user's actual local Node.js installation and verify independent Apps Script deployment.
- Exercise setup migration and legacy trigger cleanup with a copy of a populated sheet.
- Introduce reconciliation/repair for the small failure window between updating the materialized `User` row and appending its history event.
- Validate behavior at year boundaries and mid-day roster changes.

## Proposed validation

- Add Node-based, dependency-free tests that stub Apps Script global services and in-memory sheets.
- Test no-history deletion, rejection of deletion with attendance, and CSV filtering by attendance date.
- Later test role separation and server-side authorization before enabling real administrative operations.

## Release gate

Changes here do **not** alter the deployed Apps Script version. School operators must review diffs, confirm Google Script deployment version, test on an independent test sheet, and explicitly promote tested changes.
