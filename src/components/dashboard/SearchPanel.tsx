
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, User, Building, ArrowRight, Home, FileText, Shield, Landmark, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SearchPanelProps {
  onImmobilieSelect: (immobilieId: string, einheitId?: string, tab?: string) => void;
  onMietvertragClick: (mietvertragId: string) => void;
  onDarlehenSelect: () => void;
}

export const SearchPanel = ({ onImmobilieSelect, onMietvertragClick, onDarlehenSelect }: SearchPanelProps) => {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: searchResults } = useQuery({
    queryKey: ['search', searchTerm],
    queryFn: async () => {
      if (!searchTerm || searchTerm.length < 2) {
        return { mietvertraege: [], immobilien: [], einheiten: [], versicherungen: [], darlehen: [], dokumente: [] };
      }

      const term = searchTerm;

      // Suche Mieter
      const { data: mieter } = await supabase
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
        `)
        .or(`vorname.ilike.%${term}%,nachname.ilike.%${term}%,hauptmail.ilike.%${term}%`);

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
        const { data: alleMieterVertraege } = await supabase
          .from('mietvertrag_mieter')
          .select('mietvertrag_id, mieter(id, vorname, nachname)')
          .in('mietvertrag_id', contractIds);

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
      const { data: immobilien } = await supabase
        .from('immobilien')
        .select('id, name, adresse, einheiten_anzahl')
        .or(`name.ilike.%${term}%,adresse.ilike.%${term}%`);

      // Suche Einheiten (Zählernummern, Etage)
      const { data: einheiten } = await supabase
        .from('einheiten')
        .select(`
          id, zaehler, qm, etage, einheitentyp,
          strom_zaehler, gas_zaehler, kaltwasser_zaehler, warmwasser_zaehler,
          immobilie_id,
          immobilien!inner(id, name, adresse)
        `)
        .or(`strom_zaehler.ilike.%${term}%,gas_zaehler.ilike.%${term}%,kaltwasser_zaehler.ilike.%${term}%,warmwasser_zaehler.ilike.%${term}%,etage.ilike.%${term}%`);

      // Suche Versicherungen
      const { data: versicherungen } = await supabase
        .from('versicherungen' as any)
        .select(`
          id, typ, firma, vertragsnummer, kontaktperson, email, telefon, jahresbeitrag, immobilie_id,
          immobilien!inner(id, name, adresse)
        `)
        .or(`firma.ilike.%${term}%,typ.ilike.%${term}%,vertragsnummer.ilike.%${term}%,kontaktperson.ilike.%${term}%,email.ilike.%${term}%,telefon.ilike.%${term}%`);

      // Suche Darlehen
      const { data: darlehen } = await supabase
        .from('darlehen')
        .select('id, bezeichnung, bank, kontonummer, darlehensbetrag, restschuld')
        .or(`bezeichnung.ilike.%${term}%,bank.ilike.%${term}%,kontonummer.ilike.%${term}%`);

      // Suche Dokumente
      const { data: dokumente } = await supabase
        .from('dokumente')
        .select(`
          id, titel, kategorie, immobilie_id,
          immobilien!inner(id, name)
        `)
        .eq('geloescht', false)
        .ilike('titel', `%${term}%`)
        .limit(6);

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'aktiv':
        return <Badge className="text-xs bg-green-100 text-green-700 border-green-300">aktiv</Badge>;
      case 'gekuendigt':
        return <Badge className="text-xs bg-yellow-100 text-yellow-700 border-yellow-300">gekündigt</Badge>;
      case 'beendet':
        return <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">beendet</Badge>;
      default:
        return null;
    }
  };

  const highlight = (text: string) => {
    if (!text || !searchTerm) return text;
    const idx = text.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + searchTerm.length)}</mark>
        {text.slice(idx + searchTerm.length)}
      </>
    );
  };

  return (
    <Card className="mb-6 elegant-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 font-sans">
          <Search className="h-5 w-5" />
          Suche
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <Input
            type="text"
            placeholder="Mieter, Immobilie, Zähler, Versicherung, Police, Darlehen, Dokumente... (Enter für erstes Ergebnis)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyPress={handleKeyPress}
            className="pl-10 modern-input font-sans"
          />
          <Search className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
        </div>

        {searchResults && searchTerm.length >= 2 && (
          <div className="mt-4 space-y-4 max-h-[520px] overflow-y-auto animate-fade-in border-t pt-4">

            {/* Mietverträge */}
            {(searchResults.mietvertraege?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Mietverträge ({searchResults.mietvertraege.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.mietvertraege.map((vertrag: any) => (
                    <div
                      key={vertrag.mietvertragId}
                      className="p-3 bg-background border border-border rounded-lg hover:shadow-md hover:border-primary/30 transition-all cursor-pointer transform hover:scale-[1.02]"
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
                <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Versicherungen ({searchResults.versicherungen.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.versicherungen.map((v: any) => (
                    <div
                      key={v.id}
                      className="p-3 bg-background border border-border rounded-lg hover:shadow-md hover:border-primary/30 transition-all cursor-pointer transform hover:scale-[1.02]"
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
                <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  Immobilien ({searchResults.immobilien.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.immobilien.map((immobilie) => (
                    <div
                      key={immobilie.id}
                      data-immobilie-id={immobilie.id}
                      className="p-3 bg-background border border-border rounded-lg hover:shadow-md hover:border-primary/30 transition-all cursor-pointer transform hover:scale-[1.02]"
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
                <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
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
                        className="p-3 bg-background border border-border rounded-lg hover:shadow-md hover:border-primary/30 transition-all cursor-pointer transform hover:scale-[1.02]"
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
                <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <Landmark className="h-4 w-4" />
                  Darlehen ({searchResults.darlehen.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.darlehen.map((d: any) => (
                    <div
                      key={d.id}
                      className="p-3 bg-background border border-border rounded-lg hover:shadow-md hover:border-primary/30 transition-all cursor-pointer transform hover:scale-[1.02]"
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
                <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Dokumente ({searchResults.dokumente.length})
                </h4>
                <div className="space-y-2">
                  {searchResults.dokumente.map((dok: any) => (
                    <div
                      key={dok.id}
                      className="p-3 bg-background border border-border rounded-lg hover:shadow-md hover:border-primary/30 transition-all cursor-pointer transform hover:scale-[1.02]"
                      onClick={() => dok.immobilie_id && handleImmobilieClick(dok.immobilie_id, undefined, 'dokumente')}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{highlight(dok.titel)}</p>
                          <p className="text-xs text-muted-foreground">
                            {(dok.immobilien as any)?.name || 'Unbekannte Immobilie'}
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
      </CardContent>
    </Card>
  );
};
