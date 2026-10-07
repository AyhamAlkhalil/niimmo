import { memo, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Baustein, ObjektModell, Zierteil } from "@/utils/ansicht3d/objektModell";
import {
  Materialien,
  SZENENFARBEN,
  dachGeometrie,
  fensterlicht,
  plattenGeometrie,
  pyramideGeometrie,
  quaderGeometrie,
  wuerfelGeometrie,
  wuerfelMittigGeometrie,
  type Bausteinstatus,
  type Hervorhebung,
} from "./szene3dHilfen";

export interface ObjektSzene {
  id: string;
  modell: ObjektModell;
  x: number;
  z: number;
  /** Status je Einheit (für Abendlicht und Autos); fehlt eine Einheit, gilt sie als Allgemeinfläche. */
  status: Map<string, Bausteinstatus>;
  /** Position in der Aufbau-Animation. */
  reihenfolge: number;
}

export type Objektmodus = "uebersicht" | "fokus" | "gedimmt";

interface Objekt3DProps {
  objekt: ObjektSzene;
  materialien: Materialien;
  modus: Objektmodus;
  /** Nur gesetzt, wenn die Einheit zu diesem Objekt gehört. */
  hoverEinheit: string | null;
  auswahlEinheit: string | null;
  angehoben: boolean;
  /** Aufbau-Animation: Gebäude wachsen aus dem Boden. */
  aufbau: boolean;
  /** Gemeinsamer Startzeitpunkt aller Objekte; setzt das erste Objekt im ersten Bild. */
  aufbauBeginn: MutableRefObject<number | null>;
  onZeiger: (immobilieId: string, einheitId: string | null, zeitstempel: number) => void;
  onKlick: (immobilieId: string, einheitId: string | null) => void;
}

/** Fuge zwischen benachbarten Einheiten, damit jede Partei als eigener Körper lesbar bleibt. */
const FUGE = 0.05;
const AUFBAU_DAUER = 900;
const AUFBAU_VERSATZ = 70;
const KEIN_RAYCAST = () => null;

interface Fenster {
  x: number;
  y: number;
  z: number;
  drehung: THREE.Quaternion;
  breite: number;
  hoehe: number;
  einheitId: string | null;
}

const ACHSE_Y = new THREE.Vector3(0, 1, 0);
const drehungY = (winkel: number) => new THREE.Quaternion().setFromAxisAngle(ACHSE_Y, winkel);
const SEITEN = {
  vorne: drehungY(0),
  hinten: drehungY(Math.PI),
  links: drehungY(-Math.PI / 2),
  rechts: drehungY(Math.PI / 2),
};

function fensterReihe(
  b: Baustein,
  seite: keyof typeof SEITEN,
  hoehen: number[],
  groesse: { breite: number; hoehe: number; abstand: number },
  tueren: Zierteil[],
  liste: Fenster[]
): void {
  const breite = b.breite - FUGE;
  const tiefe = b.tiefe - FUGE;
  const flaeche = seite === "vorne" || seite === "hinten" ? breite : tiefe;
  if (flaeche < groesse.breite + 0.14) return;
  const anzahl = Math.max(1, Math.floor((flaeche - 0.15) / groesse.abstand));
  const schritt = flaeche / anzahl;
  for (let i = 0; i < anzahl; i++) {
    const u = -flaeche / 2 + schritt * (i + 0.5);
    for (const y of hoehen) {
      let x = b.x;
      let z = b.z;
      if (seite === "vorne") {
        x += u;
        z += tiefe / 2 + 0.012;
      } else if (seite === "hinten") {
        x -= u;
        z -= tiefe / 2 + 0.012;
      } else if (seite === "links") {
        x -= breite / 2 + 0.012;
        z += u;
      } else {
        x += breite / 2 + 0.012;
        z -= u;
      }
      // Wo eine Haustür sitzt, gibt es kein Fenster.
      const verdeckt = tueren.some(
        (t) => Math.abs(t.z - z) < 0.2 && Math.abs(t.x - x) < (t.breite + groesse.breite) / 2 + 0.02 && y - groesse.hoehe / 2 < t.y + t.hoehe + 0.1 && y + groesse.hoehe / 2 > t.y
      );
      if (!verdeckt) liste.push({ x, y, z, drehung: SEITEN[seite], breite: groesse.breite, hoehe: groesse.hoehe, einheitId: b.einheitId });
    }
  }
}

