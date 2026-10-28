# Score register duplicate review

The class and classroom registers share one read-only projection. When a student has exactly one active membership, repeated marks from distinct arms are displayed once only if the test state, raw mark and maximum all agree. The current arm supplies the displayed sheet status where available.

Different marks, different maxima, absence-versus-numeric differences, duplicate records inside one arm and conflicting active memberships still require review. The projection never selects a higher or newer conflicting mark. It performs no writes or additional reads and preserves original score records, approvals, provenance and transfer history.

## School verification, 28 October 2026

A bounded audit of 2026/2027 First Term examined 14,964 score documents across 16 classes and all three configured academic sections/branches represented by the current session records. It found 58 repeated test cells across seven students: eight matching former/current-arm copies and 50 differing marks across six students. There were no duplicate test cells inside individual score documents.

The updated projection resolves the eight matching copies. The owner then explicitly chose to restore the earlier former-arm marks for the 50 conflicting cells. Private evidence and the per-student comparison stay outside source control.

## Authorised restoration

The 50 earlier CA1 marks were restored into the six students' existing current-arm score records. Their record IDs, classroom placements, subject lists, other tests and original former-arm records were retained. Calculated totals were recomputed using each destination's existing assessment definitions, with checks that unrelated cells and score maxima stayed unchanged.

Each changed score retains a restoration event with the previous and restored values. Six academic audit entries retain complete before/after score records and source provenance. Existing correction history was appended to rather than replaced. A verified local backup preceded an atomic, revision-guarded commit of 50 scores, 41 affected sheet metadata records, six membership revision guards and six audit entries.

Restoration does not grant a new approval. Valid test reviews for classmates were preserved; restored students were added to the relevant review's pending list. Previously stale reviews were not promoted to valid reviews. No result was calculated, published or deleted by the repair.

Post-write verification checked all seven originally affected students, confirmed zero remaining duplicate warnings, checked that the earlier source records and placements were unchanged, and verified the retained later marks in the audits. A retry made zero writes and created no additional audit entries.

The maintenance planner in `scripts/lib/restore-academic-score-cells.mjs` is offline and has no public route. Its caller must back up records, guard both source and target revisions, and commit review/audit changes atomically. It cannot choose a source or restore a different student's, subject's, term's or branch's marks.

Validation covers current-arm preference for matching values, zero, split parts, exemption, different marks/scales/states, same-arm duplicates, multiple active memberships, immutable input, classroom access controls and arm-transfer regression tests. Restoration tests additionally verify exact cell selection, derived totals, retained history, invalid source/scale/revision rejection, retry safety and preservation of classmates' reviews.
