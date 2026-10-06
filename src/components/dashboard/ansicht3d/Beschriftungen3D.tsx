import { useCallback, useEffect, useLayoutEffect, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Beschriftungen als echtes HTML über der Szene: scharf, mit den Tokens der Oberfläche gestaltet
 * und per Tastatur erreichbar. Die Szene schreibt nach jedem Bild nur die Bildschirmposition in
 * das Element — React rendert dafür nicht neu.
 */
type Ausrichtung = "unten" | "mitte";

interface Eintrag {
  position: THREE.Vector3;
  /** Blickrichtung der Fläche; Beschriftungen auf abgewandten Flächen werden ausgeblendet. */
  normale: THREE.Vector3 | null;
  element: HTMLElement | null;
  ausrichtung: Ausrichtung;
  /** Darf ausgeblendet werden, wenn eine wichtigere Beschriftung an derselben Stelle steht. */
  entzerren: boolean;
  /** Prüft per Strahl, ob Geometrie zwischen Kamera und Punkt liegt (Garagen hinter dem Haus). */
  verdeckbar: boolean;
  prioritaet: number;
  breite: number;
  hoehe: number;
  // Ergebnis der letzten Projektion
  x: number;
  y: number;
  tiefe: number;
  sichtbar: boolean;
}

export class Ankerregister {
  private readonly eintraege = new Map<string, Eintrag>();
  private readonly ndc = new THREE.Vector3();
  private readonly blick = new THREE.Vector3();
  private readonly strahl = new THREE.Raycaster();
  private readonly beobachter =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((meldungen) => {
          for (const m of meldungen) {
            for (const e of this.eintraege.values()) {
              if (e.element === m.target) {
                e.breite = (m.target as HTMLElement).offsetWidth;
                e.hoehe = (m.target as HTMLElement).offsetHeight;
              }
            }
          }
          this.beiAenderung?.();
        });
  /** Wird von der Szene gesetzt: fordert ein neues Bild an, sobald sich etwas ändert. */
  beiAenderung: (() => void) | null = null;

  private eintrag(id: string): Eintrag {
    let e = this.eintraege.get(id);
    if (!e) {
      e = {
        position: new THREE.Vector3(),
        normale: null,
        element: null,
        ausrichtung: "unten",
        entzerren: false,
        verdeckbar: false,
        prioritaet: 0,
        breite: 0,
        hoehe: 0,
        x: 0,
        y: 0,
        tiefe: 0,
        sichtbar: false,
      };
      this.eintraege.set(id, e);
    }
    return e;
  }

  setzen(
    id: string,
    daten: { x: number; y: number; z: number; normale?: [number, number, number]; ausrichtung: Ausrichtung; entzerren: boolean; verdeckbar: boolean; prioritaet: number }
  ): void {
    const e = this.eintrag(id);
    e.position.set(daten.x, daten.y, daten.z);
    e.normale = daten.normale ? new THREE.Vector3(...daten.normale) : null;
    e.ausrichtung = daten.ausrichtung;
    e.entzerren = daten.entzerren;
    e.verdeckbar = daten.verdeckbar;
    e.prioritaet = daten.prioritaet;
    this.beiAenderung?.();
  }

  element(id: string, element: HTMLElement | null): void {
    const e = this.eintrag(id);
    if (e.element && e.element !== element) this.beobachter?.unobserve(e.element);
    e.element = element;
    if (element) {
      e.breite = element.offsetWidth;
      e.hoehe = element.offsetHeight;
      this.beobachter?.observe(element);
      this.beiAenderung?.();
    }
  }

  entfernen(id: string): void {
    const e = this.eintraege.get(id);
    if (e?.element) this.beobachter?.unobserve(e.element);
    this.eintraege.delete(id);
  }

  trennen(): void {
    this.beobachter?.disconnect();
  }

  projizieren(kamera: THREE.Camera, breite: number, hoehe: number, szene?: THREE.Object3D): void {
    kamera.updateMatrixWorld();
    const kandidaten: Eintrag[] = [];
    for (const e of this.eintraege.values()) {
      if (!e.element) continue;
      this.ndc.copy(e.position).project(kamera);
      let sichtbar = this.ndc.z > -1 && this.ndc.z < 1 && Math.abs(this.ndc.x) < 1.2 && Math.abs(this.ndc.y) < 1.2;
      if (sichtbar && e.normale) {
        sichtbar = this.blick.copy(kamera.position).sub(e.position).dot(e.normale) > 0;
      }
      if (sichtbar && e.verdeckbar && szene) {
        // Nur Körper mit Ereignissen oder ohne abgeschaltetes Raycasting zählen; Fenster,
        // Bäume und Zierteile sind ausgenommen (raycast = null).
        this.blick.copy(e.position).sub(kamera.position);
        const entfernung = this.blick.length();
        this.strahl.set(kamera.position, this.blick.normalize());
        this.strahl.far = entfernung;
        const treffer = this.strahl.intersectObject(szene, true)[0];
        if (treffer && treffer.distance < entfernung - 0.12) sichtbar = false;
      }
      e.x = (this.ndc.x * 0.5 + 0.5) * breite;
      e.y = (-this.ndc.y * 0.5 + 0.5) * hoehe;
      e.tiefe = this.ndc.z;
      e.sichtbar = sichtbar;
      if (sichtbar && e.entzerren) kandidaten.push(e);
    }

    // Überlappende Schilder: Das wichtigere (überfahren) und dann das nähere bleibt stehen.
    const verdeckt = new Set<Eintrag>();
    const belegt: { x0: number; y0: number; x1: number; y1: number }[] = [];
    kandidaten.sort((a, b) => b.prioritaet - a.prioritaet || a.tiefe - b.tiefe);
    for (const e of kandidaten) {
      const y0 = e.ausrichtung === "mitte" ? e.y - e.hoehe / 2 : e.y - e.hoehe;
      const rechteck = { x0: e.x - e.breite / 2 - 4, y0: y0 - 4, x1: e.x + e.breite / 2 + 4, y1: y0 + e.hoehe + 4 };
      if (belegt.some((r) => rechteck.x0 < r.x1 && rechteck.x1 > r.x0 && rechteck.y0 < r.y1 && rechteck.y1 > r.y0)) {
        verdeckt.add(e);
      } else {
        belegt.push(rechteck);
      }
    }

    for (const e of this.eintraege.values()) {
      if (!e.element) continue;
      e.element.style.transform = `translate3d(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px, 0)`;
      e.element.style.visibility = e.sichtbar ? "visible" : "hidden";
      e.element.dataset.verdeckt = verdeckt.has(e) ? "true" : "false";
      // Nähere Beschriftungen liegen oben.
      e.element.style.zIndex = String(Math.round((1 - e.tiefe) * 10000) + e.prioritaet * 20000);
    }
  }
}

/** In der Szene: projiziert nach jedem Bild alle Anker. */
export function Ankerprojektor({ register }: { register: Ankerregister }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    register.beiAenderung = () => invalidate();
    invalidate();
    return () => {
      register.beiAenderung = null;
    };
  }, [register, invalidate]);
  useFrame(({ camera, size, scene }) => register.projizieren(camera, size.width, size.height, scene));
  return null;
}