/** Dachfenster auf den beiden Dachflächen eines Dachsegments. */
function dachfenster(b: Baustein, liste: Fenster[]): void {
  if (!b.dachschnitt || b.breite < 0.9) return;
  const halb = b.tiefe / 2;
  const neigung = Math.atan2(b.hoehe, halb);
  const flaechen: { von: number; bis: number; vorn: boolean }[] = [
    { von: Math.max(b.dachschnitt.z0, 0), bis: b.dachschnitt.z1, vorn: true },
    { von: b.dachschnitt.z0, bis: Math.min(b.dachschnitt.z1, 0), vorn: false },
  ];
  for (const f of flaechen) {
    if (f.bis - f.von < 0.4) continue;
    const zm = (f.von + f.bis) / 2;
    const normale = new THREE.Vector3(0, Math.cos(neigung), f.vorn ? Math.sin(neigung) : -Math.sin(neigung));
    const drehung = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normale);
    const y = b.y + b.hoehe * (1 - Math.abs(zm) / halb);
    const anzahl = Math.max(1, Math.floor(b.breite / 0.85));
    for (let i = 0; i < anzahl; i++) {
      const u = -b.breite / 2 + (b.breite / anzahl) * (i + 0.5);
      liste.push({
        x: b.x + u + normale.x * 0.015,
        y: y + normale.y * 0.015,
        z: b.z + zm + normale.z * 0.015,
        drehung,
        breite: 0.3,
        hoehe: Math.min(0.42, (f.bis - f.von) * 0.55),
        einheitId: b.einheitId,
      });
    }
  }
}

function fensterFuer(modell: ObjektModell): Fenster[] {
  const tueren = modell.zierteile.filter((z) => z.art === "tuer");
  const liste: Fenster[] = [];
  const normal = { breite: 0.3, hoehe: 0.42, abstand: 0.62 };
  for (const b of modell.bausteine) {
    const seiten = (Object.keys(SEITEN) as (keyof typeof SEITEN)[]).filter((s) => b.fenster[s]);
    switch (b.form) {
      case "raum": {
        const keller = (b.geschoss ?? 0) < 0;
        const groesse = keller ? { breite: 0.32, hoehe: 0.14, abstand: 0.62 } : normal;
        const y = keller ? b.y + b.hoehe - 0.2 : b.y + b.hoehe * 0.52;
        for (const seite of seiten) fensterReihe(b, seite, [y], groesse, tueren, liste);
        break;
      }
      case "haus": {
        const geschoss = b.hoehe / 2;
        for (const seite of seiten) fensterReihe(b, seite, [b.y + geschoss * 0.52, b.y + geschoss * 1.52], normal, tueren, liste);
        break;
      }
      case "halle":
        for (const seite of ["vorne", "hinten"] as const) {
          fensterReihe(b, seite, [b.y + b.hoehe - 0.28], { breite: 0.55, hoehe: 0.2, abstand: 0.85 }, tueren, liste);
        }
        break;
      case "nebengebaeude":
        fensterReihe(b, "vorne", [b.y + 0.66], { breite: 0.28, hoehe: 0.26, abstand: 1.4 }, tueren, liste);
        break;
      case "turm":
        for (const seite of Object.keys(SEITEN) as (keyof typeof SEITEN)[]) {
          fensterReihe(b, seite, [b.y + 0.62, b.y + 1.32, b.y + 2.02], { breite: 0.24, hoehe: 0.32, abstand: 0.9 }, tueren, liste);
        }
        break;
      case "gartenhaus":
        fensterReihe(b, "vorne", [b.y + 0.48], { breite: 0.26, hoehe: 0.22, abstand: 1.2 }, tueren, liste);
        break;
      case "dach":
        dachfenster(b, liste);
        break;
      default:
        break;
    }
  }
  return liste;
}

