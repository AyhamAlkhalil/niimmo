import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, ArrowLeft, Box, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import MietvertragDetailsModal from "@/components/dashboard/MietvertragDetailsModal";
import { NewTenantContractDialog } from "@/components/dashboard/NewTenantContractDialog";
import { EinheitHistorieView } from "@/components/dashboard/EinheitHistorieView";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAnsicht3dDaten, type EinheitZeile3D, type VertragZeile3D } from "@/hooks/useAnsicht3dDaten";
import { bereichsname, bereichsrang, etageLesen } from "@/utils/ansicht3d/etageLesen";
import { objektModell } from "@/utils/ansicht3d/objektModell";
import { einheitenNummern, kennzahlen, parteiZustand } from "@/utils/ansicht3d/parteiStatus";
import { quartierAnordnen, type Quartier } from "@/utils/ansicht3d/quartier";
import { Ankerregister } from "./Beschriftungen3D";
import type { KameraZiel } from "./Kamera3D";
import type { ObjektSzene } from "./Objekt3D";
import { Szene3D, type Zeigerziel } from "./Szene3D";
import { Seitenleiste3D } from "./Seitenleiste3D";
import { Aktualisierungsfehler, Bedienhinweis, Kontextverlust, Legende3D, ObjektSchilder, ParteiMarken, Werkzeuge3D, Zeigerinfo } from "./Ueberlagerungen3D";
import { STIMMUNGEN, type Tageszeit } from "./szene3dHilfen";
import type { ImmobilieZeile, ObjektAnsicht, Partei } from "./ansicht3dTypen";

export interface Ansicht3DProps {
  immobilien: ImmobilieZeile[];
  istAdmin: boolean;
  /** Objekt im Fokus; liegt im Navigationszustand, damit es den Weg über die Objektseite übersteht. */
  fokusId: string | null;
  onFokus: (immobilieId: string | null) => void;
  /** Zurück zur Kachelansicht. */
  onZurueck: () => void;
  /** Klassische Objektseite öffnen, optional mit Sprung zur Einheit. */
  onObjektseite: (immobilieId: string, einheitId?: string) => void;
}

const KEIN_ZIEL: Zeigerziel = { immobilieId: null, einheitId: null };
const SPEICHER_TAGESZEIT = "niimmo-3d-tageszeit";
const SPEICHER_HINWEIS = "niimmo-3d-hinweis";
const SPEICHER_AUFBAU = "niimmo-3d-aufgebaut";
const LEISTE_BREITE = 416;

function lesen(speicher: () => Storage, schluessel: string): string | null {
  try {
    return speicher().getItem(schluessel);
  } catch {
    return null;
  }
}

function schreiben(speicher: () => Storage, schluessel: string, wert: string): void {
  try {
    speicher().setItem(schluessel, wert);
  } catch {
    // Privater Modus o. Ä.: dann eben ohne Gedächtnis.
  }
}

let webglErgebnis: boolean | null = null;

/** Prüft einmal je Seitenaufruf; der Probe-Kontext wird sofort freigegeben (Browser erlauben nur wenige). */
function webglVerfuegbar(): boolean {
  if (webglErgebnis !== null) return webglErgebnis;
  try {
    const leinwand = document.createElement("canvas");
    const kontext = leinwand.getContext("webgl2") ?? leinwand.getContext("webgl");
    kontext?.getExtension("WEBGL_lose_context")?.loseContext();
    webglErgebnis = Boolean(kontext);
  } catch {
    webglErgebnis = false;
  }
  return webglErgebnis;
}

function useFenstergroesse() {
  const [groesse, setGroesse] = useState(() => ({ breite: window.innerWidth, hoehe: window.innerHeight }));
  useEffect(() => {
    const aktualisieren = () => setGroesse({ breite: window.innerWidth, hoehe: window.innerHeight });
    window.addEventListener("resize", aktualisieren);
    return () => window.removeEventListener("resize", aktualisieren);
  }, []);
  return groesse;
}

