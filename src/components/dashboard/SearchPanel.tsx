
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Search, User, Building, ArrowRight, Home, FileText, Shield, Landmark, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { darlehenStand } from "@/utils/darlehenBerechnung";
import { VertragStatusBadge } from "@/components/dashboard/VertragStatusBadge";
import { ilikeInSpalten, suchwoerter } from "@/utils/suchbegriff";

const LEER = { mietvertraege: [], immobilien: [], einheiten: [], versicherungen: [], darlehen: [], dokumente: [] };

/** Jedes Wort in einer der Spalten — mehrere `.or()` verknüpft PostgREST mit UND. */
function jedesWort<Q extends { or: (filter: string) => Q }>(abfrage: Q, spalten: readonly string[], woerter: string[]): Q {
  return woerter.reduce((q, wort) => q.or(ilikeInSpalten(spalten, wort)), abfrage);
}

interface SearchPanelProps {
  onImmobilieSelect: (immobilieId: string, einheitId?: string, tab?: string) => void;
  onMietvertragClick: (mietvertragId: string) => void;
  onDarlehenSelect: () => void;
}

export const SearchPanel = ({ onImmobilieSelect, onMietvertragClick, onDarlehenSelect }: SearchPanelProps) => {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: searchResults, isError: sucheFehler } = useQuery({
    queryKey: ['search', searchTerm],
    queryFn: async () => {
      if (!searchTerm || searchTerm.length < 2) return LEER;

      // Bis zum 28.10.2026 ging der Begriff roh in die or-Filter: „Nachname, Vorname" oder eine Klammer
      // ergab 400, und weil nur `data` gelesen wurde, hieß das „Keine Ergebnisse". Jetzt bereinigt
      // (utils/suchbegriff.ts), und jeder Lesefehler wird geworfen und angezeigt.
      const woerter = suchwoerter(searchTerm);
      if (woerter.length === 0) return LEER;

      // Suche Mieter
      const { data: mieter, error: mieterFehler } = await jedesWort(supabase
        .from('mieter')
        .select(`
          id, vorname, nachname, hauptmail,
          mietvertrag_mieter!inner(
            mietvertrag_id,
            mietvertrag!inner(
              id, status, einheit_id,
              einheiten!inner(
                immobilie_id, etage,
                immobilien!inner(id, name, adresse)
              )
            )
          )
        `), ['vorname', 'nachname', 'hauptmail'], woerter);
      if (mieterFehler) throw mieterFehler;

      // Gruppiere nach Mietvertrag
      const contractMap = new Map<string, any>();
      for (const m of mieter || []) {
        for (const mm of m.mietvertrag_mieter) {
          const vertragId = mm.mietvertrag?.id;
          if (!vertragId) continue;
          if (!contractMap.has(vertragId)) {
            contractMap.set(vertragId, {
              mietvertragId: vertragId,
              status: mm.mietvertrag.status,
              einheit: mm.mietvertrag.einheiten,
              immobilie: mm.mietvertrag.einheiten?.immobilien,
              alleMieter: [],
            });
          }
        }
      }

      // Lade ALLE Mieter für die gefundenen Verträge
      const contractIds = Array.from(contractMap.keys());
      if (contractIds.length > 0) {
        const { data: alleMieterVertraege, error: vertragsmieterFehler } = await supabase
          .from('mietvertrag_mieter')
          .select('mietvertrag_id, mieter(id, vorname, nachname)')
          .in('mietvertrag_id', contractIds);
        if (vertragsmieterFehler) throw vertragsmieterFehler;

        for (const mv of alleMieterVertraege || []) {
          const entry = contractMap.get(mv.mietvertrag_id);
          if (entry && mv.mieter) {
            const mieterData = mv.mieter as any;
            if (!entry.alleMieter.find((x: any) => x.id === mieterData.id)) {
              entry.alleMieter.push({ id: mieterData.id, vorname: mieterData.vorname, nachname: mieterData.nachname });
            }
          }
        }
      }

      const mietvertraege = Array.from(contractMap.values());

      // Suche Immobilien
      const { data: immobilien, error: immobilienFehler } = await jedesWort(supabase
        .from('immobilien')
        .select('id, name, adresse, einheiten_anzahl'), ['name', 'adresse'], woerter);
      if (immobilienFehler) throw immobilienFehler;

      // Suche Einheiten (Zählernummern, Etage)
      const { data: einheiten, error: einheitenFehler } = await jedesWort(supabase
        .from('einheiten')
        .select(`
          id, zaehler, qm, etage, einheitentyp,
          strom_zaehler, gas_zaehler, kaltwasser_zaehler, warmwasser_zaehler,
          immobilie_id,
          immobilien!inner(id, name, adresse)
        `), ['strom_zaehler', 'gas_zaehler', 'kaltwasser_zaehler', 'warmwasser_zaehler', 'etage'], woerter);
      if (einheitenFehler) throw einheitenFehler;

      // Suche Versicherungen
      const { data: versicherungen, error: versicherungenFehler } = await jedesWort(supabase
        .from('versicherungen' as any)
        .select(`
          id, typ, firma, vertragsnummer, kontaktperson, email, telefon, jahresbeitrag, immobilie_id,
          immobilien!inner(id, name, adresse)
        `), ['firma', 'typ', 'vertragsnummer', 'kontaktperson', 'email', 'telefon'], woerter);
      if (versicherungenFehler) throw versicherungenFehler;

      // Suche Darlehen
      // Restschuld heute statt des Stands zum Stichtag (utils/darlehenBerechnung.ts)
      const heute = format(new Date(), 'yyyy-MM-dd');
      const { data: darlehenRoh, error: darlehenFehler } = await jedesWort(supabase
        .from('darlehen')
        .select('id, bezeichnung, bank, kontonummer, darlehensbetrag, restschuld, restschuld_stichtag, zinssatz_prozent, monatliche_rate, ende_datum'),
        ['bezeichnung', 'bank', 'kontonummer'], woerter);
      if (darlehenFehler) throw darlehenFehler;
      const darlehen = (darlehenRoh ?? []).map((d) => ({ ...d, restschuld: darlehenStand(d, heute).restschuld }));

      // Suche Dokumente. Bis zum 07.10.2026 verlangte die Abfrage mit immobilien!inner
      // einen Objektbezug -- 1.386 von 1.502 Dokumenten haengen aber nur am Vertrag
      // und blieben unauffindbar. Das Objekt kommt jetzt wahlweise ueber den Vertrag.
      const { data: dokumente, error: dokumenteFehler } = await jedesWort(supabase
        .from('dokumente')
        .select(`
          id, titel, kategorie, immobilie_id, mietvertrag_id,
          immobilien(id, name),
          mietvertrag(einheiten(immobilien(id, name)))
        `)
        .eq('geloescht', false), ['titel'], woerter)
        .order('hochgeladen_am', { ascending: false })
        .limit(6);
      if (dokumenteFehler) throw dokumenteFehler;

      return {
        mietvertraege,
        immobilien: immobilien || [],
        einheiten: einheiten || [],
        versicherungen: versicherungen || [],
        darlehen: darlehen || [],
        dokumente: dokumente || [],
      };
    },
    enabled: searchTerm.length >= 2,
  });

  const handleMietvertragClick = (mietvertragId: string) => {
    onMietvertragClick(mietvertragId);
    setSearchTerm("");
  };

  const handleImmobilieClick = (immobilieId: string, einheitId?: string, tab?: string) => {
    onImmobilieSelect(immobilieId, einheitId, tab);
    setSearchTerm("");
  };

  const handleDarlehenClick = () => {
    onDarlehenSelect();
    setSearchTerm("");
  };

  const totalResults =
    (searchResults?.mietvertraege?.length ?? 0) +
    (searchResults?.immobilien?.length ?? 0) +
    (searchResults?.einheiten?.length ?? 0) +
    (searchResults?.versicherungen?.length ?? 0) +
    (searchResults?.darlehen?.length ?? 0) +
    (searchResults?.dokumente?.length ?? 0);

  const getFirstResult = () => {
    if (!searchResults) return null;
    if (searchResults.mietvertraege.length > 0) {
      return { type: 'mietvertrag' as const, mietvertragId: searchResults.mietvertraege[0].mietvertragId };
    }
    if (searchResults.einheiten.length > 0) {
      const einheit = searchResults.einheiten[0];
      return { type: 'einheit' as const, immobilieId: einheit.immobilie_id, einheitId: einheit.id };
    }
    if (searchResults.versicherungen.length > 0) {
      const v = searchResults.versicherungen[0] as any;
      return { type: 'versicherung' as const, immobilieId: v.immobilie_id };
    }
    if (searchResults.immobilien.length > 0) {
      return { type: 'immobilie' as const, id: searchResults.immobilien[0].id };
    }
    if (searchResults.darlehen.length > 0) {
      return { type: 'darlehen' as const };
    }
    return null;
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchTerm.length >= 2) {
      const firstResult = getFirstResult();
      if (firstResult) {
        if (firstResult.type === 'mietvertrag' && firstResult.mietvertragId) {
          handleMietvertragClick(firstResult.mietvertragId);
        } else if (firstResult.type === 'einheit') {
          handleImmobilieClick(firstResult.immobilieId, firstResult.einheitId);
        } else if (firstResult.type === 'versicherung') {
          handleImmobilieClick(firstResult.immobilieId, undefined, 'versicherungen');
        } else if (firstResult.type === 'immobilie') {
          handleImmobilieClick(firstResult.id);
        } else if (firstResult.type === 'darlehen') {
          handleDarlehenClick();
        }
      }
    }
  };

  const getStatusBadge = (status: string) => <VertragStatusBadge status={status} />;

  const highlight = (text: string) => {
    if (!text || !searchTerm) return text;
    const idx = text.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="rounded-sm bg-gold-100 px-0.5 text-foreground ring-1 ring-gold-200">{text.slice(idx, idx + searchTerm.length)}</mark>
        {text.slice(idx + searchTerm.length)}
      </>
    );
  };

  return (
    // Suche als große Zeile auf einer Linie, wie das Suchfeld eines Maklerhauses (27.10.2026)
    <section aria-labelledby="suche-titel" className="mb-16">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <h2 id="suche-titel" className="eyebrow">Suche</h2>
        <p className="hidden text-xs text-muted-foreground sm:block">
          <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium text-foreground/80">Enter</kbd> öffnet das erste Ergebnis
        </p>
      </div>
      <div>
        <div className="relative mt-2">
          <Input
            type="text"
            placeholder="Mieter, Immobilie, Zähler, Versicherung, Police, Darlehen, Dokumente …"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyPress={handleKeyPress}
            aria-labelledby="suche-titel"
            className="h-14 rounded-none border-0 border-b border-foreground bg-transparent pl-9 pr-0 text-lg font-light hover:border-foreground focus-visible:border-brand focus-visible:ring-0 md:text-xl"
          />
          <Search className="pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/70" />
        </div>

        {/* Ein Fehler darf nicht wie „Keine Ergebnisse“ aussehen (28.10.2026) */}
        {sucheFehler && searchTerm.length >= 2 && (
          <p role="alert" className="mt-4 border-t pt-4 text-sm text-destructive">
            Die Suche ist fehlgeschlagen. Bitte erneut versuchen.
          </p>
        )}

        {searchResults && !sucheFehler && searchTerm.length >= 2 && (
          <div className="mt-4 space-y-4 max-h-[520px] overflow-y-auto animate-fade-in border-t pt-4">

            {/* Mietverträge */}
            {(searchResults.mietvertraege?.length ?? 0) > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  Mietverträge ({searchResults.mietvertraege.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.mietvertraege.map((vertrag: any) => (
                    <div
                      key={vertrag.mietvertragId}
                      className="rounded-xl border border-border/80 bg-card p-3.5 cursor-pointer transition-[border-color,background-color,box-shadow] duration-200 hover:border-neutral-300 hover:bg-neutral-50/70 hover:shadow-sm"
                      onClick={() => handleMietvertragClick(vertrag.mietvertragId)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-foreground">
                            {vertrag.alleMieter.map((m: any) => `${m.vorname} ${m.nachname}`).join(', ')}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {vertrag.immobilie?.name || 'Unbekannt'}
                            {vertrag.einheit?.etage ? ` · ${vertrag.einheit.etage}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(vertrag.status)}
                          <Badge variant="outline" className="text-xs">
                            {vertrag.immobilie?.name || 'Unbekannt'}
                          </Badge>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Versicherungen */}
            {(searchResults.versicherungen?.length ?? 0) > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <Shield className="h-4 w-4" />
                  Versicherungen ({searchResults.versicherungen.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.versicherungen.map((v: any) => (
                    <div
                      key={v.id}
                      className="rounded-xl border border-border/80 bg-card p-3.5 cursor-pointer transition-[border-color,background-color,box-shadow] duration-200 hover:border-neutral-300 hover:bg-neutral-50/70 hover:shadow-sm"
                      onClick={() => handleImmobilieClick(v.immobilie_id, undefined, 'versicherungen')}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">
                            {highlight(v.typ)}{v.firma ? <span className="text-muted-foreground font-normal"> · {highlight(v.firma)}</span> : null}
                          </p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                            {v.vertragsnummer && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Hash className="h-3 w-3 shrink-0" />
                                {highlight(v.vertragsnummer)}
                              </p>
                            )}
                            {v.kontaktperson && (
                              <p className="text-xs text-muted-foreground">{highlight(v.kontaktperson)}</p>
                            )}
                            {v.email && (
                              <p className="text-xs text-muted-foreground">{highlight(v.email)}</p>
                            )}
                            {v.telefon && (
                              <p className="text-xs text-muted-foreground">{highlight(v.telefon)}</p>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {(v.immobilien as any)?.name || 'Unbekannte Immobilie'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          {v.jahresbeitrag && (
                            <Badge variant="outline" className="text-xs">
                              {Number(v.jahresbeitrag).toLocaleString('de-DE', { minimumFractionDigits: 0 })} €/J.
                            </Badge>
                          )}
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Immobilien */}
            {searchResults.immobilien.length > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <Building className="h-4 w-4" />
                  Immobilien ({searchResults.immobilien.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.immobilien.map((immobilie) => (
                    <div
                      key={immobilie.id}
                      data-immobilie-id={immobilie.id}
                      className="rounded-xl border border-border/80 bg-card p-3.5 cursor-pointer transition-[border-color,background-color,box-shadow] duration-200 hover:border-neutral-300 hover:bg-neutral-50/70 hover:shadow-sm"
                      onClick={() => handleImmobilieClick(immobilie.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-foreground">{highlight(immobilie.name)}</p>
                          <p className="text-sm text-muted-foreground">{highlight(immobilie.adresse)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {immobilie.einheiten_anzahl} Einheiten
                          </Badge>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Einheiten / Zähler */}
            {searchResults.einheiten.length > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <Home className="h-4 w-4" />
                  Einheiten ({searchResults.einheiten.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.einheiten.map((einheit: any) => {
                    const matchedZaehler = [
                      einheit.strom_zaehler?.toLowerCase().includes(searchTerm.toLowerCase()) ? `Strom: ${einheit.strom_zaehler}` : null,
                      einheit.gas_zaehler?.toLowerCase().includes(searchTerm.toLowerCase()) ? `Gas: ${einheit.gas_zaehler}` : null,
                      einheit.kaltwasser_zaehler?.toLowerCase().includes(searchTerm.toLowerCase()) ? `Kaltwasser: ${einheit.kaltwasser_zaehler}` : null,
                      einheit.warmwasser_zaehler?.toLowerCase().includes(searchTerm.toLowerCase()) ? `Warmwasser: ${einheit.warmwasser_zaehler}` : null,
                    ].filter(Boolean);

                    const einheitLabel = einheit.zaehler
                      ? `Einheit ${String(einheit.zaehler).padStart(2, '0')}`
                      : `Einheit ${einheit.id.slice(-2)}`;

                    return (
                      <div
                        key={einheit.id}
                        className="rounded-xl border border-border/80 bg-card p-3.5 cursor-pointer transition-[border-color,background-color,box-shadow] duration-200 hover:border-neutral-300 hover:bg-neutral-50/70 hover:shadow-sm"
                        onClick={() => handleImmobilieClick(einheit.immobilie_id, einheit.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-foreground">
                              {einheitLabel} – {einheit.immobilien?.name || 'Unbekannt'}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {matchedZaehler.length > 0 ? matchedZaehler.join(' · ') : einheit.etage ? `Etage: ${einheit.etage}` : ''}
                              {einheit.qm ? ` · ${einheit.qm} m²` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {einheit.einheitentyp || 'Einheit'}
                            </Badge>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Darlehen */}
            {(searchResults.darlehen?.length ?? 0) > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <Landmark className="h-4 w-4" />
                  Darlehen ({searchResults.darlehen.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.darlehen.map((d: any) => (
                    <div
                      key={d.id}
                      className="rounded-xl border border-border/80 bg-card p-3.5 cursor-pointer transition-[border-color,background-color,box-shadow] duration-200 hover:border-neutral-300 hover:bg-neutral-50/70 hover:shadow-sm"
                      onClick={handleDarlehenClick}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-foreground">{highlight(d.bezeichnung)}</p>
                          <div className="flex gap-3 mt-0.5">
                            {d.bank && (
                              <p className="text-xs text-muted-foreground">{highlight(d.bank)}</p>
                            )}
                            {d.kontonummer && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Hash className="h-3 w-3 shrink-0" />
                                {highlight(d.kontonummer)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {d.restschuld != null && (
                            <Badge variant="outline" className="text-xs">
                              {Number(d.restschuld).toLocaleString('de-DE', { minimumFractionDigits: 0 })} € Restschuld
                            </Badge>
                          )}
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dokumente */}
            {(searchResults.dokumente?.length ?? 0) > 0 && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  Dokumente ({searchResults.dokumente.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.dokumente.map((dok: any) => (
                    <div
                      key={dok.id}
                      className="rounded-xl border border-border/80 bg-card p-3.5 cursor-pointer transition-[border-color,background-color,box-shadow] duration-200 hover:border-neutral-300 hover:bg-neutral-50/70 hover:shadow-sm"
                      onClick={() => {
                        // Vertragsdokumente oeffnen den Vertrag, Objektdokumente den Dokumente-Reiter des Objekts
                        if (dok.mietvertrag_id) handleMietvertragClick(dok.mietvertrag_id);
                        else if (dok.immobilie_id) handleImmobilieClick(dok.immobilie_id, undefined, 'dokumente');
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{highlight(dok.titel)}</p>
                          <p className="text-xs text-muted-foreground">
                            {dok.immobilien?.name || dok.mietvertrag?.einheiten?.immobilien?.name || 'Unbekannte Immobilie'}
                            {dok.kategorie ? ` · ${dok.kategorie}` : ''}
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground ml-2 shrink-0" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {totalResults === 0 && (
              <div className="text-center py-4 text-muted-foreground">
                Keine Ergebnisse gefunden
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
