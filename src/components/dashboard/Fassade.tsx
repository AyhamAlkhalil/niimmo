import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fassadenPlan, type FassadenPlan } from "@/utils/fassadenPlan";

/*
 * Stilisierte Fassadenansicht eines Objekts wie in einem Exposé (27.10.2026). Plan und
 * Begründung in utils/fassadenPlan.ts. Nur Linien und helle Flächen; Karmin ausschließlich
 * für freie Einheiten, damit die Farbe ihre Bedeutung behält.
 */

const TOENE = [
  { himmel: "#f4f2ef", fassade: "#fbfaf8", dach: "#dcd6d0", sockel: "#e8e2dc", boden: "#ebe7e2", glas: "#dfe4e7", baum: "#e2e5da" },
  { himmel: "#eff1f2", fassade: "#f9fafa", dach: "#d4d9dc", sockel: "#e1e5e7", boden: "#e6e8e9", glas: "#dbe3e8", baum: "#dee5de" },
  { himmel: "#f0f2ee", fassade: "#fafbf8", dach: "#d5dbd1", sockel: "#e1e6dd", boden: "#e6e9e2", glas: "#dce4e4", baum: "#dae3d4" },
  { himmel: "#f5f1ec", fassade: "#fcfaf7", dach: "#dcd1c6", sockel: "#e9e0d5", boden: "#ede6dd", glas: "#dfe4e6", baum: "#e3e4d6" },
];

const LINIE = "#aaa5a2";
const KARMIN = "#be2637";
const KARMIN_RAHMEN = "#8f1d2a";
const BREITE = 400;
const BODEN = 226;

interface FassadeProps {
  id: string;
  objekttyp?: string | null;
  einheiten: number | null | undefined;
  frei: number | null | undefined;
  className?: string;
}

function Fenster({ x, y, b, h, frei, ton, sprosse }: { x: number; y: number; b: number; h: number; frei: boolean; ton: (typeof TOENE)[number]; sprosse: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={b} height={h} fill={frei ? KARMIN : ton.glas} stroke={frei ? KARMIN_RAHMEN : LINIE} strokeWidth={0.9} />
      {sprosse && <line x1={x + b / 2} x2={x + b / 2} y1={y} y2={y + h} stroke={frei ? KARMIN_RAHMEN : LINIE} strokeWidth={0.6} />}
      {/* Fensterbank */}
      <line x1={x - 2} x2={x + b + 2} y1={y + h + 1.5} y2={y + h + 1.5} stroke={LINIE} strokeWidth={0.9} />
    </g>
  );
}

function Baum({ x, ton }: { x: number; ton: (typeof TOENE)[number] }) {
  return (
    <g>
      <line x1={x} x2={x} y1={BODEN} y2={BODEN - 34} stroke={LINIE} strokeWidth={1} />
      <circle cx={x} cy={BODEN - 52} r={22} fill={ton.baum} stroke={LINIE} strokeWidth={0.9} />
      <circle cx={x - 9} cy={BODEN - 44} r={13} fill={ton.baum} stroke={LINIE} strokeWidth={0.9} />
    </g>
  );
}