function FensterInstanzen({ fenster, status, materialien }: { fenster: Fenster[]; status: Map<string, Bausteinstatus>; materialien: Materialien }) {
  const glas = useRef<THREE.InstancedMesh>(null);
  const rahmen = useRef<THREE.InstancedMesh>(null);
  const abend = materialien.stimmung.tageszeit === "abend";

  useLayoutEffect(() => {
    const hilfe = new THREE.Object3D();
    const weiss = new THREE.Color("#ffffff");
    fenster.forEach((f, i) => {
      hilfe.position.set(f.x, f.y, f.z);
      hilfe.quaternion.copy(f.drehung);
      hilfe.scale.set(f.breite, f.hoehe, 0.03);
      hilfe.updateMatrix();
      glas.current?.setMatrixAt(i, hilfe.matrix);
      glas.current?.setColorAt(i, abend ? fensterlicht(f.einheitId ? status.get(f.einheitId) ?? "allgemein" : "allgemein") : weiss);
      hilfe.scale.set(f.breite + 0.07, f.hoehe + 0.07, 0.016);
      hilfe.updateMatrix();
      rahmen.current?.setMatrixAt(i, hilfe.matrix);
    });
    for (const mesh of [glas.current, rahmen.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [fenster, status, abend]);

  if (fenster.length === 0) return null;
  return (
    <>
      <instancedMesh
        // Neu anlegen, wenn sich Anzahl oder Stimmung ändern: Instanzfarben müssen vor dem
        // ersten Zeichnen stehen, sonst kompiliert der Shader ohne sie.
        key={`glas-${fenster.length}-${abend}`}
        ref={glas}
        args={[wuerfelMittigGeometrie(), materialien.einfach(abend ? "glasLeuchtend" : "glas"), fenster.length]}
        raycast={KEIN_RAYCAST}
      />
      <instancedMesh
        key={`rahmen-${fenster.length}`}
        ref={rahmen}
        args={[wuerfelMittigGeometrie(), materialien.einfach("fensterrahmen"), fenster.length]}
        raycast={KEIN_RAYCAST}
      />
    </>
  );
}

function Zier({ teil, materialien, hervorhebung }: { teil: Zierteil; materialien: Materialien; hervorhebung: Hervorhebung }) {
  const dachMaterial = materialien.partei("allgemein", "dach", hervorhebung === "gedimmt" ? "gedimmt" : "normal");
  switch (teil.art) {
    case "sockel":
    case "schornstein":
      return (
        <mesh geometry={quaderGeometrie(teil.breite, teil.hoehe, teil.tiefe, 0.02)} position={[teil.x, teil.y, teil.z]} material={materialien.einfach("sockel")} castShadow receiveShadow raycast={KEIN_RAYCAST} />
      );
    case "gesims":
      return (
        <mesh geometry={wuerfelGeometrie()} scale={[teil.breite, teil.hoehe, teil.tiefe]} position={[teil.x, teil.y, teil.z]} material={materialien.einfach("gesims")} receiveShadow raycast={KEIN_RAYCAST} />
      );
    case "satteldach":
      return <mesh geometry={dachGeometrie(teil.breite, teil.tiefe, teil.hoehe)} position={[teil.x, teil.y, teil.z]} material={dachMaterial} castShadow receiveShadow />;
    case "flachdach":
      return <mesh geometry={quaderGeometrie(teil.breite, teil.hoehe, teil.tiefe, 0.02)} position={[teil.x, teil.y, teil.z]} material={dachMaterial} castShadow receiveShadow />;
    case "tuer":
      return (
        <group position={[teil.x, teil.y, teil.z]}>
          <mesh geometry={quaderGeometrie(teil.breite, teil.hoehe, teil.tiefe, 0.012)} material={materialien.einfach("tuer")} raycast={KEIN_RAYCAST} />
          <mesh geometry={wuerfelGeometrie()} scale={[teil.breite + 0.22, 0.045, 0.3]} position={[0, teil.hoehe + 0.08, 0.12]} material={materialien.einfach("gesims")} castShadow raycast={KEIN_RAYCAST} />
          <mesh geometry={wuerfelGeometrie()} scale={[0.07, 0.07, 0.03]} position={[teil.breite / 2 + 0.09, teil.hoehe - 0.12, 0.03]} material={materialien.einfach("tuerlicht")} raycast={KEIN_RAYCAST} />
        </group>
      );
    case "weg":
    case "hof":
      return (
        <mesh geometry={wuerfelGeometrie()} scale={[teil.breite, teil.hoehe, teil.tiefe]} position={[teil.x, teil.y, teil.z]} material={materialien.einfach(teil.art === "weg" ? "weg" : "hof")} receiveShadow raycast={KEIN_RAYCAST} />
      );
    default:
      return null;
  }
}

function autoFarbe(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SZENENFARBEN.autos[h % SZENENFARBEN.autos.length];
}

function Teil({ b, status, materialien, hervorhebung }: { b: Baustein; status: Bausteinstatus; materialien: Materialien; hervorhebung: Hervorhebung }) {
  const fassade = materialien.partei(status, "fassade", hervorhebung);
  const daten = useMemo(() => ({ einheitId: b.einheitId }), [b.einheitId]);
  const breite = b.breite - FUGE;
  const tiefe = b.tiefe - FUGE;

  switch (b.form) {
    case "raum":
    case "haus":
    case "nebengebaeude":
    case "gartenhaus":
      return (
        <group>
          <mesh geometry={quaderGeometrie(breite, b.hoehe - 0.03, tiefe)} position={[b.x, b.y + 0.015, b.z]} material={fassade} userData={daten} castShadow receiveShadow />
          {b.form === "nebengebaeude" && (
            <mesh geometry={wuerfelGeometrie()} scale={[0.36, 0.62, 0.03]} position={[b.x, b.y + 0.02, b.z + tiefe / 2 + 0.01]} material={materialien.einfach("tuer")} raycast={KEIN_RAYCAST} />
          )}
        </group>
      );
    case "dach": {
      const schnitt = b.dachschnitt ?? { z0: -b.tiefe / 2, z1: b.tiefe / 2 };
      const halb = b.tiefe / 2;
      // Fugen nur zwischen Dachstreifen, nicht an der Traufe.
      const z0 = schnitt.z0 > -halb + 0.001 ? schnitt.z0 + 0.012 : schnitt.z0;
      const z1 = schnitt.z1 < halb - 0.001 ? schnitt.z1 - 0.012 : schnitt.z1;
      return (
        <mesh
          geometry={dachGeometrie(b.breite - 0.03, b.tiefe, b.hoehe, z0, z1)}
          position={[b.x, b.y, b.z]}
          material={materialien.partei(status, "dach", hervorhebung)}
          userData={daten}
          castShadow
          receiveShadow
        />
      );
    }
    case "garage":
      return (
        <group>
          <mesh geometry={quaderGeometrie(breite, b.hoehe, tiefe, 0.025)} position={[b.x, b.y, b.z]} material={fassade} userData={daten} castShadow receiveShadow />
          <mesh geometry={wuerfelGeometrie()} scale={[breite * 0.78, b.hoehe * 0.74, 0.02]} position={[b.x, b.y + 0.02, b.z + tiefe / 2 + 0.008]} material={materialien.einfach("gesims")} raycast={KEIN_RAYCAST} />
        </group>
      );
    case "stellplatz": {
      const belegt = status === "vermietet" || status === "gekuendigt";
      const flaeche = hervorhebung === "hover" || hervorhebung === "auswahl" ? fassade : materialien.einfach("weg");
      const farbe = autoFarbe(b.einheitId ?? b.schluessel);
      return (
        <group>
          <mesh geometry={wuerfelGeometrie()} scale={[breite - 0.06, 0.025, tiefe - 0.1]} position={[b.x, b.y, b.z]} material={flaeche} userData={daten} receiveShadow />
          {belegt && (
            <group position={[b.x, b.y + 0.025, b.z + 0.05]}>
              <mesh geometry={quaderGeometrie(0.5, 0.2, 0.96, 0.07)} position={[0, 0.05, 0]} material={materialien.einfach("autos", farbe)} userData={daten} castShadow />
              <mesh geometry={quaderGeometrie(0.42, 0.17, 0.52, 0.06)} position={[0, 0.23, -0.06]} material={materialien.einfach("glas")} userData={daten} castShadow />
            </group>
          )}
        </group>
      );
    }
    case "halle": {
      const tor = Math.min(1.1, breite * 0.36);
      return (
        <group>
          <mesh geometry={quaderGeometrie(breite, b.hoehe, tiefe, 0.03)} position={[b.x, b.y, b.z]} material={fassade} userData={daten} castShadow receiveShadow />
          <mesh geometry={wuerfelGeometrie()} scale={[tor, 0.92, 0.025]} position={[b.x - breite * 0.18, b.y + 0.02, b.z + tiefe / 2 + 0.01]} material={materialien.einfach("hof")} raycast={KEIN_RAYCAST} />
        </group>
      );
    }
    case "turm":
      return (
        <group>
          <mesh geometry={quaderGeometrie(breite, b.hoehe, tiefe)} position={[b.x, b.y, b.z]} material={fassade} userData={daten} castShadow receiveShadow />
          <mesh geometry={pyramideGeometrie(b.breite + 0.12, 0.8)} position={[b.x, b.y + b.hoehe, b.z]} material={materialien.partei(status, "dach", hervorhebung)} userData={daten} castShadow />
        </group>
      );
    case "werbetafel":
      return (
        <group>
          {[-0.32, 0.32].map((anteil) => (
            <mesh key={anteil} geometry={wuerfelGeometrie()} scale={[0.06, 0.98, 0.06]} position={[b.x + b.breite * anteil, b.y, b.z]} material={materialien.einfach("laterne")} userData={daten} castShadow />
          ))}
          <mesh geometry={quaderGeometrie(b.breite, 0.9, 0.1, 0.02)} position={[b.x, b.y + 0.95, b.z]} material={fassade} userData={daten} castShadow receiveShadow />
        </group>
      );
    default:
      return null;
  }
}

function hervorhebungVon(einheitId: string | null, props: Pick<Objekt3DProps, "modus" | "hoverEinheit" | "auswahlEinheit">): Hervorhebung {
  if (einheitId && einheitId === props.auswahlEinheit) return "auswahl";
  if (einheitId && einheitId === props.hoverEinheit) return "hover";
  return props.modus === "gedimmt" ? "gedimmt" : "normal";
}

const glaetten = (aktuell: number, ziel: number, delta: number, tempo = 12) => aktuell + (ziel - aktuell) * (1 - Math.exp(-tempo * delta));
const ausklingen = (t: number) => 1 - Math.pow(1 - t, 3);

function Objekt3DOhneMemo(props: Objekt3DProps) {
  const { objekt, materialien, modus, angehoben, aufbau, aufbauBeginn, onZeiger, onKlick } = props;
  const { modell } = objekt;
  const gruppe = useRef<THREE.Group>(null);
  const gebaeude = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  const fenster = useMemo(() => fensterFuer(modell), [modell]);
  useFrame((_, delta) => {
    let weiter = false;
    if (gruppe.current) {
      const ziel = angehoben ? 0.16 : 0;
      const y = glaetten(gruppe.current.position.y, ziel, delta);
      gruppe.current.position.y = Math.abs(y - ziel) < 0.0005 ? ziel : y;
      weiter ||= gruppe.current.position.y !== ziel;
    }
    if (gebaeude.current) {
      let skala = 1;
      if (aufbau) {
        const jetzt = performance.now();
        if (aufbauBeginn.current === null) aufbauBeginn.current = jetzt;
        const t = (jetzt - aufbauBeginn.current - objekt.reihenfolge * AUFBAU_VERSATZ) / AUFBAU_DAUER;
        skala = Math.max(0.001, ausklingen(Math.min(1, Math.max(0, t))));
        weiter ||= t < 1;
      }
      gebaeude.current.scale.y = skala;
    }
    if (weiter) invalidate();
  });

  const zeiger = (e: ThreeEvent<PointerEvent>) => {
    // Nur der vorderste Treffer zählt; was dahinter liegt, bekommt das Ereignis nicht.
    e.stopPropagation();
    onZeiger(objekt.id, (e.object.userData?.einheitId as string | null | undefined) ?? null, e.nativeEvent.timeStamp);
  };
  const klick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Wer die Kamera zieht, will nichts öffnen.
    if (e.delta > 6) return;
    onKlick(objekt.id, (e.object.userData?.einheitId as string | null | undefined) ?? null);
  };

  const zierHervorhebung: Hervorhebung = modus === "gedimmt" ? "gedimmt" : "normal";
  const boden = modell.zierteile.filter((t) => t.art === "weg" || t.art === "hof");
  const bauten = modell.zierteile.filter((t) => t.art !== "weg" && t.art !== "hof" && t.art !== "baum");

  return (
    <group ref={gruppe} position={[objekt.x, 0, objekt.z]} onPointerMove={zeiger} onClick={klick}>
      <mesh
        geometry={plattenGeometrie(modell.breite, modell.tiefe, 0.12, 0.35)}
        material={[materialien.einfach("rasen"), materialien.einfach("grundstuecksrand")]}
        receiveShadow
      />
      {boden.map((teil) => (
        <Zier key={teil.schluessel} teil={teil} materialien={materialien} hervorhebung={zierHervorhebung} />
      ))}
      <group ref={gebaeude}>
        {modell.bausteine.map((b) => (
          <Teil key={b.schluessel} b={b} status={b.einheitId ? objekt.status.get(b.einheitId) ?? "allgemein" : "allgemein"} materialien={materialien} hervorhebung={hervorhebungVon(b.einheitId, props)} />
        ))}
        {bauten.map((teil) => (
          <Zier key={teil.schluessel} teil={teil} materialien={materialien} hervorhebung={zierHervorhebung} />
        ))}
        <FensterInstanzen fenster={fenster} status={objekt.status} materialien={materialien} />
      </group>
    </group>
  );
}

export const Objekt3D = memo(Objekt3DOhneMemo);
