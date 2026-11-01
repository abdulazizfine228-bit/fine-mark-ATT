# Database export

Exported from the live Lovable Cloud database on 2026-11-01.

## Files

- `schema.sql` — full database structure: tables, the `app_role` enum, functions
  (`has_role`, `handle_new_user`, `get_or_create_employee`), triggers, and all
  row-level security policies. Run this first on an empty database.
- `data.sql` — all table data as INSERT statements (914 rows across attendance,
  employees, leave_requests, profiles, projects, user_roles). Run this after
  `schema.sql`.

The `supabase/migrations/` folder at the project root contains the same schema
as an ordered migration history, if you prefer applying it that way.

## Notes

- Employee ID photos and attendance photos are stored in cloud file storage,
  not in the database, so they are not part of this export. The database rows
  reference them by path (e.g. `photo_path`, `id_photo_path`).
- User accounts themselves (emails/passwords) live in the managed auth system
  and cannot be exported; `profiles` and `user_roles` reference them by ID.
