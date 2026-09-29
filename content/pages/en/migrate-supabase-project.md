---
title: Migrate a Supabase project to another: schema and data
description: Copy a Supabase project to another one: what to move, in which order, the sequence and RLS pitfalls, and a tool that does it all from the browser.
date: 2026-09-29
updated: 2026-09-29
translation: migrer-un-projet-supabase
answer: To migrate a Supabase project, first recreate the schema in the target, then copy the tables in foreign-key order and the files bucket by bucket, and finally reset the sequences. User accounts, Edge Functions, secrets and sign-in settings have to be moved separately, and storage files are never part of a database dump.
---

# Migrate a Supabase project to another one

Moving to another organization, starting over from a clean project after a prototype, duplicating a database for testing: one day, you need to copy a Supabase project to another. Here is what to move, in which order, and the pitfalls that make a migration fail.

## What needs to move

A Supabase project is made of several layers, which are not copied the same way:

- **the schema**: tables, constraints, indexes, views, functions, triggers, RLS (row level security) policies and grants;
- **the data**: the rows in your tables;
- **the files**: the contents of the storage buckets;
- **the accounts**: the authentication users, stored in the `auth` schema;
- **everything else**: Edge Functions, secrets, scheduled jobs, sign-in settings (providers, allowed redirect URLs), to be handled separately.

## Two methods

**From the command line.** You export the database (with `pg_dump` or the `supabase db dump` command of the CLI), then restore it into the new project with `psql`. It is the most complete route for the database, but it requires installing tools and having the connection string of both databases. Storage files still have to be copied separately.

**Through the APIs, from the browser.** Each project exposes a REST API (PostgREST) that publishes the description of its tables and keys, and a storage API that lists, downloads and uploads files. That is enough to copy data and files without installing anything. Creating the schema also requires the Supabase Management API.

## The steps of a migration without bad surprises

1. **Prepare the target.** Create the project, or pick an empty one.
2. **Recreate the schema before the data.** A row cannot be inserted into a table that does not exist.
3. **Copy the tables in foreign-key order.** If `members.club_id` points to `clubs.id`, copy `clubs` first, otherwise every member will be rejected.
4. **Copy the files**, bucket by bucket.
5. **Reset the sequences.** This is the most common oversight. You copy 1,250 orders with their ids from 1 to 1,250, but the target's sequence is still at 1. The first order your app creates will ask for id 1 and be rejected. A `setval` fixes it: `select setval(pg_get_serial_sequence('public.orders', 'id'), (select max(id) from public.orders));`
6. **Check**: count the rows on both sides, then switch the URL and keys in your app and test it.

Two more traps during the copy: the target's triggers run and may rewrite what you insert (an `updated_at` column, an audit log), and a `GENERATED ALWAYS` column rejects any value. Those columns must then be left out of the copy.

## How Miss Supatool helps

[Miss Supatool](https://mister-guiiug.github.io/miss-supatool/) is a web app that runs this migration in five steps: Projects, Content, Schema, Copy, Report. Its interface is in French only.

- **Connect both projects**, with the URL and the `service_role` key of each. The tool detects a public key and warns you. If the target does not exist, it can create it, wait for it to start and fetch its key. Creation may be billed depending on your plan: it is confirmed first, and the tool cannot delete a project.
- **Compare the two schemas** and work out the copy order from the foreign keys.
- **Copy the schema**: the source is read in read-only mode, the SQL can be viewed and downloaded, and statements can be replayed without overwriting anything.
- **Copy rows and files**, in dry-run mode by default. A real write only starts after you type the reference of the target project. You choose insert-only or update, the columns to skip, and whether to stop at the first error.
- **Protect the source**: the tool refuses any write request to it before sending, and refuses to copy a project onto itself.
- **Finish cleanly**: a report per table and per bucket, exportable as JSON, and a button that resets the sequences.

Keys are never saved: they stay in memory for the life of the tab. Project creation, schema copy and sequences go through a relay, with your Supabase personal access token.

Supabase is deprecating the `anon` and `service_role` keys by the end of 2026, in favor of `sb_publishable_…` and `sb_secret_…` keys. Miss Supatool recognizes an `sb_secret_…` key but flags it: on a new project, it was not accepted everywhere the same project's `service_role` key was. If calls fail, use the `service_role` key while it still exists.

## What the tool does not copy

- user accounts (`auth.users`): use the Auth admin API or, on a paid plan, restore a backup into a new project, which brings them along;
- anything outside the chosen schema (`public` by default), including storage policies;
- partitioned tables, domains and collations;
- vault secrets, cron jobs and roles;
- file metadata (owner, custom headers). Content and MIME type are preserved.

Files travel through your browser: a very large object may fail. Project creation and schema copy only work with projects hosted by Supabase.

Miss Supatool is an independent app, neither affiliated with nor endorsed by Supabase. Supabase is a trademark of its owner. The French original of this guide is [Migrer un projet Supabase vers un autre](../migrer-un-projet-supabase.html).

## Frequently asked questions

### Can you migrate a Supabase project without the command line?

Yes, for the schema, the data and the files: the Supabase APIs are enough. That is the approach Miss Supatool takes. User accounts and project settings still have to be moved separately.

### Are RLS policies copied?

Yes, along with the schema, for the chosen schema. Storage policies, which live in another schema, have to be replayed separately.

### Why is the service_role key required?

It bypasses RLS: that is what allows reading every row of the source and writing to the target. It therefore opens the whole database. Use it from a trusted device and regenerate it at the slightest doubt. Supabase is deprecating it by the end of 2026, in favor of `sb_secret_…` keys.

### Can the migration damage the source project?

Miss Supatool never writes to it: its client refuses any write request to the source before sending it. And by default, every step starts with a dry run that reads everything and writes nothing.

## References

- [Backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore): `supabase db dump` and `psql`.
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys): the secret key bypasses RLS, legacy keys deprecated by the end of 2026.
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project): user accounts included, storage files not copied.
- [PostgreSQL sequence functions](https://www.postgresql.org/docs/current/functions-sequence.html): `setval`.
