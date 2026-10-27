import { useRef, useState } from "react";
import {
  Activity, Bot, Building, ChevronDown, FilePlus2, FileSpreadsheet, Gauge, KeyRound, Landmark,
  ListChecks, Mail, Menu, Search, Settings, ShieldAlert, TableProperties, Wrench, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/dashboard/UserMenu";
import { VersionBadge } from "@/components/dashboard/ChangelogDialog";
import { cn } from "@/lib/utils";

/*
 * Menüleiste über allen Ansichten (27.10.2026, Richtung „Exposé“). Ersetzt die Knopfwand im
 * Kopf der Startseite: Die Bereiche öffnen sich als Menüs, der aktive Bereich trägt einen
 * Karminstrich. Bis dahin hatte jede Unterseite nur ihren eigenen Zurück-Knopf, und von
 * einer Unterseite in die nächste ging es immer über die Startseite.
 */

export type Ziel =
  | "portfolio"
  | "neuer-mietvertrag"
  | "vermieter"
  | "uebergabe"
  | "stammdaten"
  | "zaehler"
  | "zahlungen"
  | "darlehen"
  | "mietaufstellung"
  | "blacklist"
  | "aufgaben"
  | "mails"
  | "agentlogs"
  | "devlog";

export type Bereich = "portfolio" | "verwaltung" | "finanzen" | "system";

interface Eintrag {
  ziel: Ziel;
  label: string;
  beschreibung: string;
  icon: LucideIcon;
  nurDev?: boolean;
}

const GRUPPEN: { bereich: Exclude<Bereich, "portfolio">; label: string; eintraege: Eintrag[] }[] = [
  {
    bereich: "verwaltung",
    label: "Verwaltung",
    eintraege: [
      { ziel: "neuer-mietvertrag", label: "Neuer Mietvertrag", beschreibung: "Entwurf anlegen und Schritt für Schritt abschließen", icon: FilePlus2 },
      { ziel: "vermieter", label: "Stammdaten Vermieter", beschreibung: "Firma und Mietkonto im Vertragskopf", icon: Building },
      { ziel: "uebergabe", label: "Übergabe", beschreibung: "Einzug und Auszug mit Protokoll", icon: KeyRound },
      { ziel: "stammdaten", label: "Stammdaten", beschreibung: "Einheiten, Mieter und Verträge bearbeiten", icon: TableProperties },
      { ziel: "zaehler", label: "Zählerverwaltung", beschreibung: "Zähler, Stände und Historie", icon: Gauge },
    ],
  },
  {
    bereich: "finanzen",
    label: "Finanzen",
    eintraege: [
      { ziel: "zahlungen", label: "Zahlungen", beschreibung: "Kontoauszug einlesen, zuordnen, prüfen", icon: Settings },
      { ziel: "darlehen", label: "Darlehen", beschreibung: "Konten, Zinsen und Restschuld", icon: Landmark },
      { ziel: "mietaufstellung", label: "Mietaufstellung", beschreibung: "Aufstellung für die Bank", icon: FileSpreadsheet },
    ],
  },
  {
    bereich: "system",
    label: "System",
    eintraege: [
      { ziel: "blacklist", label: "Blacklist", beschreibung: "Gesperrte Bewerber", icon: ShieldAlert },
      { ziel: "aufgaben", label: "Aufgaben", beschreibung: "Meldungen und Zuständigkeiten", icon: ListChecks },
      { ziel: "mails", label: "Mails", beschreibung: "Versendete Mails ansehen", icon: Mail },
      { ziel: "agentlogs", label: "Chilla Logs", beschreibung: "Gespräche des Assistenten", icon: Bot },
      { ziel: "devlog", label: "Activity Log", beschreibung: "Aktivitäten im System", icon: Activity, nurDev: true },
    ],
  },
];

const LOGO = "/lovable-uploads/c3157d5e-324c-4af6-82c4-55456f4ea211.png";

// Ein Menüpunkt der Leiste: Text mit Karminstrich auf der unteren Haarlinie, wenn aktiv
const leistenpunkt = (aktiv: boolean) =>
  cn(
    "relative inline-flex h-full items-center gap-1 px-0.5 text-[0.9375rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
    "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:transition-colors",
    aktiv
      ? "font-medium text-foreground after:bg-brand"
      : "text-foreground/70 after:bg-transparent hover:text-foreground data-[state=open]:text-foreground data-[state=open]:after:bg-foreground/20",
  );

interface HauptnavigationProps {
  aktiv: Bereich;
  onOeffnen: (ziel: Ziel) => void;
  onSuche: () => void;
  isAdmin: boolean;
  isDev: boolean;
  isHausmeister?: boolean;
}

export function Hauptnavigation({ aktiv, onOeffnen, onSuche, isAdmin, isDev, isHausmeister = false }: HauptnavigationProps) {
  const [mobilOffen, setMobilOffen] = useState(false);
  // Nach einer Auswahl wechselt die Ansicht: Dann soll der Fokus nicht als Ring am Menü kleben.
  // Bei Esc oder Klick daneben kehrt er wie gewohnt zum Menüpunkt zurück.
  const ausgewaehlt = useRef(false);
  const gruppen = GRUPPEN.map((g) => ({ ...g, eintraege: g.eintraege.filter((e) => !e.nurDev || isDev) }));

  const oeffnenMobil = (ziel: Ziel) => {
    setMobilOffen(false);
    // Erst das Panel schließen lassen, dann Ansicht oder Dialog öffnen; zwei Radix-Ebenen im selben
    // Takt können die Sperre der Seite (pointer-events) hängen lassen
    window.setTimeout(() => onOeffnen(ziel), 0);
  };

  return (
    // Höhe einschließlich Haarlinie, damit .app-inhalt genau --app-kopf abziehen kann
    <header className="relative z-40 h-[var(--app-kopf)] border-b border-border bg-background print:hidden">
      <div className="mx-auto flex h-full max-w-[1400px] items-center gap-6 px-4 sm:px-6 lg:gap-10 lg:px-10">
        <button
          type="button"
          onClick={() => onOeffnen("portfolio")}
          className="flex shrink-0 items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          aria-label="NiImmo Gruppe – zur Übersicht"
        >
          <img src={LOGO} alt="" className="h-11 w-auto lg:h-[3.25rem]" />
        </button>

        {isAdmin && (
          <nav aria-label="Bereiche" className="hidden h-full items-stretch gap-8 lg:flex">
            <button type="button" className={leistenpunkt(aktiv === "portfolio")} onClick={() => onOeffnen("portfolio")} aria-current={aktiv === "portfolio" ? "page" : undefined}>
              Portfolio
            </button>
            {gruppen.map((gruppe) => (
              <DropdownMenu key={gruppe.bereich} modal={false}>
                <DropdownMenuTrigger className={leistenpunkt(aktiv === gruppe.bereich)}>
                  {gruppe.label}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={1}
                  className="w-[22rem] p-2"
                  onCloseAutoFocus={(e) => {
                    if (ausgewaehlt.current) e.preventDefault();
                    ausgewaehlt.current = false;
                  }}
                >
                  {gruppe.eintraege.map((eintrag) => {
                    const Icon = eintrag.icon;
                    return (
                      <DropdownMenuItem key={eintrag.ziel} onSelect={() => { ausgewaehlt.current = true; onOeffnen(eintrag.ziel); }} className="items-start gap-3 px-3 py-2.5">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{eintrag.label}</span>
                          <span className="block text-xs text-muted-foreground">{eintrag.beschreibung}</span>
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </nav>
        )}

        {isHausmeister && (
          <Badge variant="warning" className="hidden sm:inline-flex">
            <Wrench className="h-3 w-3" aria-hidden="true" />
            Hausmeister
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {!isHausmeister && (
            <Button variant="ghost" size="sm" onClick={onSuche} className="gap-2 px-2.5 text-foreground/75 hover:text-foreground" aria-label="Suche">
              <Search aria-hidden="true" />
              <span className="hidden xl:inline">Suche</span>
            </Button>
          )}
          <VersionBadge className="hidden md:flex" />
          <UserMenu />
          {isAdmin && (
            <Button variant="brand" onClick={() => onOeffnen("neuer-mietvertrag")} className="ml-1 hidden sm:inline-flex">
              <FilePlus2 aria-hidden="true" />
              Neuer Mietvertrag
            </Button>
          )}
          {isAdmin && (
            <Sheet open={mobilOffen} onOpenChange={setMobilOffen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden" aria-label="Menü öffnen">
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[22rem] max-w-[90vw] overflow-y-auto p-0">
                <SheetHeader className="border-b border-border px-5 py-4 text-left">
                  <SheetTitle className="text-lg">Menü</SheetTitle>
                  <SheetDescription className="sr-only">Bereiche der Verwaltung</SheetDescription>
                </SheetHeader>
                <div className="px-5 py-4">
                  <Button variant="brand" className="w-full" onClick={() => oeffnenMobil("neuer-mietvertrag")}>
                    <FilePlus2 aria-hidden="true" />
                    Neuer Mietvertrag
                  </Button>
                  <button
                    type="button"
                    onClick={() => oeffnenMobil("portfolio")}
                    className={cn("mt-5 block w-full border-b border-border py-3 text-left text-base", aktiv === "portfolio" ? "font-medium text-brand" : "text-foreground")}
                  >
                    Portfolio
                  </button>
                  {gruppen.map((gruppe) => (
                    <div key={gruppe.bereich} className="mt-5">
                      <p className={cn("eyebrow", aktiv === gruppe.bereich && "text-brand")}>{gruppe.label}</p>
                      <ul className="mt-1">
                        {gruppe.eintraege
                          .filter((e) => e.ziel !== "neuer-mietvertrag")
                          .map((eintrag) => {
                            const Icon = eintrag.icon;
                            return (
                              <li key={eintrag.ziel}>
                                <button
                                  type="button"
                                  onClick={() => oeffnenMobil(eintrag.ziel)}
                                  className="flex w-full items-center gap-3 border-b border-border py-3 text-left text-[0.9375rem] text-foreground"
                                >
                                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                  {eintrag.label}
                                </button>
                              </li>
                            );
                          })}
                      </ul>
                    </div>
                  ))}
                  <VersionBadge className="mt-6 md:hidden" />
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>
    </header>
  );
}
