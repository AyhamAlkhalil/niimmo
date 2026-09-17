import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowLeft, RefreshCw, Search, Activity } from "lucide-react";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";

interface DevActivityLogProps {
  onBack: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  mietvertrag_geaendert: "Vertrag geändert",
  mieterhoehung_dokumentiert: "Mieterhöhung",
  kuendigung_durchgefuehrt: "Kündigung",
  kuendigungsbestaetigung_versendet: "Kündigungsbestätigung",
  kaution_geaendert: "Kaution geändert",
  zahlung_zugeordnet: "Zahlung zugeordnet",
  zahlung_kategorie_geaendert: "Kategorie geändert",
  dokument_hochgeladen: "Dokument Upload",
  mahnung_gesendet: "Mahnung gesendet",
  pdf_generiert: "PDF generiert",
  mietforderung_erstellt: "Forderung erstellt",
  "zählerstand_geaendert": "Zählerstand",
};

const ACTION_COLORS: Record<string, string> = {
  login: "bg-green-100 text-green-800 border-green-200",
  logout: "bg-gray-100 text-gray-700 border-gray-200",
  mietvertrag_geaendert: "bg-blue-100 text-blue-800 border-blue-200",
  mieterhoehung_dokumentiert: "bg-orange-100 text-orange-800 border-orange-200",
  kuendigung_durchgefuehrt: "bg-red-100 text-red-800 border-red-200",
  kaution_geaendert: "bg-yellow-100 text-yellow-800 border-yellow-200",
  zahlung_zugeordnet: "bg-emerald-100 text-emerald-800 border-emerald-200",
  zahlung_kategorie_geaendert: "bg-purple-100 text-purple-800 border-purple-200",
  dokument_hochgeladen: "bg-indigo-100 text-indigo-800 border-indigo-200",
  mahnung_gesendet: "bg-rose-100 text-rose-800 border-rose-200",
  pdf_generiert: "bg-sky-100 text-sky-800 border-sky-200",
  mietforderung_erstellt: "bg-violet-100 text-violet-800 border-violet-200",
};

const FELD_LABELS: Record<string, string> = {
  kaltmiete: "Kaltmiete",
  betriebskosten: "Betriebskosten",
  ruecklastschrift_gebuehr: "RL-Gebühr",
  soll: "Kaution Soll",
  ist: "Kaution Ist",
  start_datum: "Startdatum",
  ende_datum: "Mietende",
  anzahl_personen: "Personenzahl",
  neue_anschrift: "Neue Anschrift",
  bankkonto_mieter: "Bankkonto",
};

