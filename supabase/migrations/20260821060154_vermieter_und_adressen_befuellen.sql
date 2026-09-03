-- Die drei Rechtstraeger, die in den Bestandsvertraegen vorkommen.
-- Alle mit stammdaten_geprueft = false: die Angaben stammen aus dem Code bzw.
-- aus Altvertraegen und sind noch nicht gegen den Handelsregisterauszug abgeglichen.
--
-- Anschrift: In allen 14 ausgewerteten Vertraegen steht "Egestorffstrasse 11, 31319 Sehnde".
-- src/config/company.ts fuehrte abweichend "Egerstorffstrasse 11, 33119 Sehnde" -- die PLZ
-- 33119 liegt im Raum Paderborn, 31319 ist Sehnde. Beides hier korrigiert.
insert into public.vermieter
  (firmenname, rechtsform, strasse, hausnummer, plz, ort,
   vertreten_durch, vertretung_art, registergericht, handelsregister, steuernummer,
   telefon, fax, email, kaution_iban, kaution_bic, ist_standard, stammdaten_geprueft)
values
  ('NiImmo Wohnungsbaugesellschaft mbH', 'GmbH',
   'Egestorffstraße', '11', '31319', 'Sehnde',
   array['Ayhan Yeyrek','Dennis Mikyas'], 'gesamt',
   'Amtsgericht Hildesheim', 'HRB 208151', '16/204/50864',
   '05138 - 600 72 72', '05138 - 600 72 79', 'mikyas@niimmo.de',
   null, null, true, false),

  ('NiImmo Projektentwicklung & Bau GmbH', 'GmbH',
   'Egestorffstraße', '11', '31319', 'Sehnde',
   array['Dennis Baris Mikyas'], 'einzel',
   null, null, null,
   '05138 600 72 70', null, 'info@niimmo.de',
   'DE89255914133155410501', 'GENODEF1BCK', false, false),

  ('NiImmo Projektentwicklung & Bau GmbH & Co. KG', 'GmbH & Co. KG',
   'Egestorffstraße', '11', '31319', 'Sehnde',
   array[]::text[], 'gesamt',
   null, null, null,
   null, null, null, null, null, false, false);

-- Objektadressen atomisieren. Bewusst je Objekt explizit statt per Parsing --
-- das Freitextfeld hat drei verschiedene Formate, darunter eines mit Komma
-- hinter der PLZ und eines mit Ortsteilangabe.
update public.immobilien set plz='38440', ort='Wolfsburg',  strasse='Saarstraße',        hausnummer='37'         where id='00000000-0000-0000-0000-000000000001';
update public.immobilien set plz='29227', ort='Celle',      strasse='Burger Landstraße', hausnummer='18 - 18 e'  where id='00000000-0000-0000-0000-000000000002';
update public.immobilien set plz='30926', ort='Seelze',     strasse='Uferstraße',        hausnummer='18a - 18c'  where id='00000000-0000-0000-0000-000000000003';
update public.immobilien set plz='30161', ort='Hannover',   strasse='Celler Straße',     hausnummer='79'         where id='00000000-0000-0000-0000-000000000004';
update public.immobilien set plz='30851', ort='Langenhagen',strasse='Liebigstraße',      hausnummer='12'         where id='00000000-0000-0000-0000-000000000005';
update public.immobilien set plz='31174', ort='Schellerten',strasse='Feldkamp',          hausnummer='15'         where id='00000000-0000-0000-0000-000000000006';
update public.immobilien set plz='31246', ort='Ilsede',     strasse='Tiefer Weg',        hausnummer='22'         where id='00000000-0000-0000-0000-000000000007';
update public.immobilien set plz='31848', ort='Bad Münder', strasse='Reeke',             hausnummer='9'          where id='00000000-0000-0000-0000-000000000008';
update public.immobilien set plz='31832', ort='Springe',    strasse='Hauptstraße',       hausnummer='20', ortsteil='Bennigsen' where id='00000000-0000-0000-0000-000000000009';
update public.immobilien set plz='31137', ort='Hildesheim', strasse='Peiner Straße',     hausnummer='25'         where id='00000000-0000-0000-0000-000000000010';
update public.immobilien set plz='30989', ort='Gehrden',    strasse='Levester Straße',   hausnummer='6'          where id='00000000-0000-0000-0000-000000000011';
update public.immobilien set plz='30952', ort='Ronnenberg', strasse='Bahnhofstraße',     hausnummer='18'         where id='00000000-0000-0000-0000-000000000012';
update public.immobilien set plz='31157', ort='Sarstedt',   strasse='Habichtweg',        hausnummer='9'          where id='00000000-0000-0000-0000-000000000013';

-- Alle Objekte vorerst dem Standardvermieter zuordnen.
update public.immobilien
   set vermieter_id = (select id from public.vermieter where ist_standard)
 where vermieter_id is null;
