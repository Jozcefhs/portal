# Score register duplicate review

The class and classroom registers share one read-only projection. When a student has exactly one active membership, repeated marks from distinct arms are displayed once only if the test state, raw mark and maximum all agree. The current arm supplies the displayed sheet status where available.

Different marks, different maxima, absence-versus-numeric differences, duplicate records inside one arm and conflicting active memberships still require review. The projection never selects a higher or newer conflicting mark. It performs no writes or additional reads and preserves original score records, approvals, provenance and transfer history.

## School verification, 28 October 2026

A bounded audit of 2026/2027 First Term examined 14,964 score documents across 16 classes and all three configured academic sections/branches represented by the current session records. It found 58 repeated test cells across seven students: eight matching former/current-arm copies and 50 differing marks across six students. There were no duplicate test cells inside individual score documents.

The updated projection resolves the eight matching copies. The remaining 50 need an explicit academic choice between the earlier former-arm marks and later manually entered current-arm marks. No live score, membership, result or history document was changed by this audit. Private evidence and the per-student comparison stay outside source control.

Validation covers current-arm preference for matching values, zero, split parts, exemption, different marks/scales/states, same-arm duplicates, multiple active memberships, immutable input, classroom access controls and arm-transfer regression tests.