/** Mehrfamilienhaus, mit Mischnutzung: Ladenzone im Erdgeschoss */
function Mehrfamilienhaus({ plan, ton, sprosse }: { plan: FassadenPlan; ton: (typeof TOENE)[number]; sprosse: boolean }) {
  const achsBreite = 44;
  const geschossHoehe = 34;
  const misch = plan.bauart === "mischnutzung";
  const b = plan.achsen * achsBreite + 36;
  const sockel = 8;
  const h = plan.geschosse * geschossHoehe + sockel + (misch ? 6 : 0);
  const x = (BREITE - b) / 2;
  const oben = BODEN - h;
  const frei = new Set(plan.freieFenster);
  const teile: ReactNode[] = [];

  // Dach
  if (plan.dach === "sattel") {
    teile.push(<polygon key="dach" points={`${x - 10},${oben} ${x + b / 2},${oben - 44} ${x + b + 10},${oben}`} fill={ton.dach} stroke={LINIE} strokeWidth={1} />);
    teile.push(<rect key="schornstein" x={x + b * 0.7} y={oben - 40} width={10} height={22} fill={ton.dach} stroke={LINIE} strokeWidth={0.9} />);
  } else if (plan.dach === "walm") {
    teile.push(<polygon key="dach" points={`${x - 6},${oben} ${x + 20},${oben - 30} ${x + b - 20},${oben - 30} ${x + b + 6},${oben}`} fill={ton.dach} stroke={LINIE} strokeWidth={1} />);
    const gauben = Math.max(2, Math.min(4, plan.achsen - 2));
    for (let i = 0; i < gauben; i++) {
      const gx = x + 30 + ((b - 60) / gauben) * (i + 0.5) - 8;
      teile.push(<rect key={`gaube${i}`} x={gx} y={oben - 22} width={16} height={14} fill={ton.glas} stroke={LINIE} strokeWidth={0.9} />);
    }
  } else {
    teile.push(<rect key="attika" x={x - 4} y={oben - 9} width={b + 8} height={9} fill={ton.dach} stroke={LINIE} strokeWidth={1} />);
  }

  // Baukörper und Sockel
  teile.push(<rect key="koerper" x={x} y={oben} width={b} height={h} fill={ton.fassade} stroke={LINIE} strokeWidth={1} />);
  teile.push(<rect key="sockel" x={x} y={BODEN - sockel} width={b} height={sockel} fill={ton.sockel} stroke={LINIE} strokeWidth={0.9} />);

  for (let g = 0; g < plan.geschosse; g++) {
    const gy = oben + g * geschossHoehe + (misch && g === plan.geschosse - 1 ? 6 : 0);
    const erdgeschoss = g === plan.geschosse - 1;
    // Geschossgesims über dem Erdgeschoss
    if (erdgeschoss) {
      teile.push(<line key="gesims" x1={x} x2={x + b} y1={gy - 1} y2={gy - 1} stroke={LINIE} strokeWidth={1} />);
    }
    if (erdgeschoss && misch) {
      // Ladenzone: Markise in Anthrazit, breite Schaufenster, Eingang
      teile.push(<rect key="markise" x={x + 8} y={gy + 1} width={b - 16} height={5} fill="#3b3637" />);
      for (let a = 0; a < plan.achsen; a++) {
        const ax = x + 18 + a * achsBreite;
        if (a === plan.tuerAchse) {
          teile.push(<rect key={`tuer${a}`} x={ax + 8} y={gy + 9} width={22} height={BODEN - sockel - gy - 9} fill={ton.glas} stroke={LINIE} strokeWidth={0.9} />);
        } else {
          teile.push(<rect key={`laden${a}`} x={ax + 2} y={gy + 10} width={achsBreite - 6} height={BODEN - sockel - gy - 13} fill={ton.glas} stroke={LINIE} strokeWidth={0.9} />);
        }
      }
      continue;
    }
    for (let a = 0; a < plan.achsen; a++) {
      const ax = x + 18 + a * achsBreite;
      if (erdgeschoss && a === plan.tuerAchse) {
        teile.push(<rect key={`tuer${a}`} x={ax + 10} y={gy + 6} width={20} height={BODEN - sockel - gy - 6} fill={ton.dach} stroke={LINIE} strokeWidth={0.9} />);
        teile.push(<line key={`stufe${a}`} x1={ax + 6} x2={ax + 34} y1={BODEN - sockel} y2={BODEN - sockel} stroke={LINIE} strokeWidth={1.4} />);
        continue;
      }
      const fy = gy + 7;
      teile.push(<Fenster key={`f${g}-${a}`} x={ax + 9} y={fy} b={22} h={19} frei={frei.has(`${g}:${a}`)} ton={ton} sprosse={sprosse} />);
      if (plan.balkone && !erdgeschoss && a % 2 === 1) {
        teile.push(
          <g key={`balkon${g}-${a}`}>
            <rect x={ax + 3} y={fy + 20} width={34} height={7} fill="none" stroke={LINIE} strokeWidth={0.9} />
            {[0, 1, 2, 3].map((s) => (
              <line key={s} x1={ax + 3 + (s + 1) * 6.8} x2={ax + 3 + (s + 1) * 6.8} y1={fy + 20} y2={fy + 27} stroke={LINIE} strokeWidth={0.5} />
            ))}
          </g>,
        );
      }
    }
  }
  return <>{teile}</>;
}