function eur(val: unknown): string {
  const n = Number(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function buildSummary(action: string, details: Record<string, unknown> | null): string {
  if (!details) {
    if (action === "login") return "Eingeloggt";
    if (action === "logout") return "Ausgeloggt";
    return "";
  }

  const mieter = details.mieter ? String(details.mieter) : null;
  const prefix = mieter ? `${mieter} — ` : "";

  switch (action) {
    case "mietvertrag_geaendert": {
      if (details.geaenderteFelder && Array.isArray(details.geaenderteFelder)) {
        const felder = (details.geaenderteFelder as string[]).join(", ");
        return `${prefix}Felder geändert: ${felder}`;
      }
      const feld = details.feld ? (FELD_LABELS[String(details.feld)] ?? String(details.feld)) : null;
      if (feld && details.altWert !== undefined && details.neuerWert !== undefined) {
        const istWaehrung = ["kaltmiete", "betriebskosten", "ruecklastschrift_gebuehr"].includes(String(details.feld));
        const fmt = istWaehrung ? eur : (v: unknown) => String(v);
        return `${prefix}${feld}: ${fmt(details.altWert)} → ${fmt(details.neuerWert)}`;
      }
      if (feld && details.neuerWert !== undefined) {
        return `${prefix}${feld} auf ${details.neuerWert} gesetzt`;
      }
      return prefix || "Vertrag aktualisiert";
    }

    case "mieterhoehung_dokumentiert": {
      if (details.altKaltmiete !== undefined && details.neueKaltmiete !== undefined) {
        return `${prefix}Kaltmiete erhöht: ${eur(details.altKaltmiete)} → ${eur(details.neueKaltmiete)}`;
      }
      if (details.neueKaltmiete !== undefined) {
        return `${prefix}Neue Kaltmiete: ${eur(details.neueKaltmiete)}`;
      }
      return `${prefix}Mieterhöhung dokumentiert`;
    }

    case "kaution_geaendert": {
      const feld = details.feld ? (FELD_LABELS[String(details.feld)] ?? String(details.feld)) : "Kaution";
      if (details.altWert !== undefined && details.neuerWert !== undefined) {
        return `${prefix}${feld}: ${eur(details.altWert)} → ${eur(details.neuerWert)}`;
      }
      if (details.neuerWert !== undefined) {
        return `${prefix}${feld} auf ${eur(details.neuerWert)} gesetzt`;
      }
      return `${prefix}Kaution geändert`;
    }

    case "kuendigung_durchgefuehrt": {
      const datum = details.kuendigungsDatum
        ? format(parseISO(String(details.kuendigungsDatum)), "dd.MM.yyyy", { locale: de })
        : null;
      if (mieter && datum) return `${mieter} — Kündigung zum ${datum}`;
      if (mieter) return `${mieter} — Vertrag gekündigt`;
      if (datum) return `Kündigung zum ${datum}`;
      return "Vertrag gekündigt";
    }

    case "kuendigungsbestaetigung_versendet": {
      const anzahl = Number(details.empfaenger);
      if (anzahl === 1) return "Kündigungsbestätigung an 1 Adresse versendet";
      if (anzahl > 1) return `Kündigungsbestätigung an ${anzahl} Adressen versendet`;
      return "Kündigungsbestätigung versendet";
    }

    case "zahlung_zugeordnet": {
      const betrag = details.betrag !== undefined ? eur(details.betrag) : null;
      const empf = details.empfaenger ? String(details.empfaenger) : null;
      const ziel = details.mietvertragId ? "Mietvertrag" : details.immobilieId ? "Immobilie" : null;
      const parts: string[] = [];
      if (betrag) parts.push(betrag);
      if (empf) parts.push(`von ${empf}`);
      if (ziel) parts.push(`→ ${ziel}`);
      return parts.length ? parts.join(" ") : "Zahlung zugeordnet";
    }

    case "zahlung_kategorie_geaendert": {
      if (details.alteKategorie && details.neueKategorie) {
        return `Kategorie: ${details.alteKategorie} → ${details.neueKategorie}`;
      }
      if (details.neueKategorie) return `Neue Kategorie: ${details.neueKategorie}`;
      return "Kategorie geändert";
    }

    case "dokument_hochgeladen": {
      const dateiname = details.dateiname ? String(details.dateiname) : null;
      const kategorie = details.kategorie ? String(details.kategorie) : null;
      if (dateiname && kategorie) return `${dateiname} (${kategorie})`;
      if (dateiname) return dateiname;
      return "Dokument hochgeladen";
    }

    case "mahnung_gesendet": {
      if (details.mieter) return `Mahnung an ${details.mieter}`;
      if (details.empfaenger) return `Mahnung an ${details.empfaenger}`;
      return "Mahnung versendet";
    }

    case "pdf_generiert": {
      if (details.typ) return `PDF: ${details.typ}`;
      return "PDF generiert";
    }

    case "mietforderung_erstellt": {
      if (details.betrag && details.monat) return `${eur(details.betrag)} für ${details.monat}`;
      if (details.betrag) return `Forderung: ${eur(details.betrag)}`;
      return "Mietforderung erstellt";
    }

    case "zählerstand_geaendert": {
      const typ = details.typ ? String(details.typ) : "Zähler";
      if (details.altWert !== undefined && details.neuerWert !== undefined) {
        return `${typ}: ${details.altWert} → ${details.neuerWert}`;
      }
      if (details.neuerWert !== undefined) return `${typ}: ${details.neuerWert}`;
      return "Zählerstand geändert";
    }

    default: {
      const entries = Object.entries(details)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `${k}: ${v}`);
      return entries.join(" · ");
    }
  }
}

export function DevActivityLog({ onBack }: DevActivityLogProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: logs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["activity-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      return data;
    },
  });

  const filtered = logs?.filter((log) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const summary = buildSummary(log.action, log.details as Record<string, unknown> | null);
    return (
      log.action?.toLowerCase().includes(term) ||
      log.user_email?.toLowerCase().includes(term) ||
      log.entity_type?.toLowerCase().includes(term) ||
      summary.toLowerCase().includes(term) ||
      JSON.stringify(log.details ?? {}).toLowerCase().includes(term)
    );
  });

  return (
    <div className="min-h-screen modern-dashboard-bg">
      <div className="container mx-auto px-4 py-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="glass-card p-4 sm:p-6 rounded-xl sm:rounded-2xl mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Zurück
              </Button>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-red-500" />
                <h1 className="text-xl font-bold text-gray-900">Aktivitätenlog</h1>
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                  DEV ONLY
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="shrink-0"
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Aktualisieren
            </Button>
          </div>

          {/* Search */}
          <div className="mt-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Suche nach Aktion, User, Mieter, Betrag..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Stats */}
          <div className="mt-3 flex gap-4 text-sm text-gray-500">
            <span>{logs?.length ?? 0} Einträge total</span>
            {searchTerm && <span>· {filtered?.length ?? 0} gefiltert</span>}
          </div>
        </div>

        {/* Log Table */}
        <div className="glass-card rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center text-gray-500">Lade Logs...</div>
          ) : !filtered?.length ? (
            <div className="p-12 text-center text-gray-400">Keine Einträge gefunden.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/80">
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">Zeitpunkt</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">Aktion</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 whitespace-nowrap">User</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Was passiert ist</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((log, i) => {
                    const summary = buildSummary(
                      log.action,
                      log.details as Record<string, unknown> | null
                    );
                    return (
                      <tr
                        key={log.id}
                        className={`border-b border-gray-100 hover:bg-white/60 transition-colors ${
                          i % 2 === 0 ? "bg-white/20" : "bg-white/40"
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-gray-500 font-mono text-xs">
                          {format(parseISO(log.created_at), "dd.MM.yy HH:mm:ss", { locale: de })}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={`text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}
                          >
                            {ACTION_LABELS[log.action] ?? log.action}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700 text-xs">
                          {log.user_email ?? <span className="text-gray-400 italic">unbekannt</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-xs">
                          {summary ? (
                            <span>{summary}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
