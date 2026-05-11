-- Add extracted_text column to proposals for OCR/extracted PDF text
alter table public.proposals
  add column if not exists extracted_text text;

-- Optional index for quick lookups by contract
create index if not exists proposals_extracted_text_contract_id_idx on public.proposals using btree (contract_id);
