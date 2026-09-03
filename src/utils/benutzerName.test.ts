import { describe, it, expect } from "vitest";

import { kurzName } from "./benutzerName";

/** Kurzform fuer Listen und Erwaehnungen: "Ayham Alkhalil" -> "Ayham A." */

describe("kurzName", () => {
  it("kuerzt Vor- und Nachname zur Listenform", () => {
    expect(kurzName({ anzeigename: "Ayham Alkhalil" })).toBe("Ayham A.");
  });

  it("laesst einteilige Namen unveraendert", () => {
    // Die Buchhaltung steht ohne Personennamen im Verzeichnis.
    expect(kurzName({ anzeigename: "Buchhaltung" })).toBe("Buchhaltung");
    expect(kurzName({ anzeigename: "Hausmeister" })).toBe("Hausmeister");
  });

  it("nimmt bei mehrteiligen Namen den LETZTEN Teil als Initial", () => {
    expect(kurzName({ anzeigename: "Dennis Baris Mikyas" })).toBe("Dennis M.");
    expect(kurzName({ anzeigename: "Anna Maria Sophie Berger" })).toBe("Anna B.");
  });

  it("verkraftet Leerzeichen am Rand", () => {
    expect(kurzName({ anzeigename: "  Ayham Alkhalil  " })).toBe("Ayham A.");
    expect(kurzName({ anzeigename: "\tAyham Alkhalil\n" })).toBe("Ayham A.");
  });

  it("verkraftet mehrfache Leerzeichen zwischen den Namensteilen", () => {
    expect(kurzName({ anzeigename: "Ayham    Alkhalil" })).toBe("Ayham A.");
    expect(kurzName({ anzeigename: "  Dennis   Baris    Mikyas " })).toBe("Dennis M.");
  });

  it("liefert fuer einen leeren Namen einen leeren String", () => {
    expect(kurzName({ anzeigename: "" })).toBe("");
  });

  it("liefert auch fuer reine Leerzeichen einen leeren String", () => {
    expect(kurzName({ anzeigename: "   " })).toBe("");
    expect(kurzName({ anzeigename: "\t\n" })).toBe("");
  });

  it("behaelt Umlaute im Initial", () => {
    expect(kurzName({ anzeigename: "Jörg Öztürk" })).toBe("Jörg Ö.");
    expect(kurzName({ anzeigename: "Ümit Ünal" })).toBe("Ümit Ü.");
  });

  it("laesst Doppelnamen mit Bindestrich unangetastet", () => {
    expect(kurzName({ anzeigename: "Anna-Lena Schmidt" })).toBe("Anna-Lena S.");
    expect(kurzName({ anzeigename: "Peter Müller-Lüdenscheidt" })).toBe("Peter M.");
  });

  it("ignoriert weitere Felder des Benutzers", () => {
    // Die Funktion nimmt bewusst nur `anzeigename` entgegen.
    const mitExtras = { anzeigename: "Ayham Alkhalil", email: "a@b.de", kuerzel: "AA" };
    expect(kurzName(mitExtras)).toBe("Ayham A.");
  });

  it("kuerzt idempotent – eine bereits gekuerzte Form bleibt erhalten", () => {
    // Wichtig, falls die Kurzform versehentlich ein zweites Mal durchlaeuft.
    expect(kurzName({ anzeigename: "Ayham A." })).toBe("Ayham A.");
  });
});
