# Student face-lookup third-party notices

These pinned browser assets are loaded only after an authorised staff member
explicitly opens Student Face Lookup.

- **Human 3.3.6** (`human.esm.js`) is copyright Vladimir Mandic and licensed
  under the MIT License. The full text is in `LICENSE-HUMAN-MIT.txt`.
- **HSE FaceRes** (`faceres.json` / `faceres.bin`) is derived from
  [HSE_FaceRec_tf](https://github.com/av-savchenko/HSE_FaceRec_tf), licensed
  under Apache-2.0.
- **MediaPipe BlazeFace, FaceMesh and Iris** model assets are derived from
  Google MediaPipe components, licensed under Apache-2.0.

The original Human model notes state that converted model weights inherit the
licence and limitations of their original sources. They also warn that the
models were not retrained, so original model bias remains.

This integration is therefore restricted to staff-assisted student record
lookup. It must not be used for authentication, automatic attendance,
discipline, financial decisions, or passive surveillance. A school must
complete its privacy review, record guardian consent, calibrate matching for
its own population and devices, and retain a manual search alternative before
enabling the feature.
