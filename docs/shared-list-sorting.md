# Shared list sorting standard

All three organisation editions use the same list-sorting rules.

## Web companion

Every register produced by the shared admin table renderer exposes:

- Default order
- Name: A to Z and Z to A
- Created: newest first and oldest first
- Modified: newest first and oldest first

The selected mode is stored locally for the current workspace and register.
Missing legacy timestamps always remain after dated records, so an unknown date
is never presented as the newest or oldest known date.

## Desktop suite

Every shared `ttk.Treeview` register can be sorted by selecting a column
heading. Text uses natural alphabetical sorting (`Class 2` before `Class 10`),
numeric values sort numerically, and date/time columns start with newest first.
Selecting the same heading again reverses the direction.

## Sequence exceptions

Manual sequence is retained only when it changes operational behaviour. Current
examples are class progression, approval-route priority, timetable periods,
assessment components, grading bands and workflow/checklist stages. Reusable
arms, subjects, departments and fee catalogues do not ask users for a display
order.
