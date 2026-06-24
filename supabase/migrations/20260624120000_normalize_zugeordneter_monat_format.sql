-- Normiert zugeordneter_monat von 'YYYY-MM-DD' auf 'YYYY-MM'
-- Ursache: Alter Split-Code hat '-01' angehängt → Trigger-Fehler und fehlerhafte Anzeige
-- Betrifft: Alle zahlungen mit zugeordneter_monat im Format 'YYYY-MM-DD' (10 Zeichen)

UPDATE zahlungen
SET zugeordneter_monat = substring(zugeordneter_monat, 1, 7)
WHERE zugeordneter_monat ~ '^\d{4}-\d{2}-\d{2}$';
