# Dynamax v3.1.64

The verified desktop installer is published at [Stable download](https://github.com/Jozcefhs/portal/releases/download/desktop-stable/Dynamax_Setup_v3.1.64.exe), with [versioned release notes](https://github.com/Jozcefhs/portal/releases/tag/desktop-v3.1.64).

- Desktop source: `8cba0d5`; published metadata: `3347178`.
- Web implementation: `e742f01e167d42dd62f4b1a386272e42b42a1008`; HR CI portability follow-up: `f4d8791c6e05ec8f49a057ea9e65aab47b09723f`.
- Web release marker: `dynamax-v555-student-status-hr-employment`.
- Installer size: 42,784,976 bytes.
- SHA-256: `472b380dd7fe14c76dcb2d88f8671ad430c213fd3827644509eac481fd674d8e`.

The desktop update includes class/term-specific total-fee discounts, the shared branch class/arm catalogue, exact multi-class fee rules, Day/Boarding vendor customer labels and payment requests covering up to 2,000 sales. The shared web deployment includes linked pupil status handling, HR salary structures and private PDF employment letters, current vendor queues separated from completed history, and both inherited and independent branch email accounts.

Validation passed: 1,175 desktop tests; packaged application self-test; TLS bundle and Android CBT asset integrity; 5,030 shared web tests plus 98 focused HR CI checks; 352 email/sender checks. The Hospital port passed 4,808 tests plus 99 focused HR checks. Desktop/mobile browser checks cover all four editions. School and Faith served 24 checked interface assets matching source; nine email setup assets across School, Faith and the central platform matched source. Protected APIs rejected unsigned requests.

All eleven managed tenant deployment jobs and their required index application steps passed in workflow run `42815014391`. School, Faith and isolated Hospital vendor indexes were separately verified READY. The HR portability change keeps web/backend tests unconditional and skips only the separate desktop parity check when that repository is absent in a portal-only CI checkout.

Existing records are preserved. No actual employee email or independent provider connection was performed during validation. School and Faith retain their ready Brevo setup; central Google OAuth client credentials are configured. Card terminal payments remain disabled. The separate future Hospital roadmap remains tracked in its own checklist. Local CBT computers must install the update and synchronize their saved answer copies before those historical answers can appear online.
