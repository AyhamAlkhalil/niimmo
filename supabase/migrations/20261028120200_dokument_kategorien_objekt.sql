-- 28.10.2026: Fehlende Dokumentkategorien der Objekt-Dokumente.
--
-- Befund: ImmobilienDocumentsTab bietet sieben Kategorien an, im Enum
-- public.kategorie gab es live nur zwei davon (Mietvertrag, Sonstiges). Bei den
-- anderen gelang der Storage-Upload, das Einfügen in dokumente scheiterte mit
-- 22P02 und die Datei blieb verwaist im Bucket.
--
-- Live-Enum am 28.10.2026: Mietvertrag | Kündigung | Übergabeprotokoll |
-- Sonstiges | Mieterunterlagen | Schriftverkehr | Versicherungen |
-- Betriebskostenabrechnung. „Versicherung“ wird deshalb NICHT angelegt — die
-- Oberfläche nutzt jetzt den vorhandenen Wert „Versicherungen“ (wie der Reiter
-- Versicherungen). Angelegt werden nur die vier Werte ohne Gegenstück, in der
-- Schreibweise der UI-Liste.
--
-- ADD VALUE lässt sich nicht zurücknehmen; IF NOT EXISTS macht die Migration
-- wiederholbar. Die neuen Werte werden in dieser Transaktion nicht benutzt.

alter type public.kategorie add value if not exists 'Kaufvertrag';
alter type public.kategorie add value if not exists 'Grundbuchauszug';
alter type public.kategorie add value if not exists 'Energieausweis';
alter type public.kategorie add value if not exists 'Rechnung';
