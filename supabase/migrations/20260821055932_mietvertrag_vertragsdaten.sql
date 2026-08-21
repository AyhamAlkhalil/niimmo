-- Vertragsdaten, die fuer die Erzeugung eines Mietvertrags noetig sind.
create type public.vertragsart          as enum ('wohnraum','gewerbe','stellplatz','sonstiges');
create type public.betriebskosten_modus as enum ('vorauszahlung','pauschale','inklusiv');
create type public.uebergabezustand     as enum ('renoviert','teilrenoviert','unrenoviert');
create type public.kaution_art          as enum ('barkaution','buergschaft','verpfaendung','sparbuch','keine');
create type public.mietanpassung_art    as enum ('keine','staffel','index');
create type public.befristungsgrund     as enum ('eigenbedarf','bauliche_massnahme','dienstwohnung');
create type public.schliessanlage_art   as enum ('einzel','zentral');

alter table public.mietvertrag
  -- Weiche fuer die Vorlagenauswahl. einheitentyp taugt dafuer nicht,
  -- weil eine Wohnung auch gewerblich vermietet sein kann.
  add column vertragsart public.vertragsart not null default 'wohnraum',

  -- Loest die Mehrdeutigkeit von betriebskosten = 0.00:
  -- "keine Vorauszahlung", "Pauschale" und "nicht erfasst" waren nicht unterscheidbar.
  add column betriebskosten_modus public.betriebskosten_modus not null default 'vorauszahlung',
  add column heizkosten_vorauszahlung numeric(10,2),

  -- Faelligkeit nach Paragraf 556b Abs. 1 BGB
  add column faelligkeit_werktag smallint not null default 3,

  -- Unterzeichnung. erstellt_am ist der DB-Anlagezeitpunkt, nicht das Vertragsdatum.
  add column vertrag_datum    date,
  add column unterschrift_ort text,

  -- Mietsache
  add column raumaufstellung           text,
  add column zusatzflaechen            text,
  add column mitbenutzung_einrichtungen text,
  add column schluessel                jsonb not null default '{}'::jsonb,
  add column schliessanlage_art        public.schliessanlage_art,
  add column uebergabe_datum           date,

  -- Uebergabezustand steuert nach BGH VIII ZR 185/14, ob eine
  -- Schoenheitsreparaturklausel ueberhaupt gedruckt werden darf.
  add column uebergabezustand      public.uebergabezustand,
  add column uebergabezustand_text text,
  add column schoenheitsreparaturen boolean not null default false,

  add column kleinreparatur_einzelgrenze        numeric(8,2) not null default 100.00,
  add column kleinreparatur_jahresgrenze_prozent numeric(4,2) not null default 8.00,

  add column kaution_art   public.kaution_art not null default 'barkaution',
  add column kaution_raten smallint not null default 3,

  -- SEPA-Lastschriftmandat
  add column sepa_mandatsreferenz text,
  add column sepa_mandat_datum    date,
  add column kontoinhaber         text,
  add column bankkonto_mieter_bic text,

  add column mietanpassung_art public.mietanpassung_art not null default 'keine',
  add column staffelplan       jsonb,
  add column index_basis_wert  numeric(8,2),
  add column index_basis_monat date,

  -- Ohne Befristungsgrund gilt der Vertrag nach Paragraf 575 Abs. 1 S. 2 BGB als unbefristet.
  add column befristungsgrund      public.befristungsgrund,
  add column befristungsgrund_text text,
  add column kuendigungsverzicht_bis date,

  -- Mietpreisbremse
  add column vormiete_netto numeric(10,2),
  add column vormiete_bis   date,
  add column mietpreisbremse_auskunft_am date,

  -- Widerrufsrecht: Besichtigung schliesst es nach Paragraf 312 Abs. 4 S. 2 BGB aus.
  add column besichtigt_am date,

  add column zusatzvereinbarungen text,

  -- Welche Fassung der Vorlage wurde fuer diesen Vertrag verwendet
  add column vorlage_version text;

comment on column public.mietvertrag.betriebskosten is
  'Monatliche Betriebskostenvorauszahlung bzw. Pauschale, je nach betriebskosten_modus.';
comment on column public.mietvertrag.schoenheitsreparaturen is
  'Nur bei uebergabezustand = renoviert zulaessig (CHECK). Unrenoviert uebergebene Wohnung: Klausel waere nach BGH VIII ZR 185/14 insgesamt unwirksam.';
comment on column public.mietvertrag.schluessel is
  'Anzahl je Schluesselart, z. B. {"haustuer":2,"wohnung":2,"briefkasten":1,"keller":1}.';
comment on column public.mietvertrag.staffelplan is
  'Liste von {"gueltig_ab":"YYYY-MM-DD","kaltmiete":000.00}. Geldbetraege, nie Prozent (Paragraf 557a Abs. 1 BGB).';
comment on column public.mietvertrag.vorlage_version is
  'Fassung der Vertragsvorlage, mit der das PDF erzeugt wurde. Macht spaeter nachvollziehbar, welcher Wortlaut galt.';

alter table public.mietvertrag
  add constraint mietvertrag_schoenheitsrep_nur_renoviert
    check (schoenheitsreparaturen = false or uebergabezustand = 'renoviert'),
  add constraint mietvertrag_faelligkeit_werktag_plausibel
    check (faelligkeit_werktag between 1 and 10),
  add constraint mietvertrag_kaution_raten_plausibel
    check (kaution_raten between 1 and 3),
  add constraint mietvertrag_kuendigungsverzicht_max_4_jahre
    check (
      kuendigungsverzicht_bis is null
      or vertrag_datum is null
      or kuendigungsverzicht_bis <= vertrag_datum + interval '4 years'
    );