/** Ein- bis drei Häuser nebeneinander mit eigenem Giebel */
function Haeuser({ plan, ton, sprosse }: { plan: FassadenPlan; ton: (typeof TOENE)[number]; sprosse: boolean }) {
  const hausBreite = plan.haeuser === 1 ? 150 : 108;
  const b = hausBreite * plan.haeuser;
  const x0 = (BREITE - b) / 2;
  const h = 84;
  const oben = BODEN - h;
  const frei = new Set(plan.freieFenster);
  const teile: ReactNode[] = [];
  for (let haus = 0; haus < plan.haeuser; haus++) {
    const x = x0 + haus * hausBreite;
    teile.push(<polygon key={`dach${haus}`} points={`${x - 6},${oben} ${x + hausBreite / 2},${oben - 46} ${x + hausBreite + 6},${oben}`} fill={ton.dach} stroke={LINIE} strokeWidth={1} />);
    teile.push(<rect key={`koerper${haus}`} x={x} y={oben} width={hausBreite} height={h} fill={ton.fassade} stroke={LINIE} strokeWidth={1} />);
    // Giebelfenster
    teile.push(<rect key={`giebel${haus}`} x={x + hausBreite / 2 - 7} y={oben - 26} width={14} height={14} fill={ton.glas} stroke={LINIE} strokeWidth={0.9} />);
    const spalte = hausBreite / plan.achsen;
    for (let g = 0; g < plan.geschosse; g++) {
      const gy = oben + g * 40;
      for (let a = 0; a < plan.achsen; a++) {
        const ax = x + a * spalte + spalte / 2;
        if (g === plan.geschosse - 1 && a === 0) {
          teile.push(<rect key={`tuer${haus}`} x={ax - 10} y={gy + 6} width={20} height={BODEN - gy - 6} fill={ton.dach} stroke={LINIE} strokeWidth={0.9} />);
          continue;
        }
        teile.push(<Fenster key={`f${haus}-${g}-${a}`} x={ax - 12} y={gy + 9} b={24} h={21} frei={frei.has(`${haus}:${g}:${a}`)} ton={ton} sprosse={sprosse} />);
      }
    }
  }
  return <>{teile}</>;
}

/** Gewerbebau: flach, Fensterbänder, Vordach über dem Eingang */
function Gewerbebau({ ton, plan }: { ton: (typeof TOENE)[number]; plan: FassadenPlan }) {
  const b = 300;
  const x = (BREITE - b) / 2;
  const h = 92;
  const oben = BODEN - h;
  const frei = new Set(plan.freieFenster);
  const teile: ReactNode[] = [
    <rect key="attika" x={x - 4} y={oben - 10} width={b + 8} height={10} fill={ton.dach} stroke={LINIE} strokeWidth={1} />,
    <rect key="koerper" x={x} y={oben} width={b} height={h} fill={ton.fassade} stroke={LINIE} strokeWidth={1} />,
  ];
  // Oberes Fensterband
  const bandX = x + 14;
  const bandB = b - 28;
  const feld = bandB / plan.achsen;
  for (let a = 0; a < plan.achsen; a++) {
    teile.push(<rect key={`band${a}`} x={bandX + a * feld} y={oben + 12} width={feld} height={24} fill={frei.has(`0:${a}`) ? KARMIN : ton.glas} stroke={frei.has(`0:${a}`) ? KARMIN_RAHMEN : LINIE} strokeWidth={0.9} />);
  }
  // Erdgeschoss: Glasfront links, Eingang mit Vordach rechts
  teile.push(<rect key="front" x={x + 14} y={oben + 50} width={b * 0.56} height={h - 50} fill={ton.glas} stroke={LINIE} strokeWidth={0.9} />);
  for (let i = 1; i < 4; i++) {
    teile.push(<line key={`pfosten${i}`} x1={x + 14 + ((b * 0.56) / 4) * i} x2={x + 14 + ((b * 0.56) / 4) * i} y1={oben + 50} y2={BODEN} stroke={LINIE} strokeWidth={0.6} />);
  }
  teile.push(<rect key="vordach" x={x + b - 96} y={oben + 44} width={72} height={5} fill="#3b3637" />);
  teile.push(<rect key="eingang" x={x + b - 78} y={oben + 54} width={36} height={h - 54} fill={ton.dach} stroke={LINIE} strokeWidth={0.9} />);
  return <>{teile}</>;
}

