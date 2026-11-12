-- Besprechung zum Mietvertragsgenerator (12.11.2026): „Zusätzliche PDF-Dateien hochladen und an den Mietvertrag
-- anhängen … die Reihenfolge frei bestimmbar, die Originaldateien vollständig erhalten“. Der Generator hängt sie
-- nach der letzten Vertragsseite an. Weil ein Mietvertrag beliebig oft neu erstellt wird, merkt sich der Vertrag
-- die gewählten Anlagen (Dokumente des Vertrags) in ihrer Reihenfolge; die nächste Fassung beginnt damit.
alter table public.mietvertrag add column if not exists pdf_anlagen uuid[] not null default '{}';

comment on column public.mietvertrag.pdf_anlagen is
  'Dokumente (dokumente.id), die der Generator in dieser Reihenfolge an den Mietvertrag hängt (seit 12.11.2026).';
