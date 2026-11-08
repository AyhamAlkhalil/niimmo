/**
 * § 2 der Betriebskostenverordnung im Wortlaut der Vertragsvorlage des Kunden (Anhang „Mietvertrag.docx“ der Mail vom
 * 02.11.2026, einschließlich der Nr. 15 in der Fassung seit dem Telekommunikationsmodernisierungsgesetz). Kundenanmerkung zur
 * früheren Anlage „Betriebskostenkatalog“: „siehe unsere Verordnung über die Aufstellung von Betriebskosten“.
 */
export const BETRKV_EINLEITUNG = 'Betriebskosten im Sinne von § 1 sind:';

export const BETRKV_SCHLUSS = "Für Anlagen, die ab dem 1. Dezember 2021 errichtet worden sind, ist Satz 1 Nummer 15 Buchstabe a und b nicht anzuwenden.";

export const BETRKV_NUMMERN: { nummer: string; zeilen: string[] }[] = [
  { nummer: "1.", zeilen: [
    "die laufenden öffentlichen Lasten des Grundstücks,",
    "hierzu gehört namentlich die Grundsteuer;",
  ] },
  { nummer: "2.", zeilen: [
    "die Kosten der Wasserversorgung,",
    "hierzu gehören die Kosten des Wasserverbrauchs, die Grundgebühren, die Kosten der Anmietung oder anderer Arten der Gebrauchsüberlassung von Wasserzählern sowie die Kosten ihrer Verwendung einschließlich der Kosten der Eichung sowie der Kosten der Berechnung und Aufteilung, die Kosten der Wartung von Wassermengenreglern, die Kosten des Betriebs einer hauseigenen Wasserversorgungsanlage und einer Wasseraufbereitungsanlage einschließlich der Aufbereitungsstoffe;",
  ] },
  { nummer: "3.", zeilen: [
    "die Kosten der Entwässerung,",
    "hierzu gehören die Gebühren für die Haus- und Grundstücksentwässerung, die Kosten des Betriebs einer entsprechenden nicht öffentlichen Anlage und die Kosten des Betriebs einer Entwässerungspumpe;",
  ] },
  { nummer: "4.", zeilen: [
    "die Kosten",
    "a) des Betriebs der zentralen Heizungsanlage einschließlich der Abgasanlage,",
    "hierzu gehören die Kosten der verbrauchten Brennstoffe und ihrer Lieferung, die Kosten des Betriebsstroms, die Kosten der Bedienung, Überwachung und Pflege der Anlage, der regelmäßigen Prüfung ihrer Betriebsbereitschaft und Betriebssicherheit einschließlich der Einstellung durch eine Fachkraft, der Reinigung der Anlage und des Betriebsraums, die Kosten der Messungen nach dem Bundes-Immissionsschutzgesetz, die Kosten der Anmietung oder anderer Arten der Gebrauchsüberlassung einer Ausstattung zur Verbrauchserfassung sowie die Kosten der Verwendung einer Ausstattung zur Verbrauchserfassung einschließlich der Kosten der Eichung sowie der Kosten der Berechnung und Aufteilung",
    "oder",
    "b) des Betriebs der zentralen Brennstoffversorgungsanlage,",
    "hierzu gehören die Kosten der verbrauchten Brennstoffe und ihrer Lieferung, die Kosten des Betriebsstroms und die Kosten der Überwachung sowie die Kosten der Reinigung der Anlage und des Betriebsraums",
    "oder",
    "c) der eigenständig gewerblichen Lieferung von Wärme, auch aus Anlagen im Sinne des Buchstabens a,",
    "hierzu gehören das Entgelt für die Wärmelieferung und die Kosten des Betriebs der zugehörigen Hausanlagen entsprechend Buchstabe a",
    "oder",
    "d) der Reinigung und Wartung von Etagenheizungen und Gaseinzelfeuerstätten,",
    "hierzu gehören die Kosten der Beseitigung von Wasserablagerungen und Verbrennungsrückständen in der Anlage, die Kosten der regelmäßigen Prüfung der Betriebsbereitschaft und Betriebssicherheit und der damit zusammenhängenden Einstellung durch eine Fachkraft sowie die Kosten der Messungen nach dem Bundes-Immissionsschutzgesetz;",
  ] },
  { nummer: "5.", zeilen: [
    "die Kosten",
    "a) des Betriebs der zentralen Warmwasserversorgungsanlage,",
    "hierzu gehören die Kosten der Wasserversorgung entsprechend Nummer 2, soweit sie nicht dort bereits berücksichtigt sind, und die Kosten der Wassererwärmung entsprechend Nummer 4 Buchstabe a",
    "oder",
    "b) der eigenständig gewerblichen Lieferung von Warmwasser, auch aus Anlagen im Sinne des Buchstabens a,",
    "hierzu gehören das Entgelt für die Lieferung des Warmwassers und die Kosten des Betriebs der zugehörigen Hausanlagen entsprechend Nummer 4 Buchstabe a",
    "oder",
    "c) der Reinigung und Wartung von Warmwassergeräten,",
    "hierzu gehören die Kosten der Beseitigung von Wasserablagerungen und Verbrennungsrückständen im Innern der Geräte sowie die Kosten der regelmäßigen Prüfung der Betriebsbereitschaft und Betriebssicherheit und der damit zusammenhängenden Einstellung durch eine Fachkraft;",
  ] },
  { nummer: "6.", zeilen: [
    "die Kosten verbundener Heizungs- und Warmwasserversorgungsanlagen",
    "a) bei zentralen Heizungsanlagen entsprechend Nummer 4 Buchstabe a und entsprechend Nummer 2, soweit sie nicht dort bereits berücksichtigt sind,",
    "oder",
    "b) bei der eigenständig gewerblichen Lieferung von Wärme entsprechend Nummer 4 Buchstabe c und entsprechend Nummer 2, soweit sie nicht dort bereits berücksichtigt sind,",
    "oder",
    "c) bei verbundenen Etagenheizungen und Warmwasserversorgungsanlagen entsprechend Nummer 4 Buchstabe d und entsprechend Nummer 2, soweit sie nicht dort bereits berücksichtigt sind;",
  ] },
  { nummer: "7.", zeilen: [
    "die Kosten des Betriebs des Personen- oder Lastenaufzugs,",
    "hierzu gehören die Kosten des Betriebsstroms, die Kosten der Beaufsichtigung, der Bedienung, Überwachung und Pflege der Anlage, der regelmäßigen Prüfung ihrer Betriebsbereitschaft und Betriebssicherheit einschließlich der Einstellung durch eine Fachkraft sowie die Kosten der Reinigung der Anlage;",
  ] },
  { nummer: "8.", zeilen: [
    "die Kosten der Straßenreinigung und Müllbeseitigung,",
    "zu den Kosten der Straßenreinigung gehören die für die öffentliche Straßenreinigung zu entrichtenden Gebühren und die Kosten entsprechender nicht öffentlicher Maßnahmen; zu den Kosten der Müllbeseitigung gehören namentlich die für die Müllabfuhr zu entrichtenden Gebühren, die Kosten entsprechender nicht öffentlicher Maßnahmen, die Kosten des Betriebs von Müllkompressoren, Müllschluckern, Müllabsauganlagen sowie des Betriebs von Müllmengenerfassungsanlagen einschließlich der Kosten der Berechnung und Aufteilung;",
  ] },
  { nummer: "9.", zeilen: [
    "die Kosten der Gebäudereinigung und Ungezieferbekämpfung,",
    "zu den Kosten der Gebäudereinigung gehören die Kosten für die Säuberung der von den Bewohnern gemeinsam genutzten Gebäudeteile, wie Zugänge, Flure, Treppen, Keller, Bodenräume, Waschküchen, Fahrkorb des Aufzugs;",
  ] },
  { nummer: "10.", zeilen: [
    "die Kosten der Gartenpflege,",
    "hierzu gehören die Kosten der Pflege gärtnerisch angelegter Flächen einschließlich der Erneuerung von Pflanzen und Gehölzen, der Pflege von Spielplätzen einschließlich der Erneuerung von Sand und der Pflege von Plätzen, Zugängen und Zufahrten, die dem nicht öffentlichen Verkehr dienen;",
  ] },
  { nummer: "11.", zeilen: [
    "die Kosten der Beleuchtung,",
    "hierzu gehören die Kosten des Stroms für die Außenbeleuchtung und die Beleuchtung der von den Bewohnern gemeinsam genutzten Gebäudeteile, wie Zugänge, Flure, Treppen, Keller, Bodenräume, Waschküchen;",
  ] },
  { nummer: "12.", zeilen: [
    "die Kosten der Schornsteinreinigung,",
    "hierzu gehören die Kehrgebühren nach der maßgebenden Gebührenordnung, soweit sie nicht bereits als Kosten nach Nummer 4 Buchstabe a berücksichtigt sind;",
  ] },
  { nummer: "13.", zeilen: [
    "die Kosten der Sach- und Haftpflichtversicherung,",
    "hierzu gehören namentlich die Kosten der Versicherung des Gebäudes gegen Feuer-, Sturm-, Wasser- sowie sonstige Elementarschäden, der Glasversicherung, der Haftpflichtversicherung für das Gebäude, den Öltank und den Aufzug;",
  ] },
  { nummer: "14.", zeilen: [
    "die Kosten für den Hauswart,",
    "hierzu gehören die Vergütung, die Sozialbeiträge und alle geldwerten Leistungen, die der Eigentümer oder Erbbauberechtigte dem Hauswart für seine Arbeit gewährt, soweit diese nicht die Instandhaltung, Instandsetzung, Erneuerung, Schönheitsreparaturen oder die Hausverwaltung betrifft; soweit Arbeiten vom Hauswart ausgeführt werden, dürfen Kosten für Arbeitsleistungen nach den Nummern 2 bis 10 und 16 nicht angesetzt werden;",
  ] },
  { nummer: "15.", zeilen: [
    "die Kosten",
    "a) des Betriebs der Gemeinschafts-Antennenanlage,",
    "hierzu gehören die Kosten des Betriebsstroms und die Kosten der regelmäßigen Prüfung ihrer Betriebsbereitschaft einschließlich ihrer Einstellung durch eine Fachkraft,",
    "bis zum 30. Juni 2024 außerdem das Nutzungsentgelt für eine nicht zu dem Gebäude gehörende Antennenanlage sowie die Gebühren, die nach dem Urheberrechtsgesetz für die Kabelweitersendung entstehen,",
    "oder",
    "b) des Betriebs der mit einem Breitbandnetz verbundenen privaten Verteilanlage,",
    "hierzu gehören die Kosten des Betriebsstroms,",
    "bis zum 30. Juni 2024 außerdem die weiteren Kosten entsprechend Buchstabe a, sowie die laufenden monatlichen Grundgebühren für Breitbandanschlüsse,",
    "oder",
    "c) des Betriebs einer gebäudeinternen Verteilanlage, die vollständig mittels Glasfaser mit einem öffentlichen Netz mit sehr hoher Kapazität im Sinne des § 3 Nummer 33 des Telekommunikationsgesetzes verbunden ist, wenn der Mieter seinen Anbieter von öffentlich zugänglichen Telekommunikationsdiensten über seinen Anschluss frei wählen kann,",
    "hierzu gehören die Kosten des Betriebsstroms sowie ein Bereitstellungsentgelt gemäß § 72 Absatz 1 des Telekommunikationsgesetzes;",
  ] },
  { nummer: "16.", zeilen: [
    "die Kosten des Betriebs der Einrichtungen für die Wäschepflege,",
    "hierzu gehören die Kosten des Betriebsstroms, die Kosten der Überwachung, Pflege und Reinigung der Einrichtungen, der regelmäßigen Prüfung ihrer Betriebsbereitschaft und Betriebssicherheit sowie die Kosten der Wasserversorgung entsprechend Nummer 2, soweit sie nicht dort bereits berücksichtigt sind;",
  ] },
  { nummer: "17.", zeilen: [
    "sonstige Betriebskosten,",
    "hierzu gehören Betriebskosten im Sinne des § 1, die von den Nummern 1 bis 16 nicht erfasst sind.",
  ] },
];