/**
 * Kameraabstand, bei dem ein Bereich (halbe Breite/Tiefe, Höhe) in den freien Teil des Bildes
 * passt — also neben die Seitenleiste bzw. über die ausgeklappte Liste.
 */
function passenderAbstand(halbBreite: number, halbTiefe: number, hoehe: number, polar: number, frei: { breite: number; hoehe: number }, vollHoehe: number, fov: number): number {
  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * (frei.breite / vollHoehe);
  const tanVFrei = tanV * (frei.hoehe / vollHoehe);
  const projiziert = halbTiefe * Math.cos(polar) + hoehe * 0.5 * Math.sin(polar);
  return Math.max(halbBreite / tanH, projiziert / tanVFrei);
}

function uebersichtZiel(quartier: Quartier, frei: { breite: number; hoehe: number }, vollHoehe: number, fov: number): KameraZiel {
  const polar = 0.84;
  // Die vordere Reihe liegt näher an der Kamera und erscheint größer; dafür der Zuschlag. Im
  // Hochformat darf der Rand knapp werden — sonst bliebe das Quartier briefmarkengroß.
  const zuschlag = frei.breite < frei.hoehe ? 1.0 : 1.2;
  const abstand = passenderAbstand(quartier.breite / 2, quartier.tiefe / 2, 4, polar, frei, vollHoehe, fov) * zuschlag;
  return { ziel: [0, 0, quartier.tiefe * 0.06], abstand, polar, azimut: 0.24 };
}

function fokusZiel(objekt: ObjektAnsicht, frei: { breite: number; hoehe: number }, vollHoehe: number, fov: number): KameraZiel {
  const polar = 1.0;
  const halb = Math.max(objekt.modell.breite, objekt.modell.tiefe) / 2;
  const zuschlag = frei.breite < frei.hoehe ? 1.0 : 1.38;
  const abstand = Math.max(9, passenderAbstand(halb, halb, objekt.modell.hoehe, polar, frei, vollHoehe, fov) * zuschlag);
  return { ziel: [objekt.platz.x, objekt.modell.hoehe * 0.32, objekt.platz.z], abstand, polar, azimut: 0.45 };
}

