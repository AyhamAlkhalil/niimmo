import type { Database } from "@/integrations/supabase/types";
import type { EtagenLage } from "@/utils/ansicht3d/etageLesen";
import type { ObjektModell } from "@/utils/ansicht3d/objektModell";
import type { ParteiZustand } from "@/utils/ansicht3d/parteiStatus";
import type { Platz } from "@/utils/ansicht3d/quartier";
import type { EinheitZeile3D, VertragZeile3D } from "@/hooks/useAnsicht3dDaten";

export type ImmobilieZeile = Database["public"]["Tables"]["immobilien"]["Row"];

export interface Partei {
  einheit: EinheitZeile3D;
  immobilieId: string;
  lage: EtagenLage;
  bereich: string;
  rang: number;
  zustand: ParteiZustand<VertragZeile3D>;
  /** Mieter des Vertrags, der die Lage bestimmt (laufend oder künftig). */
  mieter: string[];
}

export interface ObjektAnsicht {
  immobilie: ImmobilieZeile;
  modell: ObjektModell;
  platz: Platz;
  parteien: Partei[];
}
