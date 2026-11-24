-- Zählerarten je Objekt (Kundenmeldungen 07.11.2026 „im Obj 11 Gehrden haben wir zwei Wasserzähler, keinen
-- zentralen Gaszähler … selbst auswählen … bei den Stammdaten des Objektes“ und 23.11.2026 „dass ich auswählen
-- kann, welche Sachen ich hier stehen haben will … die haben zum Beispiel keinen Warmwasserzähler“).
--
-- Bis dahin schalteten hat_strom/hat_gas/hat_wasser den Hausanschluss UND die Spalten der Einheiten zugleich,
-- und „Wasser“ nahm Kalt- und Warmwasser nur gemeinsam weg. Ohne zentralen Gaszähler verschwand so auch die
-- Gasspalte der Wohnungen, die je einen eigenen Gaszähler haben. Ein zweiter Hausanschlusszähler erschien nur,
-- wenn schon Daten dafür vorlagen, und ließ sich nicht anlegen.
--
-- Seither:
-- - hat_strom/hat_gas/hat_wasser gelten nur noch für den Hausanschluss.
-- - hausanschluss_zweiter_zaehler: Hausanschlüsse mit zweitem Zähler (allgemein_<typ>_*_2).
-- - zaehlerarten_einheiten: Zählerarten, die die Einheiten des Objekts haben.

alter table public.immobilien
  add column if not exists zaehlerarten_einheiten text[] not null
    default array['kaltwasser', 'warmwasser', 'strom', 'gas']::text[],
  add column if not exists hausanschluss_zweiter_zaehler text[] not null default '{}'::text[];

alter table public.immobilien
  drop constraint if exists immobilien_zaehlerarten_einheiten_gueltig,
  add constraint immobilien_zaehlerarten_einheiten_gueltig
    check (zaehlerarten_einheiten <@ array['kaltwasser', 'warmwasser', 'strom', 'gas']::text[]),
  drop constraint if exists immobilien_hausanschluss_zweiter_zaehler_gueltig,
  add constraint immobilien_hausanschluss_zweiter_zaehler_gueltig
    check (hausanschluss_zweiter_zaehler <@ array['wasser', 'strom', 'gas']::text[]);

-- Bisheriges Verhalten übernehmen: Was hat_* bei den Einheiten ausblendete, bleibt ausgeblendet ...
update public.immobilien
set zaehlerarten_einheiten = array(
  select typ
  from unnest(array['kaltwasser', 'warmwasser', 'strom', 'gas']::text[]) with ordinality as t(typ, pos)
  where (typ in ('kaltwasser', 'warmwasser') and hat_wasser)
     or (typ = 'strom' and hat_strom)
     or (typ = 'gas' and hat_gas)
  order by pos
)
where not (hat_wasser and hat_strom and hat_gas);

-- ... und ein vorhandener zweiter Satz bleibt sichtbar (Stand 24.11.2026: nur Objekt 6, alle drei Arten).
update public.immobilien
set hausanschluss_zweiter_zaehler = array(
  select typ
  from (values
    (1, 'wasser', allgemein_wasser_zaehler_2 is not null or allgemein_wasser_stand_2 is not null),
    (2, 'strom', allgemein_strom_zaehler_2 is not null or allgemein_strom_stand_2 is not null),
    (3, 'gas', allgemein_gas_zaehler_2 is not null or allgemein_gas_stand_2 is not null)
  ) as v(pos, typ, vorhanden)
  where vorhanden
  order by pos
)
where coalesce(allgemein_wasser_zaehler_2, allgemein_strom_zaehler_2, allgemein_gas_zaehler_2) is not null
   or coalesce(allgemein_wasser_stand_2, allgemein_strom_stand_2, allgemein_gas_stand_2) is not null;

comment on column public.immobilien.zaehlerarten_einheiten is
  'Zählerarten der Einheiten dieses Objekts (kaltwasser, warmwasser, strom, gas); seit 24.11.2026.';
comment on column public.immobilien.hausanschluss_zweiter_zaehler is
  'Hausanschlüsse mit zweitem Zähler (wasser, strom, gas; Felder allgemein_<typ>_*_2); seit 24.11.2026.';
comment on column public.immobilien.hat_wasser is
  'Hausanschluss hat einen Wasserzähler. Seit 24.11.2026 nur noch Hausanschluss, Einheiten: zaehlerarten_einheiten.';
comment on column public.immobilien.hat_strom is
  'Hausanschluss hat einen Stromzähler. Seit 24.11.2026 nur noch Hausanschluss, Einheiten: zaehlerarten_einheiten.';
comment on column public.immobilien.hat_gas is
  'Hausanschluss hat einen Gaszähler. Seit 24.11.2026 nur noch Hausanschluss, Einheiten: zaehlerarten_einheiten.';
