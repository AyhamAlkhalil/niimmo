import type { Database } from "@/integrations/supabase/types";
import type { EtagenLage } from "@/utils/ansicht3d/etageLesen";
import type { ObjektModell } from "@/utils/ansicht3d/objektModell";
import type { Kennzahlen, ParteiStatus, ParteiZustand } from "@/utils/ansicht3d/parteiStatus";
import type { Platz } from "@/utils/ansicht3d/quartier";
import type { EinheitZeile3D, Rueckstand3D, VertragZeile3D } from "@/hooks/useAnsicht3dDaten";

export type ImmobilieZeile = Database["public"]["Tables"]["immobilien"]["Row"];

export interface Partei {
  einheit: EinheitZeile3D;
  immobilieId: string;
  /** „Einheit 3" wie auf den Karten der Objektseite. */
  nummer: number;
  lage: EtagenLage;
  bereich: string;
  rang: number;
  zustand: ParteiZustand<VertragZeile3D>;
  /** Mieter des Vertrags, der die Lage bestimmt (laufend oder künftig). */
  mieter: string[];
  /** Rückstand aus dem Vertrag, der beim Klick geöffnet wird. */
  rueckstand: Rueckstand3D | null;
  /** Rückstände aus früheren Verträgen derselben Einheit. */
  rueckstandFrueher: number;
}

export interface ObjektAnsicht {
  immobilie: ImmobilieZeile;
  modell: ObjektModell;
  platz: Platz;
  parteien: Partei[];
  kennzahlen: Kennzahlen;
  rueckstand: { summe: number; anzahl: number };
}

export const STATUS_TEXT: Record<ParteiStatus, string> = {
  vermietet: "Vermietet",
  gekuendigt: "Gekündigt",
  kommend: "Neuvermietung",
  leer: "Leerstand",
};
