import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Quartier } from "@/utils/ansicht3d/quartier";
import { Objekt3D, type ObjektSzene } from "./Objekt3D";
import { Kamera3D, type KameraZiel } from "./Kamera3D";
import { Ankerprojektor, type Ankerregister } from "./Beschriftungen3D";
import { Materialien, SZENENFARBEN, plattenGeometrie, schattenTextur, wuerfelGeometrie, type Stimmung } from "./szene3dHilfen";

export interface Zeigerziel {
  immobilieId: string | null;
  einheitId: string | null;
}

export interface Szene3DProps {
  objekte: ObjektSzene[];
  quartier: Quartier;
  stimmung: Stimmung;
  fokusId: string | null;
  hover: Zeigerziel;
  auswahlEinheit: string | null;
  /** Gebäude wachsen beim ersten Öffnen aus dem Boden, die Kamera fliegt ein. */
  aufbau: boolean;
  kamera: KameraZiel;
  kameraSchluessel: string;
  versatz: { x: number; y: number };
  fov: number;
  reduziert: boolean;
  register: Ankerregister;
  onZeiger: (immobilieId: string, einheitId: string | null, zeitstempel: number) => void;
  onKlick: (immobilieId: string, einheitId: string | null) => void;
  onBedienung: () => void;
  onZiehen: (aktiv: boolean) => void;
  onKontextVerloren: () => void;
}

const KEIN_RAYCAST = () => null;

