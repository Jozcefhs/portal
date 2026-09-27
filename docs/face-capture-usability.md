# Guided face capture

The staff attendance and student enrollment/lookup dialogs use the same on-device capture pipeline.

- Capture no longer depends on catching a split-second blink. New attendance challenges randomly choose a small left or right head turn, then require a return to centre. Enrollment and assisted student capture use a left turn. Older signed blink challenges remain supported with a slower close/open-eyes instruction.
- Calibration uses three stable frames and accepts natural eye-opening differences and a modest phone angle. The captured face still needs sufficient confidence, size, visible boundaries, an open-eye baseline, the requested live action, and a frontal return before a descriptor can be collected.
- Portrait guides retain a 0.76 width/height ratio. Size checks compare face width to video width and face height to video height; a tall portrait face is not incorrectly rejected against the camera's width.
- Camera/audio controls are outside the preview. One status message gives the current instruction. Capture is the main button once the camera is ready; retries reuse the stream. Preview height adapts to the viewport and the footer remains reachable on small screens.
- Signed attendance challenges, account matching, enrollment device-unlock proof, encrypted templates and existing match thresholds are unchanged. No raw camera frame is uploaded or stored.

Automated tests exercise simulated slow-camera capture, natural narrow eyes, portrait sizing, legacy blinks, left/right challenges, wrong/no movement, multi-person interruption and cancellation. Headless Chrome layout checks cover small phones, larger phones and desktop widths. Physical camera accuracy and spoken instruction timing still need a check on the affected handset; these tests do not establish bank-grade anti-spoofing accuracy.
