# Import, export, cache and reset

Exports use schema version 2, application version, type, locale, creation time and SHA-256 checksum. Safe export redacts passwords, tokens, API keys, card numbers and CVV. Complete export requires an explicit warning and uses a filename containing `SENSITIVE`.

Import accepts JSON only, caps input at 10 MB, validates the schema and checksum, presents a count preview, and supports merge or replace. The previous workspace is saved for rollback before mutation. Imported content is treated as data and never executed.

Reset is scoped to layout, toolbar, theme, project, permission preferences, Convertio or all local data and requires typing `RESETAR`. Online account, Stripe subscription and Supabase entitlement are not deleted by local reset.
