import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { UnterzeichnerSpeicherFehler, useBriefunterzeichner } from "@/hooks/useBriefunterzeichner";
import {
  unterschriftAusKontaktname,
  unterzeichnerPruefen,
  type Unterzeichner,
  type UnterzeichnerEintrag,
} from "@/utils/unterzeichner";

interface UnterzeichnerFormularProps {
  offen: boolean;
  /** null = neue Person eintragen */
  eintrag: UnterzeichnerEintrag | null;
  /** Anmelde-E-Mail als Vorschlag, wenn der Angemeldete noch nicht eingetragen ist */
  vorschlagEmail?: string;
  onClose: () => void;
  onGespeichert: (id: string) => void;
  onEntfernt: (id: string) => void;
}

const LEER: Unterzeichner = { kontaktname: "", unterschrift: "", funktion: "", telefon: "", email: "" };

const FELDER: Array<{ feld: keyof Unterzeichner; label: string; beispiel: string; hinweis?: string }> = [
  { feld: "kontaktname", label: "Name im Rückfragenblock", beispiel: "z. B. Frau Maria Muster, M. A." },
  { feld: "unterschrift", label: "Name unter der Unterschrift", beispiel: "z. B. Maria Muster (M. A.)" },
  { feld: "funktion", label: "Funktion", beispiel: "z. B. Hausverwaltung" },
  { feld: "telefon", label: "Telefon", beispiel: "z. B. 05138 - 600 72 70" },
  { feld: "email", label: "E-Mail", beispiel: "z. B. name@niimmo.de", hinweis: "Wer sich mit dieser E-Mail anmeldet, ist im Dialog vorbelegt." },
];

/**
 * Eine Person für Rückfragenblock und Unterschrift eintragen oder ändern (02.11.2026, Kundenwunsch: weitere
 * Personen tragen sich mit ihren Angaben selbst ein). Läuft als Dialog im Dialog; ohne Formularelement, dessen
 * Absenden bis in den umgebenden Dialog durchreichen könnte.
 */
export function UnterzeichnerFormular({ offen, eintrag, vorschlagEmail = "", onClose, onGespeichert, onEntfernt }: UnterzeichnerFormularProps) {
  const { toast } = useToast();
  const { eintraege, speichern, entfernen } = useBriefunterzeichner();
  const [werte, setWerte] = useState<Unterzeichner>(LEER);
  // Folgt der Name unter der Unterschrift dem Rückfragenblock, bis er selbst geändert wird
  const [unterschriftSelbst, setUnterschriftSelbst] = useState(false);
  const [versucht, setVersucht] = useState(false);
  const [entfernenBestaetigen, setEntfernenBestaetigen] = useState(false);
  const [serverFehler, setServerFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!offen) return;
    const start = eintrag
      ? { kontaktname: eintrag.kontaktname, unterschrift: eintrag.unterschrift, funktion: eintrag.funktion, telefon: eintrag.telefon, email: eintrag.email }
      : { ...LEER, email: vorschlagEmail.trim().toLowerCase() };
    setWerte(start);
    setUnterschriftSelbst(!!eintrag && eintrag.unterschrift !== unterschriftAusKontaktname(eintrag.kontaktname));
    setVersucht(false);
    setEntfernenBestaetigen(false);
    setServerFehler(null);
    // Nur beim Öffnen; ein Neuladen der Liste darf laufende Eingaben nicht überschreiben
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);

  const { daten, fehler } = unterzeichnerPruefen(werte, eintraege, eintrag?.id);
  const beschaeftigt = speichern.isPending || entfernen.isPending;

  const aendern = (feld: keyof Unterzeichner, wert: string) => {
    setServerFehler(null);
    setWerte((alt) => {
      const neu = { ...alt, [feld]: wert };
      if (feld === "kontaktname" && !unterschriftSelbst) neu.unterschrift = unterschriftAusKontaktname(wert);
      return neu;
    });
    if (feld === "unterschrift") setUnterschriftSelbst(true);
  };

  const sichern = async () => {
    setVersucht(true);
    if (!daten) return;
    try {
      const id = await speichern.mutateAsync({ id: eintrag?.id, daten });
      toast({ title: "Gespeichert", description: `${daten.unterschrift} kann jetzt unterzeichnen.` });
      onGespeichert(id);
      onClose();
    } catch (e) {
      setServerFehler(e instanceof UnterzeichnerSpeicherFehler ? e.message : "Die Angaben konnten nicht gespeichert werden.");
    }
  };

  const loeschen = async () => {
    if (!eintrag) return;
    if (!entfernenBestaetigen) {
      setEntfernenBestaetigen(true);
      return;
    }
    try {
      await entfernen.mutateAsync(eintrag.id);
      toast({ title: "Entfernt", description: `${eintrag.unterschrift} steht nicht mehr zur Auswahl.` });
      onEntfernt(eintrag.id);
      onClose();
    } catch (e) {
      setServerFehler(e instanceof UnterzeichnerSpeicherFehler ? e.message : "Die Person konnte nicht entfernt werden.");
    }
  };

  return (
    <Dialog open={offen} onOpenChange={(auf) => { if (!auf && !beschaeftigt) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{eintrag ? "Angaben ändern" : "Weitere Person eintragen"}</DialogTitle>
          <DialogDescription>
            So erscheint die Person oben rechts im Rückfragenblock und unter dem Gruß.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {FELDER.map(({ feld, label, beispiel, hinweis }) => (
            <div key={feld}>
              <Label htmlFor={`unterzeichner-${feld}`} className="text-xs">{label}</Label>
              <Input
                id={`unterzeichner-${feld}`}
                className="mt-1 h-9"
                type={feld === "email" ? "email" : "text"}
                value={werte[feld]}
                placeholder={beispiel}
                disabled={beschaeftigt}
                aria-invalid={versucht && !!fehler[feld]}
                onChange={(e) => aendern(feld, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void sichern(); } }}
              />
              {versucht && fehler[feld] ? (
                <p className="text-xs text-destructive mt-1" role="alert">{fehler[feld]}</p>
              ) : hinweis ? (
                <p className="text-xs text-muted-foreground mt-1">{hinweis}</p>
              ) : null}
            </div>
          ))}
          {serverFehler && <p className="text-sm text-destructive" role="alert">{serverFehler}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {eintrag ? (
            <Button type="button" variant={entfernenBestaetigen ? "destructive" : "outline"} onClick={loeschen} disabled={beschaeftigt}>
              {entfernen.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {entfernenBestaetigen ? "Wirklich entfernen" : "Entfernen"}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={beschaeftigt}>Abbrechen</Button>
            <Button type="button" onClick={sichern} disabled={beschaeftigt}>
              {speichern.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
