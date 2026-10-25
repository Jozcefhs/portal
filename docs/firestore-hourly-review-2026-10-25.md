# Firestore hourly read review — 23–25 October 2026

## Measured usage

Cloud Monitoring was read at 02:35 WAT on 25 October. The interval is 23 October
00:00 through 25 October 02:00 WAT, excluding the current incomplete hour.
All times below are West Africa Time (UTC+01:00).

| Period | School document reads | Faith document reads reported |
| --- | ---: | ---: |
| 23 October, complete day | 46,913,416 | 207 |
| 24 October, complete day | 11,394,896 | 2,904 |
| 25 October, 00:00–02:00 only | 15,368 | 1 |

School reads fell **75.71%** between the two complete days. The busiest hour was
23 October 14:00–15:00, with 7,761,996 reads. Query-result reads dominate:
46,695,597 on 23 October and 11,337,446 on 24 October.

The matched 18:00–23:00 windows had 4,259,536 reads on 23 October and 1,036,111 on
24 October. The latter window followed both main read-repair deployments.
However, 24 October 06:00–15:00 was already considerably quieter before these
deployments (8,897,511 reads versus 29,383,054 the previous day). The daily drop
therefore cannot all be attributed to the repairs. Traffic volume, different
work performed and the weekend are confounding factors. The early hours of
25 October are not evidence of a complete day's cost or classroom-load performance.

Faith usage did not show the school's spike. Missing hourly points are left blank
in the CSV; they are not invented zero measurements. A separate organisation
edition production usage baseline was not available in the two monitored projects.
The shared organisation code is covered by the regression tests and deployment.

[Hourly readings, including query reads](firestore-hourly-reads-2026-10-23-to-25.csv)

## Deployment timing

GitHub Actions completed the organisation deployment of `cfe8bbb0` (scorebook/CBT
read reduction) at **15:40:34 WAT on 24 October**, run `40103471105`.
The branch/module reduction `185b971b` completed at **17:24:33 WAT**, run
`40111327866`. The legacy-store-label follow-up `c5b023d3` completed at
**17:31:44 WAT**, run `40111879174`. Tenant pool completions were 15:42:39,
17:26:38 and 17:33:41 respectively.

These timestamps establish when server repairs became available. They do not
prove every browser reloaded or every installed desktop received a new installer.

## Additional repairs in this pass

- Vendor POS queries only products belonging to the authenticated login's linked
  vendors. It reuses that request's verified vendor list instead of querying it twice.
- Vendor settlement screens narrow balances, requests, product changes and stock
  for vendor users. Management retains its complete branch view; a login with no
  linked vendors issues no stock/history scan. School, faith and organisation use
  the same helpers. Supplier choices also use branch-aware reads.
- Main Branch finance pagination uses the existing snapshot coverage proof before
  selecting branch records. This covers payments, invoices, journals, fee summary
  and club report paths, including desktop report requests. Older in-progress
  opaque cursors still complete against their original snapshot.
- Pagination reuses a bounded, short-lived plan for the exact immutable report
  snapshot, project, credential and branch, avoiding repeated coverage counts
  on every page. A new snapshot requires a fresh proof. No record data is cached.
- Library staff searches no longer read the student directory, and student
  searches no longer read the staff directory. Staff reads remain branch-aware,
  including legacy organisation-wide staff.
- Tuck Shop stock reads use the selected branch; student lookups carry the selected
  school section into the directory read instead of reading both sections first.

The earlier focused academic bundles, loaded-data summary counters, deferred
score rows and branch-aware shared lists remain in place. Necessary complete
financial reports, active access checks and legacy-record compatibility reads
remain. No global cache was added for scores, balances, permissions or stock.

This change affects shared backend routes used by the web companion and installed
desktop clients. It does not require a new desktop installer. No record migration,
deletion, score adjustment, payment update or history rewrite is part of this repair.

## Validation

- New read-budget tests cover all three editions, empty vendor links, 65 linked
  vendors, failing queries, single owner-list resolution, private-data exclusion,
  finance pagination/cursor isolation, legacy rows and unchanged zero amounts.
- A representative fixture previously read 600 stock records for a vendor with
  three products; the narrowed read returns three. This is a fixture measurement,
  not a prediction of a production billing percentage.
- Existing vendor checkout, duplicate-payment/retry, approvals, stock and
  financial-history tests pass with the new readers.
- Planning-only Query Explain returned HTTP 200 for all 18 query shapes checked
  across school and faith: three inventories, three vendor collections, and
  journals/invoices/payments. No operational documents were returned or changed.
- All 3,996 Node regression tests passed. The Cloudflare Pages Functions Worker
  compiled successfully. Deployment completion is verified after pushing this change.

## Measurement method and limits

The source is `firestore.googleapis.com/document/read_count`, summed over read
types with `ALIGN_SUM` and 3,600-second alignment. An aligned interval ending at
01:00 UTC is labelled 01:00–02:00 WAT, its start and end in local time.
Monitoring API pagination was exhausted. Write and API-request counters were
also collected to cross-check activity; no Firestore document scan was used for
this usage review. All requests were read-only.

Aggregate monitoring counters do not identify which screen caused each read.
They also are not a final billing invoice: credits, pricing, index reads and
billing day boundaries may differ. No hourly dollar cost is inferred here.

References: [Cloud Monitoring time-series API](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list),
[Firestore usage monitoring](https://firebase.google.com/docs/firestore/monitor-usage),
[Query Explain](https://firebase.google.com/docs/firestore/query-explain).
