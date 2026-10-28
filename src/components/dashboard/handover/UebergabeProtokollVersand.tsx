import { useEffect, useMemo, useRef, useState } from "react";
import { format, parse, isValid } from "date-fns";
import { de } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, FilePlus2, FileText, Gauge, Loader2, Mail, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { dokumentOeffnen } from "@/lib/dokumentOeffnen";
import { mieterName as namenText } from "@/utils/benutzerName";
import { mietsacheText } from "@/utils/uebergabeAblauf";
import type { UebergabeArt } from "@/utils/uebergabeProtokolle";
import {
  protokolleEinesVertrags,
  uebergabeDatumFuer,
  versandStand,
  versorgerStaende,
  type VersandProtokoll,
} from "@/utils/uebergabeVersand";
import { useUebergabeVersand, uebergabeVersandKey, type UebergabeVersandDaten } from "@/hooks/useUebergabeVersand";
import { UebergabeAbschluss } from "./UebergabeAbschluss";
import { UebergabeEmailDialog } from "./UebergabeEmailDialog";
import { VersorgerBenachrichtigungDialog } from "./VersorgerBenachrichtigungDialog";

interface UebergabeProtokollVersandProps {
  isOpen: boolean;
  onClose: () => void;
  mietvertragId: string;
  /** Art aus dem Zusammenhang (Übergabe-Liste) — bestimmt die Vorauswahl */
  art?: UebergabeArt | null;
  /** Vorauswahl eines bestimmten Protokolls (Zeile im Dokumente-Tab) */
  pfad?: string | null;
  /** Nur aus der Übergabe-Liste: statt zu versenden ein neues Protokoll erfassen */
  onNeuesProtokoll?: () => void;
}

const ART_TEXT: Record<UebergabeArt, string> = { einzug: "Einzug", auszug: "Auszug" };

const tagText = (iso: string) => {
  const d = parse(iso, "yyyy-MM-dd", new Date());
  return isValid(d) ? format(d, "dd.MM.yyyy", { locale: de }) : iso;
};

/**
 * Nachträglicher Versand eines gespeicherten Übergabeprotokolls (seit 28.10.2026).
 *
 * Bis dahin ließen sich Mail an den Mieter und Benachrichtigung der Versorger nur
 * direkt nach dem Speichern verschicken; nach dem Schließen des Übergabe-Dialogs gab
 * es keinen Weg mehr, und ein Klick auf den Vertrag begann ein neues, leeres Protokoll.
 * Diese Hülle lädt alles aus der Datenbank, lässt das Protokoll wählen, zeigt aus dem
 * Mail-Protokoll, an wen es schon ging, und verwendet die beiden Mail-Dialoge des
 * Übergabe-Dialogs unverändert — so gibt es Texte, Prüfungen und Versand nur einmal.
 */