export default function Ansicht3D({ immobilien, istAdmin, fokusId, onFokus, onZurueck, onObjektseite }: Ansicht3DProps) {
  const daten = useAnsicht3dDaten(istAdmin);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const reduziert = useMediaQuery("(prefers-reduced-motion: reduce)");
  const groesse = useFenstergroesse();
  const webgl = useMemo(() => webglVerfuegbar(), []);
  const register = useMemo(() => new Ankerregister(), []);
  useEffect(() => () => register.trennen(), [register]);

  const [tageszeit, setTageszeit] = useState<Tageszeit>(() => (lesen(() => localStorage, SPEICHER_TAGESZEIT) === "abend" ? "abend" : "tag"));
  const [hover, setHover] = useState<Zeigerziel>(KEIN_ZIEL);
  const [hoverAusSzene, setHoverAusSzene] = useState(false);
  const [auswahlId, setAuswahlId] = useState<string | null>(null);
  const [vertragDialog, setVertragDialog] = useState<{ vertragId: string; partei: Partei } | null>(null);
  const [verlaufFuer, setVerlaufFuer] = useState<Partei | null>(null);
  const [neuerVertragFuer, setNeuerVertragFuer] = useState<Partei | null>(null);
  const [listeOffen, setListeOffen] = useState(true);
  const [kontextVerloren, setKontextVerloren] = useState(false);
  const [szenenSchluessel, setSzenenSchluessel] = useState(0);
  const [kameraZaehler, setKameraZaehler] = useState(0);
  const [hinweis, setHinweis] = useState(() => lesen(() => sessionStorage, SPEICHER_HINWEIS) !== "1");

  const letzterTreffer = useRef(-1);
  const zieht = useRef(false);
  const infoRef = useRef<HTMLDivElement>(null);
  const flaecheRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------------------
  // Ansichtsmodell: Parteien mit Zustand, Modell je Objekt, Lage im Quartier.
  // ---------------------------------------------------------------------------------------
  // Gebäude hängen nur an den Einheiten; ein neuer Rückstands- oder Mieterstand baut sie nicht neu.
  const modelle = useMemo(() => {
    if (!daten.einheiten) return null;
    const jeObjekt = new Map<string, EinheitZeile3D[]>();
    for (const e of daten.einheiten) {
      if (!e.immobilie_id) continue;
      jeObjekt.set(e.immobilie_id, [...(jeObjekt.get(e.immobilie_id) ?? []), e]);
    }
    const karte = new Map<string, { einheiten: EinheitZeile3D[]; modell: ReturnType<typeof objektModell> }>();
    for (const immobilie of immobilien) {
      const einheiten = jeObjekt.get(immobilie.id) ?? [];
      const modell = objektModell(
        einheiten.map((e) => ({ id: e.id, etage: e.etage, einheitentyp: e.einheitentyp, qm: e.qm === null ? null : Number(e.qm) })),
        immobilie.objekttyp,
        immobilie.id
      );
      karte.set(immobilie.id, { einheiten, modell });
    }
    const quartier = quartierAnordnen(immobilien.map((i) => ({ id: i.id, breite: karte.get(i.id)!.modell.breite, tiefe: karte.get(i.id)!.modell.tiefe })));
    return { karte, quartier, nummern: einheitenNummern(daten.einheiten.filter((e) => e.immobilie_id)) };
  }, [daten.einheiten, immobilien]);

  const ansicht = useMemo(() => {
    if (!modelle || !daten.vertraege) return null;
    const stichtag = new Date();
    const vertraegeJeEinheit = new Map<string, VertragZeile3D[]>();
    for (const v of daten.vertraege) {
      if (!v.einheit_id) continue;
      vertraegeJeEinheit.set(v.einheit_id, [...(vertraegeJeEinheit.get(v.einheit_id) ?? []), v]);
    }
    const { karte, quartier, nummern } = modelle;

    const roh = immobilien.map((immobilie) => {
      const { einheiten, modell } = karte.get(immobilie.id)!;
      let summe = 0;
      let anzahl = 0;
      const parteien: Partei[] = einheiten
        .map((einheit) => {
          const vertraege = vertraegeJeEinheit.get(einheit.id) ?? [];
          const zustand = parteiZustand(vertraege, stichtag);
          const lage = etageLesen(einheit.etage, einheit.einheitentyp, einheit.qm === null ? null : Number(einheit.qm));
          const massgeblich = zustand.vertrag ?? zustand.oeffnen;
          let frueher = 0;
          for (const v of vertraege) {
            const offen = daten.rueckstandJeVertrag.get(v.id);
            if (!offen) continue;
            summe += offen.betrag;
            anzahl += 1;
            if (v.id !== massgeblich?.id) frueher += offen.betrag;
          }
          return {
            einheit,
            immobilieId: immobilie.id,
            nummer: nummern.get(einheit.id) ?? 0,
            lage,
            bereich: bereichsname(lage),
            rang: bereichsrang(lage),
            zustand,
            mieter: zustand.vertrag ? daten.mieterJeVertrag.get(zustand.vertrag.id) ?? [] : [],
            rueckstand: massgeblich ? daten.rueckstandJeVertrag.get(massgeblich.id) ?? null : null,
            rueckstandFrueher: frueher,
          };
        })
        .sort((a, b) => a.rang - b.rang || (a.lage.spalte ?? 1) - (b.lage.spalte ?? 1) || a.nummer - b.nummer);
      return { immobilie, modell, parteien, kennzahlen: kennzahlen(parteien.map((p) => p.zustand)), rueckstand: { summe, anzahl } };
    });

    const plaetze = new Map(quartier.plaetze.map((p) => [p.id, p]));
    const objekte: ObjektAnsicht[] = roh.map((o) => ({ ...o, platz: plaetze.get(o.immobilie.id)! }));
    const szene: ObjektSzene[] = objekte.map((o, i) => ({
      id: o.immobilie.id,
      modell: o.modell,
      x: o.platz.x,
      z: o.platz.z,
      status: new Map(o.parteien.map((p) => [p.einheit.id, p.zustand.status])),
      rueckstand: new Set(o.parteien.filter((p) => p.rueckstand || p.rueckstandFrueher > 0).map((p) => p.einheit.id)),
      reihenfolge: i,
    }));
    const parteien = new Map(objekte.flatMap((o) => o.parteien.map((p) => [p.einheit.id, p] as const)));
    return { objekte, quartier, szene, parteien };
  }, [modelle, daten.vertraege, daten.mieterJeVertrag, daten.rueckstandJeVertrag, immobilien]);

  const fokus = useMemo(() => ansicht?.objekte.find((o) => o.immobilie.id === fokusId) ?? null, [ansicht, fokusId]);
  const auswahl = auswahlId ? ansicht?.parteien.get(auswahlId) ?? null : null;

  // Ein Fokus auf ein Objekt, das es nicht mehr gibt, wird verworfen.
  useEffect(() => {
    if (ansicht && fokusId && !fokus) onFokus(null);
  }, [ansicht, fokusId, fokus, onFokus]);

  // Die Aufbau-Animation läuft einmal je Sitzung. Entschieden wird beim ersten Rendern der Szene,
  // nicht in einem Effekt danach — sonst hat die Kamera ihr erstes Ziel schon ohne Einflug gesetzt.
  const bereit = ansicht !== null;
  const mitAufbau = useMemo(() => bereit && !reduziert && lesen(() => sessionStorage, SPEICHER_AUFBAU) !== "1", [bereit, reduziert]);
  useEffect(() => {
    if (mitAufbau) schreiben(() => sessionStorage, SPEICHER_AUFBAU, "1");
  }, [mitAufbau]);

  // ---------------------------------------------------------------------------------------
  // Kamera: Ziel je nach Fokus, Bildausschnitt neben Seitenleiste bzw. über der Liste.
  // ---------------------------------------------------------------------------------------
  const leisteHoehe = desktop ? 0 : listeOffen ? Math.min(groesse.hoehe * 0.48, 470) : 84;
  const versatz = useMemo(() => ({ x: desktop ? -LEISTE_BREITE / 2 : 0, y: leisteHoehe / 2 }), [desktop, leisteHoehe]);
  const fov = groesse.breite < groesse.hoehe ? 46 : 32;
  const kamera = useMemo<KameraZiel | null>(() => {
    if (!ansicht) return null;
    const frei = { breite: groesse.breite - (desktop ? LEISTE_BREITE : 0), hoehe: groesse.hoehe - leisteHoehe };
    return fokus ? fokusZiel(fokus, frei, groesse.hoehe, fov) : uebersichtZiel(ansicht.quartier, frei, groesse.hoehe, fov);
  }, [ansicht, fokus, groesse.breite, groesse.hoehe, desktop, leisteHoehe, fov]);
  const kameraSchluessel = `${fokusId ?? "alle"}:${kameraZaehler}`;

  // ---------------------------------------------------------------------------------------
  // Bedienung
  // ---------------------------------------------------------------------------------------
  const dialogOffen = Boolean(vertragDialog || verlaufFuer || neuerVertragFuer);

  const fokussieren = useCallback(
    (id: string | null) => {
      setAuswahlId(null);
      setHover(KEIN_ZIEL);
      onFokus(id);
    },
    [onFokus]
  );

  const vertragOeffnen = useCallback((partei: Partei) => {
    const vertrag = partei.zustand.oeffnen;
    if (vertrag) setVertragDialog({ vertragId: vertrag.id, partei });
  }, []);

  /** Klick auf eine Partei: auswählen und — wenn es einen Vertrag gibt — die Detailansicht öffnen. */
  const parteiWaehlen = useCallback(
    (einheitId: string) => {
      setAuswahlId(einheitId);
      const partei = ansicht?.parteien.get(einheitId);
      if (partei && partei.zustand.status !== "leer") vertragOeffnen(partei);
    },
    [ansicht, vertragOeffnen]
  );

  const szenenKlick = useCallback(
    (immobilieId: string, einheitId: string | null) => {
      if (immobilieId !== fokusId) {
        fokussieren(immobilieId);
        return;
      }
      if (einheitId) parteiWaehlen(einheitId);
      else setAuswahlId(null);
    },
    [fokusId, fokussieren, parteiWaehlen]
  );

  const szenenZeiger = useCallback((immobilieId: string, einheitId: string | null, zeitstempel: number) => {
    if (zieht.current) return;
    letzterTreffer.current = zeitstempel;
    setHoverAusSzene(true);
    setHover((alt) => (alt.immobilieId === immobilieId && alt.einheitId === einheitId ? alt : { immobilieId, einheitId }));
  }, []);

  const listenHover = useCallback((ziel: Zeigerziel) => {
    setHoverAusSzene(false);
    setHover((alt) => (alt.immobilieId === ziel.immobilieId && alt.einheitId === ziel.einheitId ? alt : ziel));
  }, []);

  /** Läuft nach der Szene: Hat in diesem Ereignis kein Objekt den Zeiger gemeldet, ist nichts getroffen. */
  const flaechenZeiger = (e: ReactPointerEvent<HTMLDivElement>) => {
    const info = infoRef.current;
    const flaeche = flaecheRef.current;
    if (info && flaeche) {
      const rand = flaeche.getBoundingClientRect();
      const x = e.clientX - rand.left;
      const y = e.clientY - rand.top;
      const links = x + 18 + info.offsetWidth > rand.width ? x - info.offsetWidth - 14 : x + 18;
      const oben = y + 18 + info.offsetHeight > rand.height ? y - info.offsetHeight - 14 : y + 18;
      info.style.transform = `translate3d(${Math.max(8, links)}px, ${Math.max(8, oben)}px, 0)`;
    }
    if (e.target instanceof HTMLCanvasElement && e.timeStamp !== letzterTreffer.current && !zieht.current) {
      setHover((alt) => (alt.immobilieId === null ? alt : KEIN_ZIEL));
    }
  };

  const hinweisSchliessen = useCallback(() => {
    setHinweis(false);
    schreiben(() => sessionStorage, SPEICHER_HINWEIS, "1");
  }, []);

  const bedient = useCallback(() => {
    if (hinweis) hinweisSchliessen();
  }, [hinweis, hinweisSchliessen]);

  const ziehen = useCallback((aktiv: boolean) => {
    zieht.current = aktiv;
    if (aktiv) setHover(KEIN_ZIEL);
  }, []);

  const tageszeitWechseln = () => {
    const neu: Tageszeit = tageszeit === "tag" ? "abend" : "tag";
    setTageszeit(neu);
    schreiben(() => localStorage, SPEICHER_TAGESZEIT, neu);
  };

  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || dialogOffen) return;
      if (auswahlId) setAuswahlId(null);
      else if (fokusId) fokussieren(null);
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [dialogOffen, auswahlId, fokusId, fokussieren]);

  const dialogGeschlossen = () => {
    // Im Dialog kann sich der Vertrag geändert haben (Kündigung, neue Miete, neuer Vertrag).
    daten.neuLaden();
  };

  // ---------------------------------------------------------------------------------------
  // Zustände ohne Szene
  // ---------------------------------------------------------------------------------------
  const hintergrund = { background: STIMMUNGEN[tageszeit].hintergrund };

  if (!webgl) {
    return (
      <Hinweisseite stil={hintergrund} titel="3D-Darstellung nicht verfügbar" text="Dieser Browser oder dieses Gerät unterstützt keine 3D-Grafik (WebGL). Die Übersicht als Kacheln funktioniert weiterhin." onZurueck={onZurueck} />
    );
  }
  if (daten.fehler) {
    return (
      <Hinweisseite
        stil={hintergrund}
        titel="Daten konnten nicht geladen werden"
        text="Einheiten oder Mietverträge ließen sich nicht abrufen. Es wird nichts angezeigt, solange die Daten unvollständig sind."
        fehler
        onZurueck={onZurueck}
        onWiederholen={daten.neuLaden}
      />
    );
  }
  if (daten.laedt || !ansicht || !kamera) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4" style={hintergrund}>
        <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/90 px-5 py-4 shadow-xl backdrop-blur-md">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">3D-Ansicht wird aufgebaut …</span>
        </div>
      </div>
    );
  }
  if (ansicht.objekte.length === 0) {
    return <Hinweisseite stil={hintergrund} titel="Keine Immobilien vorhanden" text="Sobald ein Objekt angelegt ist, erscheint es hier als Gebäude." onZurueck={onZurueck} />;
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden" style={hintergrund}>
      <div
        ref={flaecheRef}
        className="absolute inset-0"
        onPointerMove={flaechenZeiger}
        onPointerLeave={() => setHover((alt) => (hoverAusSzene && alt.immobilieId !== null ? KEIN_ZIEL : alt))}
        style={{ cursor: hover.immobilieId && hoverAusSzene ? "pointer" : "grab" }}
      >
        <div className="absolute inset-0" role="img" aria-label={`3D-Modell von ${ansicht.objekte.length} Objekten. Die Liste daneben enthält dieselben Objekte und Parteien als Knöpfe.`}>
        <Szene3D
          key={szenenSchluessel}
          objekte={ansicht.szene}
          quartier={ansicht.quartier}
          stimmung={STIMMUNGEN[tageszeit]}
          fokusId={fokusId}
          hover={hover}
          auswahlEinheit={auswahlId}
          aufbau={mitAufbau}
          kamera={kamera}
          kameraSchluessel={kameraSchluessel}
          versatz={versatz}
          fov={fov}
          reduziert={reduziert}
          register={register}
          onZeiger={szenenZeiger}
          onKlick={szenenKlick}
          onBedienung={bedient}
          onZiehen={ziehen}
          onKontextVerloren={() => setKontextVerloren(true)}
        />
        </div>
        {/* Eigener Stapelkontext: Die z-Werte der Beschriftungen bleiben unter dem Zeigerhinweis. */}
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
          {fokus ? (
            <ParteiMarken fokus={fokus} register={register} hover={hover} auswahlId={auswahlId} onPartei={parteiWaehlen} onHover={listenHover} />
          ) : (
            <ObjektSchilder objekte={ansicht.objekte} register={register} hover={hover} onFokus={fokussieren} onHover={listenHover} />
          )}
        </div>
        <div ref={infoRef} className="pointer-events-none absolute left-0 top-0 z-30" style={{ visibility: hover.immobilieId && hoverAusSzene && !zieht.current ? "visible" : "hidden" }}>
          {hover.immobilieId && hoverAusSzene && <Zeigerinfo ziel={hover} objekte={ansicht.objekte} fokusId={fokusId} istAdmin={istAdmin} />}
        </div>
      </div>

      <Seitenleiste3D
        objekte={ansicht.objekte}
        fokus={fokus}
        auswahl={auswahl}
        hover={hover}
        istAdmin={istAdmin}
        rueckstandFehler={daten.rueckstandFehler}
        rueckstandLaedt={daten.rueckstandLaedt}
        kompakt={!desktop}
        offen={listeOffen}
        onOffen={setListeOffen}
        onZurueck={onZurueck}
        onFokus={fokussieren}
        onHover={listenHover}
        onPartei={parteiWaehlen}
        onAuswahlAufheben={() => setAuswahlId(null)}
        onVertragOeffnen={vertragOeffnen}
        onVerlauf={setVerlaufFuer}
        onNeuerVertrag={setNeuerVertragFuer}
        onObjektseite={onObjektseite}
      />

      <div className={desktop ? "pointer-events-none absolute right-4 top-4 z-20 flex flex-col items-end gap-2" : "pointer-events-none absolute right-2 top-2 z-20 flex flex-col items-end gap-2"}>
        <Werkzeuge3D tageszeit={tageszeit} onTageszeit={tageszeitWechseln} onZuruecksetzen={() => setKameraZaehler((z) => z + 1)} />
      </div>

      <div
        className="pointer-events-none absolute z-20 flex flex-col items-start gap-2"
        style={desktop ? { left: LEISTE_BREITE + 16, bottom: 16, right: 112 } : { left: 8, top: 8, right: 108 }}
      >
        {kontextVerloren && (
          <Kontextverlust
            onNeuLaden={() => {
              setKontextVerloren(false);
              setSzenenSchluessel((s) => s + 1);
            }}
          />
        )}
        {daten.aktualisierungFehler && <Aktualisierungsfehler onWiederholen={daten.neuLaden} />}
        {hinweis && desktop && <Bedienhinweis onSchliessen={hinweisSchliessen} />}
        <Legende3D tageszeit={tageszeit} mitRueckstand={istAdmin} className={desktop ? undefined : "max-w-[calc(100vw-5rem)]"} />
      </div>

      {vertragDialog && (
        <MietvertragDetailsModal
          isOpen
          onClose={() => {
            setVertragDialog(null);
            dialogGeschlossen();
          }}
          vertragId={vertragDialog.vertragId}
          einheit={vertragDialog.partei.einheit}
          immobilie={ansicht.objekte.find((o) => o.immobilie.id === vertragDialog.partei.immobilieId)?.immobilie}
        />
      )}

      {neuerVertragFuer && (
        <NewTenantContractDialog
          isOpen
          onClose={() => {
            setNeuerVertragFuer(null);
            dialogGeschlossen();
          }}
          einheitId={neuerVertragFuer.einheit.id}
          immobilie={ansicht.objekte.find((o) => o.immobilie.id === neuerVertragFuer.immobilieId)?.immobilie}
        />
      )}

      <Dialog
        open={Boolean(verlaufFuer)}
        onOpenChange={(offen) => {
          if (!offen) {
            setVerlaufFuer(null);
            dialogGeschlossen();
          }
        }}
      >
        <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto p-0">
          <DialogTitle className="sr-only">Verlauf der Einheit</DialogTitle>
          <DialogDescription className="sr-only">Alle Mietverträge und Leerstände dieser Einheit</DialogDescription>
          {verlaufFuer && (
            <EinheitHistorieView
              einheitId={verlaufFuer.einheit.id}
              onBack={() => {
                setVerlaufFuer(null);
                dialogGeschlossen();
              }}
              einheit={verlaufFuer.einheit}
              immobilie={ansicht.objekte.find((o) => o.immobilie.id === verlaufFuer.immobilieId)?.immobilie}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Hinweisseite({
  stil,
  titel,
  text,
  fehler,
  onZurueck,
  onWiederholen,
}: {
  stil: CSSProperties;
  titel: string;
  text: string;
  fehler?: boolean;
  onZurueck: () => void;
  onWiederholen?: () => void;
}) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4" style={stil}>
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/95 p-6 text-center shadow-xl backdrop-blur-md" role={fehler ? "alert" : undefined}>
        {fehler ? <AlertTriangle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" /> : <Box className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />}
        <h1 className="mt-3 text-lg font-semibold text-foreground">{titel}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onWiederholen && (
            <Button variant="outline" onClick={onWiederholen}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Erneut versuchen
            </Button>
          )}
          <Button onClick={onZurueck}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Zur Übersicht
          </Button>
        </div>
      </div>
    </div>
  );
}
