# Staff meetings and attendance

Open **Dashboard → Staff meetings**. School managers also have **Academic Management → Staff meetings**. Choose a date and select **Load meetings**; opening the screen does not read meeting history. Staff see only meetings whose saved departmental roster includes them.

## Create a meeting

1. Select **Create meeting**. Set the title, date, start and finish times, and time zone.
2. Choose **Dated meeting** for one date, or **Daily / recurring meeting** with weekday checkboxes and an optional finish date.
3. Check the departments to include. Unchecked departments are excluded. The saved roster contains active staff from the current branch and edition; it is not a client-supplied list.
4. Set the meeting location and choose GPS, approved network, or either. **Use my GPS location** fills the coordinates. **Add my current network on save** uses the server-observed public address. These settings never modify normal staff attendance locations.
5. Set the late grace period and check-in/check-out allowances, then save. Staff select **Check in** and **Check out** for that meeting using the same configured identity verification as daily attendance.

Meetings start and finish on the same day. Staff cannot check in after the meeting finishes. Staff without a check-in remain **Pending** until then, and appear **Absent** after the finish time. Present counts include late arrivals. Early departure and missing check-out are separately filterable.

## Review and print

Open **Attendance register** for a meeting/date. Filter by present, late, absent, pending, early departure, missing check-out, department, name or username. **Preview / print** includes only the filtered loaded records, the time zone and snapshot time. Use **Refresh register** for current attendance. Changing dates and returning restores loaded snapshots; there is no polling or automatic full-history scan.

## Permissions across editions

- School: every role with `canManageStructure` in Academic Management, including ICT; authorised attendance/HR administrators can also manage meetings.
- Faith: Super Admin, Pastor, Senior Pastor, Head Minister, Church Administrator and Management with attendance, services, executive-office or HR module access.
- Other Organisations: Super Admin, Executive Director, Organisation Administrator, Operations Manager and Management with corresponding operational module access.
- Hospital: Super Admin, Hospital Administrator and Medical Director with reception, attendance or HR access. Attendance-group HR administrators retain equivalent access. No patient or clinical permissions are added.
- Ordinary staff can attend their own meetings but cannot create meetings or view another person's attendance register. Branch, edition and active-subscription restrictions remain enforced server-side.

## Record preservation and database usage

Meeting data is separate from daily attendance: branch-scoped `staffMeetingSettings`, immutable `staffMeetingVersions`, and dated `staffMeetingOccurrences` with `attendance` and `events` subcollections. Daily attendance, payroll and clinical records are unchanged.

New settings/rosters form immutable versions. Editing or cancelling an existing meeting takes effect tomorrow or later; previous versions and attendance remain available by date. A later staffing/department change is included by editing future occurrences. No meeting record is deleted or overwritten to erase history.

One roster version and its catalog pointer are saved atomically with a revision check. Attendance uses deterministic per-person/per-meeting/per-date IN and OUT event IDs, atomic writes and preconditions. Concurrent clicks and retries retain the original timestamps instead of adding events. The first clock event also freezes that occurrence. A meeting-scoped identity proof cannot be substituted with an ordinary work clock-in proof.

Opening controls reads only the existing attendance identity policy. Staff/HR directories are read only when opening the editor or validating a saved roster. Date lists read the catalog, applicable versions and the signed-in person's attendance; a report reads only one occurrence's bounded register. Filters, counts, preview and cached navigation require no requests. Absence is derived without generating one database write per missing staff member. Successful read requests and repeated clocks do not create duplicate security-audit entries; immutable meeting clock events preserve the evidence.

No database migration, deletion, installer compilation or desktop release is required for this web feature.