function FassadeZeichnung({ id, objekttyp, einheiten, frei, className }: FassadeProps) {
  const plan = fassadenPlan({ id, objekttyp, einheiten, frei });
  const ton = TOENE[plan.ton];
  // Sprossenfenster bei jedem zweiten Haus, aus demselben Streuwert wie der Rest
  const sprosse = plan.ton % 2 === 0;
  const bauBreite =
    plan.bauart === "gewerbe" ? 300 : plan.bauart === "haeuser" ? (plan.haeuser === 1 ? 150 : 108 * plan.haeuser) : plan.achsen * 44 + 36;
  const dachHoehe = plan.dach === "sattel" ? 46 : plan.dach === "walm" ? 30 : 10;
  const bauHoehe =
    plan.bauart === "gewerbe" ? 92 : plan.bauart === "haeuser" ? 84 : plan.geschosse * 34 + 8 + (plan.bauart === "mischnutzung" ? 6 : 0);
  // Das Haus füllt den Rahmen: kleine Häuser wachsen, hohe schrumpfen, bis das Dach Luft hat.
  // Skaliert wird um den Fußpunkt in der Bildmitte, damit es auf der Bodenlinie stehen bleibt.
  const massstab = Math.min(1.3, (BODEN - 50) / (bauHoehe + dachHoehe), 344 / bauBreite);
  const rand = (BREITE - bauBreite * massstab) / 2;
  const baumLinks = (plan.baum === "links" || plan.baum === "beide") && rand > 52;
  const baumRechts = (plan.baum === "rechts" || plan.baum === "beide") && rand > 52;

  return (
    <svg
      viewBox={`0 0 ${BREITE} 250`}
      preserveAspectRatio="xMidYMax slice"
      className={cn("h-full w-full", className)}
      aria-hidden="true"
      focusable="false"
    >
      <rect x={0} y={0} width={BREITE} height={250} fill={ton.himmel} />
      <rect x={0} y={BODEN} width={BREITE} height={250 - BODEN} fill={ton.boden} />
      {baumLinks && <Baum x={rand / 2} ton={ton} />}
      {baumRechts && <Baum x={BREITE - rand / 2} ton={ton} />}
      <g transform={`translate(${(BREITE / 2) * (1 - massstab)} ${BODEN * (1 - massstab)}) scale(${massstab})`}>
        {plan.bauart === "gewerbe" ? (
          <Gewerbebau ton={ton} plan={plan} />
        ) : plan.bauart === "haeuser" ? (
          <Haeuser plan={plan} ton={ton} sprosse={sprosse} />
        ) : (
          <Mehrfamilienhaus plan={plan} ton={ton} sprosse={sprosse} />
        )}
      </g>
      <line x1={12} x2={BREITE - 12} y1={BODEN} y2={BODEN} stroke="#8f8a87" strokeWidth={1} />
    </svg>
  );
}

export const Fassade = memo(FassadeZeichnung);
