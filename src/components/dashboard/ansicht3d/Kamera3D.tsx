import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface KameraZiel {
  /** Blickpunkt. */
  ziel: [number, number, number];
  abstand: number;
  /** Winkel von oben (0 = senkrecht von oben). */
  polar: number;
  /** Drehung um die Hochachse, 0 = von vorn (Straßenseite). */
  azimut: number;
}

interface Flug {
  von: THREE.Spherical;
  nach: THREE.Spherical;
  vonZiel: THREE.Vector3;
  nachZiel: THREE.Vector3;
  /** null bis zum ersten Bild der Fahrt — ein langsames erstes Bild soll die Fahrt nicht verschlucken. */
  start: number | null;
  dauer: number;
}

interface Kamera3DProps {
  ziel: KameraZiel;
  /** Ändert sich der Schlüssel, fliegt die Kamera zum neuen Ziel. */
  schluessel: string;
  reduziert: boolean;
  /** Beim ersten Ziel aus größerer Höhe einfliegen. */
  einflug: boolean;
  grenzen: { breite: number; tiefe: number };
  maxAbstand: number;
  /** Verschiebung des Bildausschnitts in Pixeln, damit die Szene neben der Seitenleiste mittig steht. */
  versatz: { x: number; y: number };
  /** Hier steht nach jedem Bild der aktuelle Blickpunkt (für Licht und Schatten). */
  zielRef: MutableRefObject<THREE.Vector3>;
  /** Senkrechter Öffnungswinkel; im Hochformat weiter, damit das Quartier in die Breite passt. */
  fov: number;
  onBedienung?: () => void;
  onZiehen?: (aktiv: boolean) => void;
}

const sphaerisch = (z: KameraZiel) => new THREE.Spherical(z.abstand, z.polar, z.azimut);

/** Kürzester Weg zwischen zwei Winkeln. */
function winkelLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const sanft = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function Kamera3D({ ziel, schluessel, reduziert, einflug, grenzen, maxAbstand, versatz, zielRef, fov, onBedienung, onZiehen }: Kamera3DProps) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const breite = useThree((s) => s.size.width);
  const hoehe = useThree((s) => s.size.height);
  const steuerung = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);
  const flug = useRef<Flug | null>(null);
  const begonnen = useRef(false);
  const rueckrufe = useRef({ onBedienung, onZiehen });
  rueckrufe.current = { onBedienung, onZiehen };

  useEffect(() => {
    steuerung.enableDamping = true;
    steuerung.dampingFactor = 0.09;
    steuerung.screenSpacePanning = false;
    steuerung.minPolarAngle = 0.15;
    // Nie unter die Grundplatte schauen.
    steuerung.maxPolarAngle = 1.3;
    steuerung.minDistance = 3;
    steuerung.rotateSpeed = 0.55;
    steuerung.zoomSpeed = 0.9;
    steuerung.zoomToCursor = true;
    steuerung.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    const aenderung = () => invalidate();
    const start = () => {
      flug.current = null;
      rueckrufe.current.onBedienung?.();
      rueckrufe.current.onZiehen?.(true);
    };
    const ende = () => rueckrufe.current.onZiehen?.(false);
    steuerung.addEventListener("change", aenderung);
    steuerung.addEventListener("start", start);
    steuerung.addEventListener("end", ende);
    return () => {
      steuerung.removeEventListener("change", aenderung);
      steuerung.removeEventListener("start", start);
      steuerung.removeEventListener("end", ende);
      steuerung.dispose();
    };
  }, [steuerung, invalidate]);

  useEffect(() => {
    steuerung.maxDistance = maxAbstand;
  }, [steuerung, maxAbstand]);

  useLayoutEffect(() => {
    camera.fov = fov;
    camera.setViewOffset(breite, hoehe, versatz.x, versatz.y, breite, hoehe);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, breite, hoehe, versatz.x, versatz.y, fov, invalidate]);

  useEffect(() => () => camera.clearViewOffset(), [camera]);

  // Ziel anfliegen, sobald sich der Schlüssel ändert. Das Ziel selbst ist bewusst keine
  // Abhängigkeit: Ein neu berechnetes, gleichwertiges Ziel soll keine zweite Fahrt auslösen.
  const zielAktuell = useRef(ziel);
  zielAktuell.current = ziel;
  useEffect(() => {
    const z = zielAktuell.current;
    const nachZiel = new THREE.Vector3(...z.ziel);
    const nach = sphaerisch(z);
    const erstes = !begonnen.current;
    begonnen.current = true;

    if (reduziert || (erstes && !einflug)) {
      flug.current = null;
      steuerung.target.copy(nachZiel);
      camera.position.copy(nachZiel).add(new THREE.Vector3().setFromSpherical(nach));
      steuerung.update();
      invalidate();
      return;
    }
    let von: THREE.Spherical;
    let vonZiel: THREE.Vector3;
    if (erstes) {
      // Einflug: aus größerer Höhe und leicht gedreht auf das Quartier zu.
      von = new THREE.Spherical(z.abstand * 1.6, 0.55, z.azimut - 0.65);
      vonZiel = nachZiel.clone();
    } else {
      von = new THREE.Spherical().setFromVector3(camera.position.clone().sub(steuerung.target));
      vonZiel = steuerung.target.clone();
    }
    flug.current = { von, nach, vonZiel, nachZiel, start: null, dauer: erstes ? 2200 : 1200 };
    invalidate();
  }, [schluessel, reduziert, einflug, steuerung, camera, invalidate]);

  const hilfe = useMemo(() => ({ s: new THREE.Spherical(), v: new THREE.Vector3() }), []);

  useFrame(() => {
    const f = flug.current;
    if (f) {
      const jetzt = performance.now();
      if (f.start === null) f.start = jetzt;
      const t = Math.min(1, (jetzt - f.start) / f.dauer);
      const e = sanft(t);
      steuerung.target.lerpVectors(f.vonZiel, f.nachZiel, e);
      hilfe.s.set(
        THREE.MathUtils.lerp(f.von.radius, f.nach.radius, e),
        THREE.MathUtils.lerp(f.von.phi, f.nach.phi, e),
        winkelLerp(f.von.theta, f.nach.theta, e)
      );
      camera.position.copy(steuerung.target).add(hilfe.v.setFromSpherical(hilfe.s));
      if (t >= 1) flug.current = null;
      invalidate();
    }
    // Der Blickpunkt bleibt über dem Quartier — wer weit schiebt, stößt an den Rand.
    const t = steuerung.target;
    const x = THREE.MathUtils.clamp(t.x, -grenzen.breite / 2, grenzen.breite / 2);
    const z = THREE.MathUtils.clamp(t.z, -grenzen.tiefe / 2, grenzen.tiefe / 2);
    if (x !== t.x || z !== t.z) {
      camera.position.x += x - t.x;
      camera.position.z += z - t.z;
      t.set(x, t.y, z);
    }
    steuerung.update();
    zielRef.current.copy(steuerung.target);
  });

  return null;
}
