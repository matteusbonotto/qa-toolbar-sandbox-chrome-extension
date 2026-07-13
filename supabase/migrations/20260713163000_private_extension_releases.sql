insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('extension-releases', 'extension-releases', false, 10485760, array['application/zip'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
