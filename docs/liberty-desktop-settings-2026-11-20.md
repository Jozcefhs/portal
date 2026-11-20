# Desktop school documents and structure

The operator confirmed Liberty Square's desktop was in Selected branch overrides mode. Document requirements, enabled school sections and the shared branch registry are organisation-level settings, so the desktop intentionally locks them in that mode. An organisation-wide operator can choose Organisation defaults. Branch-assigned accounts and branch-paired computers retain their existing restrictions.

The desktop source now explains this beside the locked fields and provides an Edit organisation defaults shortcut for an unrestricted operator. The shortcut uses the existing scope switch and one authoritative profile refresh; it performs no settings write and cannot widen account/device permissions. The explanation distinguishes a manually selected branch mode from an account/device restriction.

The School Documents & Structure save button previously invoked a dedicated branch-registry save that did not send the document or school-section switches shown beside it. It now invokes the existing confirmed full-settings save, which sends the registry and all eight switches. Both document and registry handlers reject branch mode locally as well as retaining server-side restrictions. No pupil, score, financial or placement records are touched.

Validation: 64 focused Python tests passed, including the actual scope/save handlers, repeated lock/unlock cycles, readonly-combobox restoration, restricted-account guards, zero extra refresh when already in organisation mode, existing workspace isolation and prior User Management footer tests. No installer was compiled or released.

Desktop source pushed to `Jozcefhs/Dynamax-Desktop` main as `fe406144aa00e0116c40a32e89c87466a8d442ba`. The remote tree exactly matched tested local tree `15b08792e9c60500c002b1795503c7efd0f4aa90`. This includes the previously requested User Management button footer fix. Installed binaries remain unchanged until a separately authorised build.

The public Liberty Square backend independently identifies as workspace/project dynamax-tenant-002. The screenshot's DCA branch names are not proven to belong to that tenant: the local open desktop is DCA, direct access to the tenant's private settings was denied, and the operator has been asked to confirm Liberty Square's configured Backend API URL. No tenant settings or branch registry was overwritten.
