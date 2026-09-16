-- "Met vlag" zoekt over alle mappen: met deze index hoeft de database niet
-- alle mail langs, ook niet in een grote mailbox.
create index if not exists berichten_vlag_idx
  on public.berichten (company_id, ontvangen_op desc)
  where gemarkeerd and deleted_at is null and op_server;
