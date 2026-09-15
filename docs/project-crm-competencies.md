# Project settings and CRM competencies

The project settings page has two tabs: project types (list and phase detail) and checklist templates. Editing a phase retains template, advance days, duration, order, priority, owner, dependency and mandatory status. Checklist department associations remain independent of CRM competencies.

`competenze_crm` is a multi-value list: `brand_direct`, `conto_terzi` (PRIVATE), `b2b`, `online` (B2C). Existing catalog entries initially retain availability in all four sections; new entries require explicit selection. An empty list excludes an entry from CRM creation, while generic Workspace creation remains available. Existing projects/tasks are not regenerated when a catalog entry changes.

CRM creation uses `tipi_progetto` and `checklist_template`, including pipeline and approved AI plans. The separate unused `crm_activity_types` catalog is removed. Migration aborts if unexpected references to that catalog appear. Pipeline creation remains atomic and idempotent, preserving activity/progress links. Dependencies follow excluded ancestors to the closest included rule.

A phase's creator, assignee or participating department can read the entire project and every sibling phase. Existing global readers retain their scope. Sibling visibility alone does not permit phase updates/deletion or changes to department/product associations. Read-only details remain accessible from task/project screens.

## Validation

- `node --test test/project-crm-competencies.test.mjs server/crm/crm-workspace-activity-orchestration.test.js`
- Execute `test/project-crm-regression.sql` between `BEGIN` and `ROLLBACK`, using a privileged database test connection. It uses temporary fixtures and authenticated role contexts to verify personal/department participation, unrelated-project isolation, sibling read-only access, department preservation, all phase fields, CRM filtering, atomic creation and idempotency.
- Actual Settings components checked in Chrome with isolated fixture responses: tabs, pencil details, all existing fields, CRM saving, checklist departments, desktop/mobile layout and browser errors.
- The wider CRM suite has five pre-existing failures; baseline and changed code both have 187 passing tests and the same five failures. Existing lint errors in Projects, Tasks and PhaseChecklistModal are unchanged; modified/new settings and catalog integration files pass lint.
