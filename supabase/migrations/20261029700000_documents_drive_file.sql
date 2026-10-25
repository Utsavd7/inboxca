-- The Documents folder view finds which files in a drive folder InboxCA filed by their drive
-- file id, a page of a folder at a time.
create index if not exists documents_drive_file on public.documents (firm_id, drive_file_id);
