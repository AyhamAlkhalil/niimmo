-- Additiver, taeglicher Korrektur-Check: Tabelle fuer Verdachtsfaelle bei
-- Mietern mit mehreren verbundenen Mietvertraegen (z.B. Wohnung + Garage).
-- Prueft NICHT die Zuordnungslogik von process-payments selbst, sondern
-- markiert nachtraeglich Zahlungen, deren Betrag besser zu einem anderen
-- Vertrag desselben Mieters passt als zum aktuell zugeordneten Vertrag.

CREATE TABLE public.zahlungs_anomalien (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zahlung_id uuid NOT NULL REFERENCES public.zahlungen(id) ON DELETE CASCADE,
  zugeordneter_mietvertrag_id uuid REFERENCES public.mietvertrag(id) ON DELETE SET NULL,
  vermuteter_mietvertrag_id uuid REFERENCES public.mietvertrag(id) ON DELETE SET NULL,
  regel_typ text NOT NULL CHECK (regel_typ IN (
    'betrag_abweichung_verbundener_vertrag',
    'betrag_naeher_bei_verbundenem_vertrag',
    'kaution_abweichung_verbundener_vertrag'
  )),
  betrag numeric NOT NULL,
  zugeordneter_vertrag_diff numeric,
  vermuteter_vertrag_diff numeric NOT NULL,
  begruendung text NOT NULL,
  status text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','geprueft','ignoriert')),
  geprueft_von uuid REFERENCES auth.users(id),
  geprueft_am timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zahlung_id)
);

ALTER TABLE public.zahlungs_anomalien ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zahlungs_anomalien_admin_all" ON public.zahlungs_anomalien
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_zahlungs_anomalien_status_offen
  ON public.zahlungs_anomalien (status) WHERE status = 'offen';

-- Hinweis: public.update_updated_at_column() setzt NEW.aktualisiert_am (deutsche
-- Spaltenkonvention anderer Tabellen wie mietvertrag/nebenkosten_abrechnungen) und
-- ist daher hier NICHT verwendbar, da diese Tabelle "updated_at" (englisch) nutzt.
-- Analog zu bestehenden Tabellen mit "updated_at" (z.B. activity_logs, blacklist)
-- wird eine dedizierte Trigger-Funktion angelegt.
CREATE OR REPLACE FUNCTION public.set_updated_at_zahlungs_anomalien()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_zahlungs_anomalien_updated_at
  BEFORE UPDATE ON public.zahlungs_anomalien
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_zahlungs_anomalien();