interface AnkerProps {
  register: Ankerregister;
  id: string;
  x: number;
  y: number;
  z: number;
  normale?: [number, number, number];
  /** „unten": das Element steht auf dem Punkt; „mitte": es sitzt mittig darauf. */
  ausrichtung?: Ausrichtung;
  /** Bei Überlappung ausblenden, außer es ist das wichtigste Schild an der Stelle. */
  entzerren?: boolean;
  /** Ausblenden, wenn ein Gebäude davor steht. */
  verdeckbar?: boolean;
  prioritaet?: number;
  children: ReactNode;
}

/**
 * Über der Szene: ein Element, das an einem Punkt im Raum hängt. Ist es verdeckt, trägt das
 * äußere Element `data-verdeckt="true"`; der Inhalt blendet sich darüber aus (`group-data-…`).
 */
export function Anker({ register, id, x, y, z, normale, ausrichtung = "unten", entzerren = false, verdeckbar = false, prioritaet = 0, children }: AnkerProps) {
  const ref = useCallback((element: HTMLDivElement | null) => register.element(id, element), [register, id]);
  const [nx, ny, nz] = normale ?? [];
  useLayoutEffect(() => {
    register.setzen(id, { x, y, z, normale: nx === undefined ? undefined : [nx, ny ?? 0, nz ?? 0], ausrichtung, entzerren, verdeckbar, prioritaet });
  }, [register, id, x, y, z, nx, ny, nz, ausrichtung, entzerren, verdeckbar, prioritaet]);
  useEffect(() => () => register.entfernen(id), [register, id]);
  return (
    <div ref={ref} className="group pointer-events-none absolute left-0 top-0" style={{ visibility: "hidden", willChange: "transform" }} data-verdeckt="false">
      <div className={ausrichtung === "mitte" ? "-translate-x-1/2 -translate-y-1/2" : "-translate-x-1/2 -translate-y-full"}>{children}</div>
    </div>
  );
}
