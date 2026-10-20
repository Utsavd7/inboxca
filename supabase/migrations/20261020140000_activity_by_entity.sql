-- A client's Activity tab, a document's timeline and undo find their log entries by the record
-- they are about. With only the firm and time index this read the firm's whole log: 180 ms
-- at half a million entries, growing with the firm's history; with this index, about 1 ms.
create index activity_log_entity on public.activity_log (entity_id, at desc);
