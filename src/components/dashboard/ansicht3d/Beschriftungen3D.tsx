import { useCallback, useEffect, useLayoutEffect, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Namensschilder als echtes HTML über der Szene: scharf, mit den Tokens der Oberfläche gestaltet
 * und per Tastatur erreichbar. Die Szene schreibt nach jedem Bild nur die Bildschirmposition in
 * das Element — React rendert dafür nicht neu.
 */
interface Eintrag {
  position: THREE.Vector3;
  element: HTMLElement | null;
  /** Bei Überlappung gewinnt die höhere Priorität (überfahren), dann das nähere Schild. */
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
      e = { position: new THREE.Vector3(), element: null, prioritaet: 0, breite: 0, hoehe: 0, x: 0, y: 0, tiefe: 0, sichtbar: false };
      this.eintraege.set(id, e);
    }
    return e;
  }

  setzen(id: string, x: number, y: number, z: number, prioritaet: number): void {
    const e = this.eintrag(id);
    e.position.set(x, y, z);
    e.prioritaet = prioritaet;
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

  projizieren(kamera: THREE.Camera, breite: number, hoehe: number): void {
    kamera.updateMatrixWorld();
    const kandidaten: Eintrag[] = [];
    for (const e of this.eintraege.values()) {
      if (!e.element) continue;
      this.ndc.copy(e.position).project(kamera);
      e.sichtbar = this.ndc.z > -1 && this.ndc.z < 1 && Math.abs(this.ndc.x) < 1.2 && Math.abs(this.ndc.y) < 1.2;
      e.x = (this.ndc.x * 0.5 + 0.5) * breite;
      e.y = (-this.ndc.y * 0.5 + 0.5) * hoehe;
      e.tiefe = this.ndc.z;
      if (e.sichtbar) kandidaten.push(e);
    }

    // Überlappende Schilder: Das wichtigere (überfahren) und dann das nähere bleibt stehen.
    const verdeckt = new Set<Eintrag>();
    const belegt: { x0: number; y0: number; x1: number; y1: number }[] = [];
    kandidaten.sort((a, b) => b.prioritaet - a.prioritaet || a.tiefe - b.tiefe);
    for (const e of kandidaten) {
      const rechteck = { x0: e.x - e.breite / 2 - 4, y0: e.y - e.hoehe - 4, x1: e.x + e.breite / 2 + 4, y1: e.y + 4 };
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
      // Nähere Schilder liegen oben.
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
  useFrame(({ camera, size }) => register.projizieren(camera, size.width, size.height));
  return null;
}

interface AnkerProps {
  register: Ankerregister;
  id: string;
  x: number;
  y: number;
  z: number;
  prioritaet?: number;
  children: ReactNode;
}

/**
 * Über der Szene: ein Schild, das unten mittig an einem Punkt im Raum hängt. Ist es verdeckt,
 * trägt das äußere Element `data-verdeckt="true"`; der Inhalt blendet sich darüber aus.
 */
export function Anker({ register, id, x, y, z, prioritaet = 0, children }: AnkerProps) {
  const ref = useCallback((element: HTMLDivElement | null) => register.element(id, element), [register, id]);
  useLayoutEffect(() => {
    register.setzen(id, x, y, z, prioritaet);
  }, [register, id, x, y, z, prioritaet]);
  useEffect(() => () => register.entfernen(id), [register, id]);
  return (
    <div ref={ref} className="group pointer-events-none absolute left-0 top-0" style={{ visibility: "hidden", willChange: "transform" }} data-verdeckt="false">
      <div className="-translate-x-1/2 -translate-y-full">{children}</div>
    </div>
  );
}
