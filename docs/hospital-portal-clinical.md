# Hospital portal: released results and discharge summaries

Scope: the H12 patient/guardian portal, with H05 investigation release and H08 signed discharge documents. Web companion only.

## Staff workflow

1. Reception issues the verified patient or guardian their own portal invitation from **Patients and NFC cards → Patient / guardian portal access**.
2. A clinician opens the patient's investigation order or admission, then expands **Share medical document with patient / guardian**.
3. Select **Load recipients and release status**, choose the named recipient, record the reason/consent reference, and confirm clinical review and authority to receive this document.
4. **Share current document** exposes only that signed document to that recipient. Repeat separately for another authorised recipient. **Withdraw document** removes subsequent portal access without deleting the source or its history.

Financial portal access does not imply permission to see medical documents. Laboratory/imaging results must be independently verified and released. Critical results require recorded clinician acknowledgement. Discharge must be completed with a signed summary. Drafts, internal reasons and specimen snapshots are not exposed. A corrected or superseded document is unavailable until the current version is explicitly shared again.

Changing a portal password preserves clinical consent but invalidates old sessions. Replacing an invitation requires a new clinical sharing decision. Revocation/expiry prevents subsequent requests. Previously viewed or printed copies cannot be recalled.

## Patient and guardian workflow

At `/hospital-portal.html`, sign in with the invitation/access code and password. Choose **Released investigation results** or **Discharge summaries**, select the sharing date range, then load. **View / print** opens the document; Print can also save it as PDF through the browser. The clinician's identity, source date and portal release date are shown.

Lists show only documents explicitly shared with this recipient, patient and branch. Opening a clinical document always rechecks live consent and the current source, even when its list is cached. A withdrawn or superseded document clears the previous displayed content and shows an explanation.

## Preservation, duplicate prevention and data access

- One deterministic publication pointer per recipient and clinical record; publication/withdrawal retain immutable before/after events. Signed originals, clinical history, invoices and payments are retained.
- Atomic request receipts and revision preconditions prevent duplicate publication, racing updates and lost-response retries. Explicit publication conditionally rewrites unchanged patient, recipient and source records to protect the reviewed snapshot against concurrent changes; it does not change their business fields.
- No automatic release, email, charge, polling or background clinical-history scan. Opening the sharing panel reads nothing until requested.
- Lists query at most 31 rows to display 30, with date ranges up to 93 days and scope-bound cursors. Cached list navigation does not repeat reads or write records. Document access uses scoped direct lookups; no per-row clinical fetch occurs in lists.
- The first successful clinical document view writes one immutable access event per session and publication revision. Reopening that version does not repeat the event. Print uses the already loaded document and makes no request.
- One additive Firestore index supports recipient-specific dated clinical lists. Backup collection registration includes publication pointers and their events. No existing index or record is removed.

## Verification

14 November 2026: **4,968 repository tests passed**. Eight focused clinical portal cases cover named-recipient opt-in, role/branch/patient isolation, concurrent/retried publication, critical-result acknowledgement, signed discharge, changed sources, withdrawal, password/invitation consent generations, bounded pagination and record preservation. The nine existing portal tests also pass.

Browser checks cover clinician sharing, patient/guardian presentation at desktop and 390-pixel widths, escaped report content, cached lists, fresh clinical detail checks, withdrawal, discharge fields and printing without additional reads/writes. The existing financial portal browser regression also passed. Live evidence is added after deployment to the isolated Hospital Owner Demo.

H12 remains open for remaining communications and practitioner validation; this increment does not expose every clinical record. No desktop compilation or installer release.