export const UebergabeProtokollVersand = ({ isOpen, onClose, mietvertragId, art = null, pfad = null, onNeuesProtokoll }: UebergabeProtokollVersandProps) => {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, isFetching, refetch } = useUebergabeVersand(mietvertragId, isOpen);

  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  // Art je Protokoll, wo sie im Namen fehlt (Scans) — Pflicht vor dem Versand, geraten wird nicht
  const [artWahl, setArtWahl] = useState<Record<string, UebergabeArt>>({});
  const [zeigeMail, setZeigeMail] = useState(false);
  const [zeigeVersorger, setZeigeVersorger] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);

  const { liste, vorauswahl } = useMemo(
    () => (data ? protokolleEinesVertrags(data.protokolle, art, pfad) : { liste: [] as VersandProtokoll[], vorauswahl: null }),
    [data, art, pfad]
  );
  // Vorauswahl erst, wenn geladen ist; eine eigene Wahl bleibt beim Neuladen stehen
  useEffect(() => {
    if (!gewaehlt || !liste.some((p) => p.pfad === gewaehlt)) setGewaehlt(vorauswahl);
  }, [gewaehlt, liste, vorauswahl]);

  const protokoll = liste.find((p) => p.pfad === gewaehlt) ?? null;

  const vorschau = async (p: string) => {
    setHinweis(null);
    // dokumentOeffnen öffnet das Fenster noch im Klick (Safari blockiert es sonst)
    if (!(await dokumentOeffnen(p))) setHinweis("Das Protokoll ließ sich nicht öffnen. Falls der Browser Pop-ups blockiert, bitte für diese Seite erlauben.");
  };

  const nachVersand = () => {
    queryClient.invalidateQueries({ queryKey: uebergabeVersandKey(mietvertragId) });
    queryClient.invalidateQueries({ queryKey: ["mails"] });
  };

  let inhalt: React.ReactNode;
  if (isLoading) {
    inhalt = (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Protokolle werden geladen …
      </div>
    );
  } else if (isError && !data) {
    inhalt = (
      <div role="alert" className="space-y-3 py-4">
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Protokolle, Mieter oder der bisherige Versand konnten nicht geladen werden. Ob schon versendet wurde, ist deshalb unbekannt.
        </p>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RotateCcw className="h-4 w-4" />
          Erneut laden
        </Button>
      </div>
    );
  } else if (!data) {
    inhalt = <p className="py-4 text-sm text-muted-foreground">Der Vertrag wurde nicht gefunden.</p>;
  } else if (liste.length === 0) {
    inhalt = <p className="py-4 text-sm text-muted-foreground">Zu diesem Vertrag ist kein Übergabeprotokoll als PDF gespeichert.</p>;
  } else {
    inhalt = (
      <VersandInhalt
        daten={data}
        liste={liste}
        protokoll={protokoll}
        onWahl={(p) => setGewaehlt(p)}
        artWahl={artWahl}
        onArtWahl={(p, a) => setArtWahl((vorher) => ({ ...vorher, [p]: a }))}
        onVorschau={vorschau}
        onMail={() => setZeigeMail(true)}
        onVersorger={() => setZeigeVersorger(true)}
        onNeuLaden={() => refetch()}
        aktualisierungFehlgeschlagen={isError}
        laedtNeu={isFetching}
        zeigeMail={zeigeMail}
        zeigeVersorger={zeigeVersorger}
        onMailZu={() => setZeigeMail(false)}
        onVersorgerZu={() => setZeigeVersorger(false)}
        onVersendet={nachVersand}
      />
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(offen) => !offen && onClose()}>
      <DialogContent size="md" className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
            Übergabeprotokoll versenden
          </DialogTitle>
          <DialogDescription>
            {data
              ? [data.mieter.map((m) => namenText(m)).filter(Boolean).join(", "), [data.vertrag.immobilie.name, data.vertrag.einheit.etage].filter(Boolean).join(", ")]
                  .filter(Boolean)
                  .join(" · ")
              : "Gespeichertes Protokoll an Mieter und Versorger senden"}
          </DialogDescription>
        </DialogHeader>

        {inhalt}

        {hinweis && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {hinweis}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {onNeuesProtokoll && (
            <Button variant="outline" onClick={onNeuesProtokoll}>
              <FilePlus2 className="h-4 w-4" />
              Neues Protokoll erfassen
            </Button>
          )}
          <Button onClick={onClose}>Schließen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface VersandInhaltProps {
  daten: UebergabeVersandDaten;
  liste: VersandProtokoll[];
  protokoll: VersandProtokoll | null;
  onWahl: (pfad: string) => void;
  artWahl: Record<string, UebergabeArt>;
  onArtWahl: (pfad: string, art: UebergabeArt) => void;
  onVorschau: (pfad: string) => void;
  onMail: () => void;
  onVersorger: () => void;
  onNeuLaden: () => void;
  aktualisierungFehlgeschlagen: boolean;
  laedtNeu: boolean;
  zeigeMail: boolean;
  zeigeVersorger: boolean;
  onMailZu: () => void;
  onVersorgerZu: () => void;
  onVersendet: () => void;
}

const VersandInhalt = ({
  daten,
  liste,
  protokoll,
  onWahl,
  artWahl,
  onArtWahl,
  onVorschau,
  onMail,
  onVersorger,
  onNeuLaden,
  aktualisierungFehlgeschlagen,
  laedtNeu,
  zeigeMail,
  zeigeVersorger,
  onMailZu,
  onVersorgerZu,
  onVersendet,
}: VersandInhaltProps) => {
  const { vertrag, mieter, versorger, ablesungen, mails } = daten;
  // Rückfrage vor dem Senden, wenn ein früherer Lauf nie abgeschlossen wurde; je Protokoll und Ziel einmal
  const [rueckfrage, setRueckfrage] = useState<"mail" | "versorger" | null>(null);
  const [bestaetigt, setBestaetigt] = useState<Set<string>>(() => new Set());
  const mieterAdressen = useMemo(() => mieter.map((m) => m.hauptmail ?? "").filter(Boolean), [mieter]);

  // Versandstand je Protokoll — für die Auswahl und den Abschluss
  const staende = useMemo(
    () => new Map(liste.map((p) => [p.pfad, versandStand(mails.filter((m) => m.anhang_pfad === p.pfad), mieterAdressen, versorger)] as const)),
    [liste, mails, mieterAdressen, versorger]
  );

  const pfad = protokoll?.pfad ?? null;
  const art = protokoll ? protokoll.art ?? artWahl[protokoll.pfad] ?? null : null;
  const datum = protokoll ? uebergabeDatumFuer(protokoll, ablesungen) : null;
  const datumIso = datum?.datum ?? null;
  const uebergabeDatum = useMemo(() => (datumIso ? parse(datumIso, "yyyy-MM-dd", new Date()) : null), [datumIso]);
  // Stabil halten: Der Versorger-Dialog baut seine Texte beim ersten Öffnen aus diesen Werten
  const zaehlerstaende = useMemo(() => (pfad ? versorgerStaende(ablesungen, pfad, vertrag.id) : {}), [ablesungen, pfad, vertrag.id]);
  const stand = pfad ? staende.get(pfad) : undefined;

  const mieterName = mieter.map((m) => namenText(m)).filter(Boolean).join(", ");
  // Nur der eigene Vertrag: Die Function prüft, dass das Protokoll an ihm eingetragen ist
  const contracts = useMemo(
    () => [{ id: vertrag.id, einheit: { etage: vertrag.einheit.etage, immobilie: { name: vertrag.immobilie.name, adresse: vertrag.immobilie.adresse } } }],
    [vertrag]
  );
  const einheitBezeichnung =
    mietsacheText({
      einheitentyp: vertrag.einheit.einheitentyp,
      etage: vertrag.einheit.etage,
      anzahlZimmer: vertrag.einheit.anzahl_zimmer,
      qm: vertrag.einheit.qm,
      bezeichnung: vertrag.einheit.bezeichnung,
    }) ||
    vertrag.einheit.etage ||
    undefined;
  const bereitsVersendet = useMemo(
    () => (stand && stand.mieter.adressen.length > 0 ? { adressen: stand.mieter.adressen, am: stand.mieter.am ?? new Date() } : null),
    [stand]
  );
  const bereitsZugestellt = useMemo(
    () => Object.fromEntries(Object.entries(stand?.versorger ?? {}).map(([typ, v]) => [typ, v.adressen])),
    [stand]
  );

  const versandBereit = !!protokoll && !!art && !!uebergabeDatum && isValid(uebergabeDatum);
  // Auswahlknöpfe auch bei einem einzigen Protokoll, wenn nichts vorgewählt ist (andere Art)
  const mitAuswahl = liste.length > 1 || !protokoll;
  // Texte und Versandstand der Mail-Dialoge gehören zu genau einem Protokoll und einer Art
  const dialogSchluessel = `${pfad}|${art}`;

  // Gescheitertes Aktualisieren: Der angezeigte Stand kann veraltet sein — ein Versand jetzt
  // könnte doppelt gehen. Gesperrt bis „Erneut laden“ gelingt (28.10.2026).
  const gesperrt = aktualisierungFehlgeschlagen;
  const oeffnen = (was: "mail" | "versorger") => {
    if (gesperrt) return;
    if (stand && stand.unklar > 0 && pfad && !bestaetigt.has(`${pfad}|${was}`)) {
      setRueckfrage(was);
      return;
    }
    if (was === "mail") onMail();
    else onVersorger();
  };
  // Der Mail-Dialog öffnet erst, wenn die Rückfrage ganz geschlossen ist (onCloseAutoFocus).
  // Im selben Takt geöffnet, verwechselte Radix die Ebenen: „Abbrechen“ im Mail-Dialog
  // schloss im Browser-Durchlauf vom 28.10.2026 einmal auch die Hülle.
  const nachRueckfrage = useRef<"mail" | "versorger" | null>(null);
  const trotzdemSenden = () => {
    const was = rueckfrage;
    if (!was || !pfad) return;
    setBestaetigt((vorher) => new Set(vorher).add(`${pfad}|${was}`));
    nachRueckfrage.current = was;
    setRueckfrage(null);
  };
  const rueckfrageZu = (ereignis: Event) => {
    const was = nachRueckfrage.current;
    nachRueckfrage.current = null;
    if (!was) return;
    ereignis.preventDefault();
    if (was === "mail") onMail();
    else onVersorger();
  };

  return (
    <div className="space-y-5">
      {aktualisierungFehlgeschlagen && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Aktualisieren fehlgeschlagen — der Versandstand ist möglicherweise nicht aktuell. Versenden ist gesperrt, bis er neu geladen ist.
          </span>
          <Button variant="outline" size="sm" className="h-8" onClick={onNeuLaden} disabled={laedtNeu}>
            {laedtNeu ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Erneut laden
          </Button>
        </div>
      )}

      <section className="space-y-2">
        <p className="eyebrow">{liste.length > 1 ? `${liste.length} Protokolle — welches?` : "Protokoll"}</p>
        <RadioGroup value={pfad ?? ""} onValueChange={onWahl} className="gap-2">
          {liste.map((p) => {
            const d = uebergabeDatumFuer(p, ablesungen);
            const s = staende.get(p.pfad);
            const mitStaenden = ablesungen.some((a) => a.protokoll_pfad === p.pfad);
            const id = `protokoll-${p.pfad}`;
            const versorgerFertig = Object.keys(s?.versorger ?? {}).length;
            return (
              <div
                key={p.pfad}
                className={cn("flex items-start gap-3 rounded-md border p-3", p.pfad === pfad ? "border-foreground" : "border-border")}
              >
                {mitAuswahl && <RadioGroupItem value={p.pfad} id={id} className="mt-1" />}
                <Label htmlFor={mitAuswahl ? id : undefined} className="min-w-0 flex-1 cursor-pointer space-y-1 font-normal">
                  <span className="flex flex-wrap items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{p.art ? `${ART_TEXT[p.art]}sprotokoll` : "Übergabeprotokoll (Art unbekannt)"}</span>
                    {d && (
                      <span className="text-muted-foreground">
                        {d.quelle === "hochgeladen" ? `hochgeladen am ${tagText(d.datum)}` : `vom ${tagText(d.datum)}`}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Gauge className="h-3 w-3" />
                      {mitStaenden ? "mit Zählerständen" : "ohne erfasste Zählerstände"}
                    </span>
                    <span className={cn(s?.mieter.beliefert && "text-success")}>
                      {s?.mieter.beliefert ? "Mieter informiert" : s && s.mieter.adressen.length > 0 ? "nur in Kopie versendet" : "an Mieter nicht versendet"}
                    </span>
                    {versorgerFertig > 0 && <span className="text-success">Versorger: {versorgerFertig} benachrichtigt</span>}
                  </span>
                </Label>
                <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={() => onVorschau(p.pfad)} aria-label="Protokoll ansehen">
                  <Eye className="h-4 w-4" />
                  <span className="hidden sm:inline">Vorschau</span>
                </Button>
              </div>
            );
          })}
        </RadioGroup>
        {!protokoll && (
          <p className="text-sm text-muted-foreground">Kein Protokoll der gesuchten Art vorhanden — bitte das zu versendende Protokoll wählen.</p>
        )}
      </section>

      {protokoll && !protokoll.art && (
        <section className="space-y-2" aria-label="Art des Protokolls">
          <p className="text-sm font-medium">Einzug oder Auszug?</p>
          <p className="text-xs text-muted-foreground">
            Der Dateiname nennt die Art nicht. Sie bestimmt Betreff und Text der Mails — bitte anhand der Vorschau wählen.
          </p>
          <div className="flex gap-2">
            {(["einzug", "auszug"] as const).map((a) => (
              <Button
                key={a}
                variant={art === a ? "default" : "outline"}
                aria-pressed={art === a}
                onClick={() => onArtWahl(protokoll.pfad, a)}
                className="h-10"
              >
                {ART_TEXT[a]}
              </Button>
            ))}
          </div>
        </section>
      )}

      {datum?.quelle === "hochgeladen" && (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Im Protokoll ist kein Übergabedatum hinterlegt. Die Mails nennen den Tag des Hochladens ({tagText(datum.datum)}) — bitte Betreff und
          Text vor dem Senden prüfen.
        </p>
      )}
      {protokoll && !datum && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Zu diesem Protokoll ist kein Datum bekannt; der Versand ist hier nicht möglich.
        </p>
      )}
      {stand && stand.unklar > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Ein früherer Versand dieses Protokolls wurde nicht abgeschlossen. Ob er angekommen ist, ist unbekannt (siehe Mails).
        </p>
      )}

      {versandBereit && stand && (
        <UebergabeAbschluss
          isEinzug={art === "einzug"}
          mieterVorhanden={mieter.length > 0}
          mailVersendetAn={stand.mieter.adressen}
          mailVersendetAm={stand.mieter.am}
          mieterBeliefert={stand.mieter.beliefert}
          onMail={() => oeffnen("mail")}
          versorger={versorger}
          benachrichtigt={stand.benachrichtigt}
          onVersorger={() => oeffnen("versorger")}
          ladefehler={{ mieter: false, versorger: false }}
          onNeuLaden={onNeuLaden}
          aktionenGesperrt={gesperrt}
        />
      )}

      <AlertDialog open={!!rueckfrage} onOpenChange={(offen) => !offen && setRueckfrage(null)}>
        <AlertDialogContent onCloseAutoFocus={rueckfrageZu}>
          <AlertDialogHeader>
            <AlertDialogTitle>Früherer Versand unklar</AlertDialogTitle>
            <AlertDialogDescription>
              Ein früherer Versand dieses Protokolls wurde nicht abgeschlossen. Ob er angekommen ist, ist unbekannt (siehe Mails). Trotzdem
              senden?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={trotzdemSenden}>Trotzdem senden</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Erst eingehängt, wenn alles geladen ist: Die Dialoge bauen Adressen und Texte beim Einhängen */}
      {versandBereit && mieter.length > 0 && (
        <UebergabeEmailDialog
          key={`mail|${dialogSchluessel}`}
          isOpen={zeigeMail}
          onClose={onMailZu}
          isEinzug={art === "einzug"}
          mieter={mieter}
          contracts={contracts}
          uebergabeDatum={uebergabeDatum!}
          mieterName={mieterName}
          pdfPfad={protokoll!.pfad}
          bereitsVersendet={bereitsVersendet}
          onVersendet={onVersendet}
        />
      )}
      {versandBereit && vertrag.immobilie.id && (
        <VersorgerBenachrichtigungDialog
          key={`versorger|${dialogSchluessel}`}
          isOpen={zeigeVersorger}
          onClose={onVersorgerZu}
          immobilieId={vertrag.immobilie.id}
          mieterName={mieterName}
          uebergabeDatum={uebergabeDatum!}
          zaehlerstaende={zaehlerstaende}
          adresse={vertrag.immobilie.adresse}
          einheitBezeichnung={einheitBezeichnung}
          isEinzug={art === "einzug"}
          contractIds={[vertrag.id]}
          pdfPfad={protokoll!.pfad}
          bereitsZugestellt={bereitsZugestellt}
          onVersendet={onVersendet}
        />
      )}
    </div>
  );
};
