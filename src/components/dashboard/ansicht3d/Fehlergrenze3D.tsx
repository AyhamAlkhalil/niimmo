import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onZurueck: () => void;
  children: ReactNode;
}

interface Zustand {
  fehler: boolean;
}

/**
 * Fängt Fehler der 3D-Ansicht ab — etwa ein nicht ladbares Teilpaket nach einer neuen
 * Veröffentlichung oder einen Grafiktreiber, der WebGL verweigert. Ohne diese Grenze würde die
 * ganze Anwendung weiß; so bleibt der Weg zurück zur Übersicht.
 */
export class Fehlergrenze3D extends Component<Props, Zustand> {
  state: Zustand = { fehler: false };

  static getDerivedStateFromError(): Zustand {
    return { fehler: true };
  }

  componentDidCatch(fehler: Error, info: ErrorInfo): void {
    console.error("3D-Ansicht", fehler, info.componentStack);
  }

  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-lg">
          <AlertTriangle className="mx-auto h-10 w-10 text-warning" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold text-foreground">Die 3D-Ansicht konnte nicht geöffnet werden</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Möglicherweise wurde gerade eine neue Version veröffentlicht oder der Browser lässt keine 3D-Grafik zu. Die Übersicht funktioniert weiterhin.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Neu laden
            </Button>
            <Button onClick={this.props.onZurueck}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Zur Übersicht
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