/** Bildbasierte Umgebung aus einem gerechneten Raum — ohne nachgeladene Dateien (CSP). */
function Umgebung({ staerke }: { staerke: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const raum = new RoomEnvironment();
    const ziel = pmrem.fromScene(raum, 0.04);
    scene.environment = ziel.texture;
    return () => {
      scene.environment = null;
      ziel.dispose();
      raum.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  useEffect(() => {
    scene.environmentIntensity = staerke;
  }, [scene, staerke]);
  return null;
}

/** Sonne bzw. Mond. Licht und Schattenkamera folgen dem Blickpunkt, damit Schatten auch nah scharf bleiben. */
function Licht({ stimmung, zielRef, radius }: { stimmung: Stimmung; zielRef: MutableRefObject<THREE.Vector3>; radius: number }) {
  const sonne = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  const richtung = useMemo(() => new THREE.Vector3(...stimmung.sonnenrichtung).normalize(), [stimmung]);

  useLayoutEffect(() => {
    const ziel = sonne.current?.target;
    if (!ziel) return;
    scene.add(ziel);
    return () => {
      scene.remove(ziel);
    };
  }, [scene]);

  useFrame(({ camera }) => {
    const licht = sonne.current;
    if (!licht) return;
    const ziel = zielRef.current;
    const halb = THREE.MathUtils.clamp(camera.position.distanceTo(ziel) * 0.7, 9, radius * 1.1);
    licht.position.copy(ziel).addScaledVector(richtung, 45);
    licht.target.position.copy(ziel);
    licht.target.updateMatrixWorld();
    const schatten = licht.shadow.camera;
    if (Math.abs(schatten.right - halb) > 0.25) {
      schatten.left = -halb;
      schatten.right = halb;
      schatten.top = halb;
      schatten.bottom = -halb;
      schatten.updateProjectionMatrix();
    }
  });

  return (
    <>
      <hemisphereLight args={[stimmung.himmel, stimmung.boden, stimmung.hemisphaere]} />
      <directionalLight
        ref={sonne}
        color={stimmung.sonne}
        intensity={stimmung.sonnenstaerke}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.035}
        shadow-radius={4}
        shadow-camera-near={1}
        shadow-camera-far={110}
      />
    </>
  );
}

/** Grundplatte, Straßen, Gehwege, Markierungen und Laternen. */
function Stadtgrund({ quartier, materialien }: { quartier: Quartier; materialien: Materialien }) {
  const strich = useRef<THREE.InstancedMesh>(null);
  const mast = useRef<THREE.InstancedMesh>(null);
  const lampe = useRef<THREE.InstancedMesh>(null);
  const breite = quartier.breite;
  const tiefe = quartier.tiefe;

  const { striche, laternen } = useMemo(() => {
    const striche: [number, number][] = [];
    const laternen: [number, number][] = [];
    for (const s of quartier.strassen) {
      for (let x = s.x - s.laenge / 2 + 1.2; x < s.x + s.laenge / 2 - 1; x += 1.9) striche.push([x, s.z]);
      let seite = 1;
      for (let x = s.x - s.laenge / 2 + 2.5; x < s.x + s.laenge / 2 - 2; x += 6.5) {
        laternen.push([x, s.z + seite * (s.breite / 2 - 0.22)]);
        seite = -seite;
      }
    }
    return { striche, laternen };
  }, [quartier]);

  useLayoutEffect(() => {
    const hilfe = new THREE.Object3D();
    striche.forEach(([x, z], i) => {
      hilfe.position.set(x, -0.1, z);
      hilfe.scale.set(0.85, 0.006, 0.07);
      hilfe.updateMatrix();
      strich.current?.setMatrixAt(i, hilfe.matrix);
    });
    laternen.forEach(([x, z], i) => {
      hilfe.position.set(x, -0.06, z);
      hilfe.scale.set(0.05, 1.05, 0.05);
      hilfe.updateMatrix();
      mast.current?.setMatrixAt(i, hilfe.matrix);
      hilfe.position.set(x, 0.99, z);
      hilfe.scale.set(0.16, 0.08, 0.16);
      hilfe.updateMatrix();
      lampe.current?.setMatrixAt(i, hilfe.matrix);
    });
    for (const m of [strich.current, mast.current, lampe.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [striche, laternen]);

  const schatten = useMemo(() => schattenTextur(), []);
  useEffect(() => () => schatten.dispose(), [schatten]);

  return (
    <group>
      <mesh
        geometry={plattenGeometrie(breite + 1.2, tiefe + 1.2, 0.55, 1.6)}
        position={[0, -0.12, 0]}
        material={[materialien.einfach("grundplatte"), materialien.einfach("grundplattenrand")]}
        receiveShadow
        raycast={KEIN_RAYCAST}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.72, 0.8]} raycast={KEIN_RAYCAST}>
        <planeGeometry args={[breite * 1.45, tiefe * 1.5]} />
        <meshBasicMaterial map={schatten} transparent depthWrite={false} />
      </mesh>
      {quartier.strassen.map((s) => (
        <group key={`${s.z}`} position={[s.x, 0, s.z]}>
          <mesh geometry={wuerfelGeometrie()} scale={[s.laenge, 0.02, s.breite - 0.9]} position={[0, -0.12, 0]} material={materialien.einfach("strasse")} receiveShadow raycast={KEIN_RAYCAST} />
          {[-1, 1].map((seite) => (
            <mesh
              key={seite}
              geometry={wuerfelGeometrie()}
              scale={[s.laenge, 0.06, 0.45]}
              position={[0, -0.12, seite * (s.breite / 2 - 0.225)]}
              material={materialien.einfach("gehweg")}
              receiveShadow
              raycast={KEIN_RAYCAST}
            />
          ))}
        </group>
      ))}
      {striche.length > 0 && (
        <instancedMesh ref={strich} args={[wuerfelGeometrie(), materialien.einfach("markierung"), striche.length]} raycast={KEIN_RAYCAST} />
      )}
      {laternen.length > 0 && (
        <>
          <instancedMesh ref={mast} args={[wuerfelGeometrie(), materialien.einfach("laterne"), laternen.length]} castShadow raycast={KEIN_RAYCAST} />
          <instancedMesh ref={lampe} args={[wuerfelGeometrie(), materialien.einfach("laternenlicht"), laternen.length]} raycast={KEIN_RAYCAST} />
        </>
      )}
    </group>
  );
}

/** Alle Bäume des Quartiers als drei Instanzgruppen (Stämme, Laub-, Nadelkronen). */
function Baeume({ objekte, materialien }: { objekte: ObjektSzene[]; materialien: Materialien }) {
  const staemme = useRef<THREE.InstancedMesh>(null);
  const laub = useRef<THREE.InstancedMesh>(null);
  const nadel = useRef<THREE.InstancedMesh>(null);
  const baeume = useMemo(
    () =>
      objekte.flatMap((o) =>
        o.modell.zierteile.filter((t) => t.art === "baum").map((t) => ({ x: o.x + t.x, z: o.z + t.z, groesse: t.breite, hoehe: t.hoehe, nadel: t.variante === 1 }))
      ),
    [objekte]
  );
  const laubbaeume = useMemo(() => baeume.filter((b) => !b.nadel), [baeume]);
  const nadelbaeume = useMemo(() => baeume.filter((b) => b.nadel), [baeume]);

  const geometrien = useMemo(
    () => ({
      stamm: new THREE.CylinderGeometry(0.05, 0.07, 1, 6).translate(0, 0.5, 0),
      laub: new THREE.IcosahedronGeometry(0.5, 1),
      nadel: new THREE.ConeGeometry(0.5, 1, 7).translate(0, 0.5, 0),
    }),
    []
  );
  const laubMaterial = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), []);
  const nadelMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: SZENENFARBEN.nadel, roughness: 0.9, flatShading: true }), []);
  useEffect(
    () => () => {
      Object.values(geometrien).forEach((g) => g.dispose());
      laubMaterial.dispose();
      nadelMaterial.dispose();
    },
    [geometrien, laubMaterial, nadelMaterial]
  );

  useLayoutEffect(() => {
    const hilfe = new THREE.Object3D();
    const farbe = new THREE.Color();
    baeume.forEach((b, i) => {
      hilfe.position.set(b.x, 0, b.z);
      hilfe.rotation.set(0, 0, 0);
      hilfe.scale.set(1, b.hoehe * (b.nadel ? 0.3 : 0.45), 1);
      hilfe.updateMatrix();
      staemme.current?.setMatrixAt(i, hilfe.matrix);
    });
    laubbaeume.forEach((b, i) => {
      hilfe.position.set(b.x, b.hoehe * 0.62, b.z);
      hilfe.rotation.set(0, (i * 1.7) % Math.PI, 0);
      hilfe.scale.set(b.groesse, b.groesse * 1.05, b.groesse);
      hilfe.updateMatrix();
      laub.current?.setMatrixAt(i, hilfe.matrix);
      laub.current?.setColorAt(i, farbe.set(SZENENFARBEN.laub[i % SZENENFARBEN.laub.length]));
    });
    nadelbaeume.forEach((b, i) => {
      hilfe.position.set(b.x, b.hoehe * 0.22, b.z);
      hilfe.rotation.set(0, 0, 0);
      hilfe.scale.set(b.groesse * 0.95, b.hoehe * 0.85, b.groesse * 0.95);
      hilfe.updateMatrix();
      nadel.current?.setMatrixAt(i, hilfe.matrix);
    });
    for (const m of [staemme.current, laub.current, nadel.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [baeume, laubbaeume, nadelbaeume]);

  if (baeume.length === 0) return null;
  return (
    <group>
      <instancedMesh key={`stamm-${baeume.length}`} ref={staemme} args={[geometrien.stamm, materialien.einfach("stamm"), baeume.length]} castShadow raycast={KEIN_RAYCAST} />
      {laubbaeume.length > 0 && (
        <instancedMesh key={`laub-${laubbaeume.length}`} ref={laub} args={[geometrien.laub, laubMaterial, laubbaeume.length]} castShadow receiveShadow raycast={KEIN_RAYCAST} />
      )}
      {nadelbaeume.length > 0 && (
        <instancedMesh key={`nadel-${nadelbaeume.length}`} ref={nadel} args={[geometrien.nadel, nadelMaterial, nadelbaeume.length]} castShadow raycast={KEIN_RAYCAST} />
      )}
    </group>
  );
}

function SzeneInhalt(props: Szene3DProps & { materialien: Materialien }) {
  const { objekte, quartier, stimmung, fokusId, hover, auswahlEinheit, aufbau, materialien, register } = props;
  const zielRef = useRef(new THREE.Vector3());
  // Zeitpunkt des ersten gezeichneten Bildes — erst dann beginnt der Aufbau (Shader sind kompiliert).
  const aufbauBeginn = useRef<number | null>(null);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    gl.toneMappingExposure = stimmung.belichtung;
  }, [gl, stimmung.belichtung]);

  return (
    <>
      <Umgebung staerke={stimmung.umgebung} />
      <Licht stimmung={stimmung} zielRef={zielRef} radius={quartier.radius} />
      <Stadtgrund quartier={quartier} materialien={materialien} />
      <Baeume objekte={objekte} materialien={materialien} />
      {objekte.map((objekt) => {
        const modus = fokusId === null ? "uebersicht" : fokusId === objekt.id ? "fokus" : "gedimmt";
        const gehoertDazu = hover.immobilieId === objekt.id;
        return (
          <Objekt3D
            key={objekt.id}
            objekt={objekt}
            materialien={materialien}
            modus={modus}
            hoverEinheit={modus === "fokus" && gehoertDazu ? hover.einheitId : null}
            auswahlEinheit={modus === "fokus" ? auswahlEinheit : null}
            angehoben={gehoertDazu && modus !== "fokus"}
            aufbau={aufbau}
            aufbauBeginn={aufbauBeginn}
            onZeiger={props.onZeiger}
            onKlick={props.onKlick}
          />
        );
      })}
      <Kamera3D
        ziel={props.kamera}
        schluessel={props.kameraSchluessel}
        reduziert={props.reduziert}
        einflug={aufbau}
        grenzen={{ breite: quartier.breite, tiefe: quartier.tiefe }}
        maxAbstand={props.kamera.abstand * 2.2 + quartier.radius}
        versatz={props.versatz}
        fov={props.fov}
        zielRef={zielRef}
        onBedienung={props.onBedienung}
        onZiehen={props.onZiehen}
      />
      <Ankerprojektor register={register} />
    </>
  );
}

export function Szene3D(props: Szene3DProps) {
  const materialien = useMemo(() => new Materialien(props.stimmung), [props.stimmung]);
  useEffect(() => () => materialien.entsorgen(), [materialien]);
  const kontextVerloren = useRef(props.onKontextVerloren);
  kontextVerloren.current = props.onKontextVerloren;

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      frameloop="demand"
      camera={{ fov: 32, near: 0.5, far: 600, position: [0, 60, 80] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        // Neutrales Tonemapping hält die hellen Modelltöne farbtreu.
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.domElement.addEventListener("webglcontextlost", (ereignis) => {
          ereignis.preventDefault();
          kontextVerloren.current();
        });
      }}
      aria-hidden="true"
    >
      <SzeneInhalt {...props} materialien={materialien} />
    </Canvas>
  );
}
