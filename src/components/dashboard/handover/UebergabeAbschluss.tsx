import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Circle, Download, Mail, RotateCcw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Versorger {
  typ: string;
  label: string;
  name: string;
  email: string;
}

interface UebergabeAbschlussProps {
  isEinzug: boolean;
  /**
   * Gerade gespeichert: zeigt den Kopf „Protokoll gespeichert“ mit Download. Beim
   * nachträglichen Versand (seit 28.10.2026) fehlt er — dort wählt die Hülle das Protokoll.
   */
  gespeichertAm?: Date;
  onDownload?: () => void;
  /** Mieter mit Datensatz — ohne gibt es keinen Mailversand */
  mieterVorhanden: boolean;
  mailVersendetAn: string[];
  /** Zeitpunkt der letzten Mieter-Mail, wenn er nicht von heute sein muss (nachträglicher Versand) */
  mailVersendetAm?: Date | null;
  /** Ein Mieter selbst hat die Mail; sonst kam höchstens eine CC-Kopie an */
  mieterBeliefert: boolean;
  onMail: () => void;
  versorger: Versorger[];
  benachrichtigt: Set<string>;
  onVersorger: () => void;
  /** Mieter- oder Versorgerdaten ließen sich nicht laden — kein „nicht hinterlegt“ behaupten */
  ladefehler: { mieter: boolean; versorger: boolean };
  onNeuLaden: () => void;
  /**
   * Versandknöpfe sperren, solange der angezeigte Versandstand nicht gesichert ist
   * (nachträglicher Versand, Aktualisieren gescheitert — 28.10.2026): Sonst ginge eine
   * zweite Mail an Empfänger, die sie längst haben.
   */
  aktionenGesperrt?: boolean;
}

const Ladefehler = ({ was, onNeuLaden }: { was: string; onNeuLaden: () => void }) => (
  <div className="space-y-2">
    <p className="flex items-start gap-1.5 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      Die {was} konnten nicht geladen werden.
    </p>
    <Button variant="outline" size="sm" onClick={onNeuLaden} className="h-9">
      <RotateCcw className="h-4 w-4" />
      Erneut laden
    </Button>
  </div>
);

/**
 * Nach dem Speichern: was noch zu tun ist, mit Stand je Empfänger. Bis zum
 * 20.10.2026 standen hier nur Knöpfe — ob die Mail an den Mieter oder an die
 * Stadtwerke schon raus war, ließ sich nicht ablesen.
 */
export const UebergabeAbschluss = ({
  isEinzug,
  gespeichertAm,
  onDownload,
  mieterVorhanden,
  mailVersendetAn,
  mailVersendetAm,
  mieterBeliefert,
  onMail,
  versorger,
  benachrichtigt,
  onVersorger,
  ladefehler,
  onNeuLaden,
  aktionenGesperrt = false,
}: UebergabeAbschlussProps) => {
  const mitAdresse = versorger.filter((v) => v.email);
  const offen = mitAdresse.filter((v) => !benachrichtigt.has(v.typ));
  const versendetAm = mailVersendetAm ? ` am ${format(mailVersendetAm, "dd.MM.yyyy, HH:mm")} Uhr` : "";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {gespeichertAm && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="h-12 w-12 text-success" />
          <h3 className="text-lg font-semibold">Protokoll gespeichert</h3>
          <p className="text-sm text-muted-foreground">
            {isEinzug ? "Einzug" : "Auszug"} · gespeichert um {format(gespeichertAm, "HH:mm")} Uhr. Das Protokoll liegt mit allen
            Fotos beim Vertrag unter Dokumente.
          </p>
          {onDownload && (
            <Button variant="outline" onClick={onDownload} className="mt-1 h-11">
              <Download className="h-4 w-4" />
              PDF herunterladen
            </Button>
          )}
        </div>
      )}

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">Mieter informieren</p>
            {/* Bis zum 23.10.2026 stand bei einem Ladefehler „kein Mieter hinterlegt“ */}
            {ladefehler.mieter && mailVersendetAn.length === 0 ? (
              <Ladefehler was="Mieterdaten" onNeuLaden={onNeuLaden} />
            ) : mailVersendetAn.length > 0 && mieterBeliefert ? (
              <p className="flex items-start gap-1.5 break-all text-sm text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                Versendet an {mailVersendetAn.join(", ")}
                {versendetAm}
              </p>
            ) : mailVersendetAn.length > 0 ? (
              // Bis zum 24.10.2026 galt eine angekommene CC-Kopie als „Mieter informiert“
              <p className="flex items-start gap-1.5 break-all text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Versendet an {mailVersendetAn.join(", ")}
                {versendetAm} — der Mieter selbst hat die Mail noch nicht.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {mieterVorhanden ? "Noch nicht versendet." : "Zu diesem Vertrag ist kein Mieter mit Datensatz hinterlegt."}
              </p>
            )}
          </div>
        </div>
        {mieterVorhanden && (
          <Button variant="outline" onClick={onMail} disabled={aktionenGesperrt} className="h-11 w-full">
            <Mail className="h-4 w-4" />
            {mailVersendetAn.length > 0 ? "E-Mail erneut senden" : "E-Mail senden"}
          </Button>
        )}
      </section>

      {ladefehler.versorger && versorger.length === 0 && (
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <Zap className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-medium">Versorger {isEinzug ? "Anmeldung" : "Abmeldung"}</p>
              <Ladefehler was="Versorgerdaten" onNeuLaden={onNeuLaden} />
            </div>
          </div>
        </section>
      )}

      {versorger.length > 0 && (
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <Zap className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-medium">Versorger {isEinzug ? "Anmeldung" : "Abmeldung"}</p>
              <ul className="space-y-1.5">
                {versorger.map((v) => {
                  const erledigt = benachrichtigt.has(v.typ);
                  return (
                    <li key={v.typ} className="flex items-start gap-2 text-sm">
                      {erledigt ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="font-medium">{v.label}</span>
                        {v.name && <span className="text-muted-foreground"> · {v.name}</span>}
                        <span className={cn("block text-xs", erledigt ? "text-success" : "text-muted-foreground")}>
                          {!v.email ? "keine Mailadresse hinterlegt" : erledigt ? "benachrichtigt" : "noch nicht benachrichtigt"}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          {mitAdresse.length > 0 && (
            <Button variant="outline" onClick={onVersorger} disabled={aktionenGesperrt} className="h-11 w-full">
              <Zap className="h-4 w-4" />
              {offen.length > 0 ? "Versorger benachrichtigen" : "Weitere Benachrichtigung senden"}
            </Button>
          )}
        </section>
      )}
    </div>
  );
};
