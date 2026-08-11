# Migrationen

Dieser Ordner wurde am 11.08.2026 geleert. Die 118 Altmigrationen waren
eingespielt, ihre Tracking-Einträge in `supabase_migrations.schema_migrations`
aber lückenhaft — ein `supabase db push` hätte sechs von ihnen erneut gefahren.

**Maßgeblich für das Schema ist ab jetzt die Live-Datenbank**
(Projekt `kmtgzrnpitlslivdvlyq`). Der letzte Stand mit vollständiger Historie
liegt im Commit `892bb30`:

```bash
git show 892bb30:supabase/migrations/<datei>.sql      # einzelne Datei ansehen
git checkout 892bb30 -- supabase/migrations/          # alle wiederherstellen
```

## Neue Migrationen

Datei hier anlegen (`<YYYYMMDDHHMMSS>_<name>.sql`) und **gezielt** einspielen —
per MCP `apply_migration` oder im SQL-Editor. Nach dem Einspielen über den
SQL-Editor den Tracking-Eintrag nachziehen, sonst läuft die Historie erneut
auseinander:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('<version>', '<name>') ON CONFLICT (version) DO NOTHING;
```

Beim Ändern bestehender DB-Funktionen gibt es im Repo keine Vorlage mehr —
die aktuelle Definition zuerst aus der Live-DB holen (`pg_get_functiondef`)
und darauf aufbauen, statt sie aus dem Gedächtnis neu zu schreiben.
