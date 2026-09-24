#!/bin/sh
set -eu
# These existing tests require the Windows deployment environment, its fonts,
# design-time model or configuration files deliberately withheld from the sandbox.
# They remain mandatory in the Windows release check. Do not run generated code
# on the Windows host to work around a failed sandbox test.
excluded='FullyQualifiedName!~StagingWindowsIdentityTests.PowerShell_runtime_rejects_current_and_non_staging_identities&FullyQualifiedName!~StagingPowerShellRuntimeTests.Sql_connection_string_builder_accepts_canonical_keys_in_windows_powershell&FullyQualifiedName!~BatchPackagingPdfTests.MultiplePagesKeepTheSelectedBatchAndLot&FullyQualifiedName!~CompanyHeadingArchitectureTests.CoaPdf_ComposesRealTemplateAndSignatureImage&FullyQualifiedName!~WorkspaceV3ArchitectureTests.Ef_design_factory_uses_the_runtime_identity_v3_schema&FullyQualifiedName!~WorkspaceV4ArchitectureTests.Production_example_enables_only_the_v4_contract&FullyQualifiedName!~WorkspaceAccessArchitectureTests.Sso_accepts_only_local_destinations&FullyQualifiedName!~WorkspaceAccessArchitectureTests.Catalog_exports_all_launchable_screens_separately_from_modules&FullyQualifiedName!~WorkspaceAccessArchitectureTests.Catalog_discovers_only_declared_assignable_modules&FullyQualifiedName!~WorkspaceCatalogDeletionTests.Deletions_require_secret_persist_and_filter_only_requested_catalog_entries&FullyQualifiedName!~ProductionWorkbenchCatalogTests.ConsolidatedWorkbenchHasDistinctAssignableModuleAndScreen'
printf '%s\n' 'Verifica Linux: compilazione e suite portabile. I test Windows (PowerShell, font PDF, configurazioni, Identity e route native) richiedono verifica Windows prima del rilascio. Un ramo AI non viene pubblicato automaticamente.'
dotnet restore Tests/Planning/ProgreMES.APS.Planning.Tests.csproj --source /opt/nuget/packages -p:NuGetAudit=false
dotnet test Tests/Planning/ProgreMES.APS.Planning.Tests.csproj --no-restore --verbosity quiet --filter "$excluded"
