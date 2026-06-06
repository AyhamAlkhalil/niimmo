-- Tabelle zum Verfolgen von versendeten Betriebskostenabrechnungen
-- Dient als Audit-Trail und Doppelversand-Schutz
CREATE TABLE public.nebenkosten_abrechnungen (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mietvertrag_id UUID NOT NULL REFERENCES public.mietvertrag(id) ON DELETE CASCADE,
  abrechnungsjahr INTEGER NOT NULL,

  -- Snapshot der berechneten Werte zum Versandzeitpunkt
  saldo NUMERIC NOT NULL,
  vorauszahlungen NUMERIC NOT NULL,
  kosten_gesamt NUMERIC NOT NULL,

  -- Versand-Tracking
  versandt_am TIMESTAMPTZ,

  -- Audit
  erstellt_am TIMESTAMPTZ DEFAULT now(),
  aktualisiert_am TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT unique_abrechnung_per_mietvertrag_jahr UNIQUE(mietvertrag_id, abrechnungsjahr)
);

ALTER TABLE public.nebenkosten_abrechnungen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admin can access nebenkosten_abrechnungen"
ON public.nebenkosten_abrechnungen FOR ALL
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

CREATE TRIGGER update_nebenkosten_abrechnungen_updated_at
BEFORE UPDATE ON public.nebenkosten_abrechnungen
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_nebenkosten_abrechnungen_mietvertrag
  ON public.nebenkosten_abrechnungen(mietvertrag_id);

CREATE INDEX idx_nebenkosten_abrechnungen_jahr
  ON public.nebenkosten_abrechnungen(abrechnungsjahr);
