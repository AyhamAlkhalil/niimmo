-- 10.09.2026: Die beiden Projektentwicklungsgesellschaften aus `vermieter` entfernen.
--
-- Die Migration vom 21.08.2026 hatte drei Rechtstraeger aus den Altvertraegen
-- uebernommen. Nur die Wohnungsbaugesellschaft traegt Objekte (13 von 13); die
-- beiden anderen standen seither ungenutzt in der Auswahl der Stammdatenmaske
-- und haetten beim Fehlgriff eine falsche Vertragspartei in den Vertragskopf
-- gebracht. Seit dem 09.09.2026 zeigt die Maske nur noch den Standard.
--
-- `immobilien.vermieter_id` ist der einzige Fremdschluessel auf `vermieter`;
-- die beiden Bedingungen unten sind die Sicherung dagegen, dass hier je eine
-- Gesellschaft mit Bestand oder der Standard selbst geloescht wird.
delete from public.vermieter v
 where v.firmenname in (
         'NiImmo Projektentwicklung & Bau GmbH',
         'NiImmo Projektentwicklung & Bau GmbH & Co. KG'
       )
   and v.ist_standard is distinct from true
   and not exists (select 1 from public.immobilien i where i.vermieter_id = v.id);
