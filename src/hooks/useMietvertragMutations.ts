import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useActivityLog } from "@/hooks/useActivityLog";
import { RUECKLASTSCHRIFT_GEBUEHR_EUR } from "@/constants/config";
import { format } from "date-fns";
import type { Database } from "@/integrations/supabase/types";

type Mietvertrag = Database["public"]["Tables"]["mietvertrag"]["Row"];
type Einheit = Database["public"]["Tables"]["einheiten"]["Row"];
type Mieter = Database["public"]["Tables"]["mieter"]["Row"];

interface UseMietvertragMutationsProps {
  vertragId: string;
  vertrag: Mietvertrag | null;
  einheitData: Einheit | null;
  mieter: Mieter[] | undefined;
}

export function useMietvertragMutations({ vertragId, vertrag, einheitData, mieter }: UseMietvertragMutationsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logActivity } = useActivityLog();

  // Per-field editing state
  const [editingKaution, setEditingKaution] = useState<'soll' | 'ist' | null>(null);
  const [editingMietvertrag, setEditingMietvertrag] = useState<'kaltmiete' | 'betriebskosten' | 'neue_anschrift' | 'ruecklastschrift_gebuehr' | 'start_datum' | 'ende_datum' | 'anzahl_personen' | 'mahnstufe' | null>(null);
  const [editingMeter, setEditingMeter] = useState<string | null>(null);
  const [editingMeterNumber, setEditingMeterNumber] = useState<string | null>(null);

  // Global edit mode state
  const [isGlobalEditMode, setIsGlobalEditMode] = useState(false);
  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({});

  // Rent increase confirmation state
  const [showRentIncreaseConfirm, setShowRentIncreaseConfirm] = useState(false);
  const [pendingKaltmieteValue, setPendingKaltmieteValue] = useState<number | null>(null);
  const [pendingGlobalUpdates, setPendingGlobalUpdates] = useState<Partial<Mietvertrag> | null>(null);

  // Dialog visibility state
  const [showCreateForderungModal, setShowCreateForderungModal] = useState(false);
  const [showTerminationDialog, setShowTerminationDialog] = useState(false);
  const [showMahnungModal, setShowMahnungModal] = useState(false);

  const invalidateAll = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] }),
    queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] }),
    queryClient.invalidateQueries({ queryKey: ['immobilien'] }),
    queryClient.invalidateQueries({ queryKey: ['einheiten'] }),
    queryClient.invalidateQueries({ queryKey: ['rueckstaende'] }),
  ]);

  // Helper to save a numeric field on mietvertrag
  const saveNumericField = async (field: string, numericValue: number, isOfficialRentIncrease: boolean) => {
    try {
      const altWert = vertrag ? Number(vertrag[field as keyof Mietvertrag] ?? 0) : undefined;
      const updateData: Partial<Mietvertrag> = { [field]: numericValue };
      if (field === 'kaltmiete' && isOfficialRentIncrease) {
        updateData.letzte_mieterhoehung_am = new Date().toISOString().split('T')[0];
      }

      const { error } = await supabase.from('mietvertrag').update(updateData).eq('id', vertragId);
      if (error) throw error;

      const mieterName = mieter?.map(m => `${m.vorname} ${m.nachname}`.trim()).join(', ') || undefined;

      if (field === 'kaltmiete' && isOfficialRentIncrease) {
        toast({ title: "Mieterhöhung dokumentiert", description: "Kaltmiete wurde erhöht und Datum der letzten Mieterhöhung wurde automatisch gesetzt." });
        logActivity('mieterhoehung_dokumentiert', 'mietvertrag', vertragId, { altKaltmiete: altWert, neueKaltmiete: numericValue, mieter: mieterName });
      } else {
        const fieldName = field === 'kaltmiete' ? 'Kaltmiete' : field === 'betriebskosten' ? 'Betriebskosten' : 'Rücklastschrift-Gebühr';
        toast({ title: "Aktualisiert", description: `${fieldName} wurde erfolgreich aktualisiert.` });
        logActivity('mietvertrag_geaendert', 'mietvertrag', vertragId, { feld: field, altWert, neuerWert: numericValue, mieter: mieterName });
      }

      setEditingMietvertrag(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['immobilien'] }),
        queryClient.invalidateQueries({ queryKey: ['einheiten'] }),
        queryClient.invalidateQueries({ queryKey: ['all-mietvertraege'] }),
      ]);
    } catch (error) {
      toast({ title: "Fehler", description: "Änderung konnte nicht gespeichert werden.", variant: "destructive" });
    }
  };

  const handleEditMietvertrag = async (field: 'kaltmiete' | 'betriebskosten' | 'neue_anschrift' | 'ruecklastschrift_gebuehr' | 'start_datum' | 'ende_datum' | 'anzahl_personen' | 'mahnstufe', value: string) => {
    try {
      // Handle mahnstufe
      if (field === 'mahnstufe') {
        const numValue = parseInt(value, 10);
        if (isNaN(numValue) || numValue < 0 || numValue > 3) {
          toast({ title: "Fehler", description: "Mahnstufe muss zwischen 0 und 3 liegen.", variant: "destructive" });
          return;
        }
        const { error } = await supabase.from('mietvertrag').update({ mahnstufe: numValue }).eq('id', vertragId);
        if (error) throw error;
        toast({ title: "✅ Mahnstufe aktualisiert", description: `Mahnstufe wurde auf ${numValue} gesetzt.` });
        setEditingMietvertrag(null);
        await queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
        await queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] });
        return;
      }

      // Handle anzahl_personen
      if (field === 'anzahl_personen') {
        const numValue = value && value.trim() !== '' ? parseInt(value) : null;
        const { error } = await supabase.from('mietvertrag').update({ anzahl_personen: numValue }).eq('id', vertragId);
        if (error) throw error;
        toast({ title: "✅ Personenanzahl aktualisiert", description: numValue !== null ? `Personenanzahl wurde auf ${numValue} gesetzt.` : "Personenanzahl wurde entfernt." });
        setEditingMietvertrag(null);
        await queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
        await queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] });
        return;
      }

      // Handle ende_datum
      if (field === 'ende_datum') {
        const newEndForDb = value && value.trim() !== '' ? value : null;
        if (newEndForDb && vertrag.start_datum) {
          if (new Date(newEndForDb) < new Date(vertrag.start_datum)) {
            toast({ title: "Ungültiges Datum", description: "Das Mietende kann nicht vor dem Mietbeginn liegen.", variant: "destructive" });
            return;
          }
        }
        if (vertrag?.einheit_id && vertrag.start_datum) {
          const { checkContractOverlap } = await import("@/utils/contractOverlapValidation");
          const overlapCheck = await checkContractOverlap(vertrag.einheit_id, vertrag.start_datum, newEndForDb, vertragId);
          if (overlapCheck.hasOverlap) {
            toast({ title: "Überschneidung erkannt", description: overlapCheck.warningMessage || "Der gewählte Zeitraum überschneidet sich mit einem bestehenden Vertrag.", variant: "destructive" });
            return;
          }
        }
        const isPast = !!newEndForDb && new Date(newEndForDb) < new Date();
        const { error } = await supabase.from('mietvertrag').update({ ende_datum: newEndForDb, ...(isPast ? { status: 'beendet' } : {}) }).eq('id', vertragId);
        if (error) throw error;
        toast({ title: "✅ Mietende aktualisiert", description: newEndForDb ? `Mietende wurde auf ${new Date(newEndForDb).toLocaleDateString('de-DE')} gesetzt.${isPast ? ' Vertrag wird als beendet behandelt.' : ''}` : "Mietvertrag wurde auf unbefristet gesetzt." });
        setEditingMietvertrag(null);
        await queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
        await queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] });
        return;
      }

      // Handle start_datum
      if (field === 'start_datum') {
        if (!vertrag?.einheit_id) {
          toast({ title: "Fehler", description: "Einheit-ID nicht gefunden.", variant: "destructive" });
          return;
        }
        const { checkContractOverlap } = await import('@/utils/contractOverlapValidation');
        const overlapCheck = await checkContractOverlap(vertrag.einheit_id, value, vertrag.ende_datum, vertragId);
        if (overlapCheck.hasOverlap) {
          toast({ title: 'Überschneidung erkannt', description: overlapCheck.warningMessage || 'Startdatum überschneidet sich mit einem bestehenden Vertrag.', variant: 'destructive' });
          return;
        }
        const { error } = await supabase.from('mietvertrag').update({ start_datum: value }).eq('id', vertragId);
        if (error) throw error;
        toast({ title: "✅ Startdatum aktualisiert", description: "Startdatum wurde erfolgreich aktualisiert." });
        setEditingMietvertrag(null);
        await queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] });
        await queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] });
        return;
      }

      // Handle neue_anschrift
      if (field === 'neue_anschrift') {
        const { error } = await supabase.from('mietvertrag').update({ [field]: value.trim() }).eq('id', vertragId);
        if (error) throw error;
        toast({ title: "Aktualisiert", description: "Neue Anschrift wurde erfolgreich aktualisiert." });
        setEditingMietvertrag(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] }),
          queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] }),
          queryClient.invalidateQueries({ queryKey: ['immobilien'] }),
        ]);
        return;
      }

      // Handle numeric fields (kaltmiete, betriebskosten, ruecklastschrift_gebuehr)
      const numericValue = parseFloat(value);
      if (isNaN(numericValue)) {
        toast({ title: "Fehler", description: "Bitte geben Sie einen gültigen Betrag ein.", variant: "destructive" });
        return;
      }
      const oldKaltmiete = Number(vertrag?.kaltmiete || 0);
      if (field === 'kaltmiete' && numericValue !== oldKaltmiete) {
        setPendingKaltmieteValue(numericValue);
        setShowRentIncreaseConfirm(true);
        return;
      }
      await saveNumericField(field, numericValue, false);
    } catch (error) {
      const fieldName = field === 'kaltmiete' ? 'Kaltmiete' : field === 'betriebskosten' ? 'Betriebskosten' : field === 'neue_anschrift' ? 'Neue Anschrift' : 'Rücklastschrift-Gebühr';
      toast({ title: "Fehler", description: `${fieldName} konnte nicht aktualisiert werden.`, variant: "destructive" });
    }
  };

  const handleRentIncreaseConfirm = async (isOfficialIncrease: boolean) => {
    if (pendingGlobalUpdates) {
      const updates = { ...pendingGlobalUpdates };
      if (isOfficialIncrease) {
        updates.letzte_mieterhoehung_am = new Date().toISOString().split('T')[0];
      }
      await finishGlobalSave(updates);
      setPendingGlobalUpdates(null);
    } else if (pendingKaltmieteValue !== null) {
      await saveNumericField('kaltmiete', pendingKaltmieteValue, isOfficialIncrease);
    }
    setShowRentIncreaseConfirm(false);
    setPendingKaltmieteValue(null);
  };

  const handleEditKaution = async (field: 'soll' | 'ist', value: string) => {
    try {
      const numericValue = parseFloat(value);
      if (isNaN(numericValue)) {
        toast({ title: "Fehler", description: "Bitte geben Sie einen gültigen Betrag ein.", variant: "destructive" });
        return;
      }
      const updateData = field === 'soll' ? { kaution_betrag: numericValue } : { kaution_ist: numericValue };
      const { error } = await supabase.from('mietvertrag').update(updateData).eq('id', vertragId);
      if (error) throw error;
      toast({ title: "Aktualisiert", description: `Kaution ${field === 'soll' ? 'Soll' : 'Ist'} wurde erfolgreich aktualisiert.` });
      const altKautionWert = field === 'soll' ? Number(vertrag?.kaution_betrag ?? 0) : Number(vertrag?.kaution_ist ?? 0);
      const mieterNameKaution = mieter?.map(m => `${m.vorname} ${m.nachname}`.trim()).join(', ') || undefined;
      logActivity('kaution_geaendert', 'mietvertrag', vertragId, { feld: field, altWert: altKautionWert, neuerWert: numericValue, mieter: mieterNameKaution });
      setEditingKaution(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['immobilien'] }),
      ]);
    } catch (error) {
      toast({ title: "Fehler", description: "Kaution konnte nicht aktualisiert werden.", variant: "destructive" });
    }
  };

  const handleEditMeter = async (field: string, value: string) => {
    try {
      const numericValue = parseFloat(value);
      if (isNaN(numericValue)) {
        toast({ title: "Fehler", description: "Bitte geben Sie einen gültigen Zählerstand ein.", variant: "destructive" });
        return;
      }
      const { error } = await supabase.from('mietvertrag').update({ [field]: numericValue }).eq('id', vertragId);
      if (error) throw error;

      // History-Eintrag in zaehlerstand_historie
      if (einheitData?.id) {
        const quelle = field.endsWith('_einzug') ? 'einzug' : 'auszug';
        const typ = field.replace('_einzug', '').replace('_auszug', '');
        const zaehlerNrKey = `${typ}_zaehler` as keyof Einheit;
        const { error: histError } = await supabase.from('zaehlerstand_historie').insert({
          einheit_id: einheitData.id,
          zaehler_typ: typ,
          zaehler_nummer: (einheitData[zaehlerNrKey] as string | null) ?? null,
          stand: numericValue,
          datum: format(new Date(), 'yyyy-MM-dd'),
          quelle,
        });
        if (!histError) {
          queryClient.invalidateQueries({ queryKey: ['zaehlerstand-historie'] });
        }
      }

      toast({ title: "Aktualisiert", description: "Zählerstand wurde erfolgreich aktualisiert." });
      setEditingMeter(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] }),
      ]);
    } catch (error) {
      toast({ title: "Fehler", description: "Zählerstand konnte nicht aktualisiert werden.", variant: "destructive" });
    }
  };

  const handleEditMeterNumber = async (field: string, value: string) => {
    try {
      if (!einheitData?.id) {
        toast({ title: "Fehler", description: "Einheit nicht gefunden.", variant: "destructive" });
        return;
      }
      const { error } = await supabase.from('einheiten').update({ [field]: value }).eq('id', einheitData.id);
      if (error) throw error;
      toast({ title: "Aktualisiert", description: "Zählernummer wurde erfolgreich aktualisiert." });
      setEditingMeterNumber(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['einheit-detail', einheitData.id] }),
        queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['einheiten'] }),
      ]);
    } catch (error) {
      toast({ title: "Fehler", description: "Zählernummer konnte nicht aktualisiert werden.", variant: "destructive" });
    }
  };

  const handleTerminationSuccess = () => {
    setShowTerminationDialog(false);
    invalidateAll();
    toast({ title: "Kündigung erfolgreich", description: "Der Mietvertrag wurde erfolgreich gekündigt." });
    const mieterNameKuendigung = mieter?.map(m => `${m.vorname} ${m.nachname}`.trim()).join(', ') || undefined;
    logActivity('kuendigung_durchgefuehrt', 'mietvertrag', vertragId, { mieter: mieterNameKuendigung, kuendigungsDatum: vertrag?.kuendigungsdatum ?? undefined });
  };

  // Global edit mode handlers
  const handleStartGlobalEdit = () => {
    const initialValues: Record<string, any> = {
      start_datum: vertrag?.start_datum || '',
      ende_datum: vertrag?.ende_datum || '',
      kaltmiete: vertrag?.kaltmiete || 0,
      betriebskosten: vertrag?.betriebskosten || 0,
      anzahl_personen: vertrag?.anzahl_personen ?? null,
      ruecklastschrift_gebuehr: vertrag?.ruecklastschrift_gebuehr || RUECKLASTSCHRIFT_GEBUEHR_EUR,
      neue_anschrift: vertrag?.neue_anschrift || '',
      bankkonto_mieter: vertrag?.bankkonto_mieter || '',
      kaution_betrag: vertrag?.kaution_betrag || 0,
      kaution_ist: vertrag?.kaution_ist || 0,
      kaltwasser_einzug: vertrag?.kaltwasser_einzug || 0,
      warmwasser_einzug: vertrag?.warmwasser_einzug || 0,
      strom_einzug: vertrag?.strom_einzug || 0,
      gas_einzug: vertrag?.gas_einzug || 0,
      kaltwasser_auszug: vertrag?.kaltwasser_auszug || 0,
      warmwasser_auszug: vertrag?.warmwasser_auszug || 0,
      strom_auszug: vertrag?.strom_auszug || 0,
      gas_auszug: vertrag?.gas_auszug || 0,
    };
    if (einheitData) {
      initialValues.kaltwasser_zaehler = einheitData.kaltwasser_zaehler || '';
      initialValues.warmwasser_zaehler = einheitData.warmwasser_zaehler || '';
      initialValues.strom_zaehler = einheitData.strom_zaehler || '';
      initialValues.gas_zaehler = einheitData.gas_zaehler || '';
      initialValues.qm = einheitData.qm ?? null;
      initialValues.soll_miete = einheitData.soll_miete ?? null;
    }
    if (mieter) {
      mieter.forEach((m) => {
        initialValues[`mieter_${m.id}_vorname`] = m.vorname || '';
        initialValues[`mieter_${m.id}_nachname`] = m.nachname || '';
        initialValues[`mieter_${m.id}_hauptmail`] = m.hauptmail || '';
        initialValues[`mieter_${m.id}_telnr`] = m.telnr || '';
      });
    }
    setEditedValues(initialValues);
    setIsGlobalEditMode(true);
  };

  const handleCancelGlobalEdit = () => {
    setEditedValues({});
    setIsGlobalEditMode(false);
  };

  const handleSaveGlobalEdit = async () => {
    try {
      const mietvertragUpdates: Partial<Mietvertrag> = {};
      const rawStart = (editedValues.start_datum ?? vertrag?.start_datum ?? '') as string;
      const rawEnd = (editedValues.ende_datum ?? vertrag?.ende_datum ?? '') as string;
      const startForDb = rawStart && rawStart.trim() !== '' ? rawStart : null;
      const endForDb = rawEnd && rawEnd.trim() !== '' ? rawEnd : null;

      // Validation: end date must not be before start date
      if (startForDb && endForDb && new Date(endForDb) < new Date(startForDb)) {
        toast({ title: "Ungültiges Datum", description: "Das Mietende kann nicht vor dem Mietbeginn liegen.", variant: "destructive" });
        return;
      }

      // Overlap check only if dates actually changed
      const originalStartDatum = vertrag?.start_datum || '';
      const originalEndDatum = vertrag?.ende_datum || '';
      const startDatumChanged = startForDb !== originalStartDatum;
      const endDatumChanged = endForDb !== originalEndDatum;

      if (vertrag?.einheit_id && startForDb && (startDatumChanged || endDatumChanged)) {
        const { checkContractOverlap } = await import("@/utils/contractOverlapValidation");
        const overlapCheck = await checkContractOverlap(vertrag.einheit_id, startForDb, endForDb, vertragId);
        if (overlapCheck.hasOverlap) {
          toast({ title: "Überschneidung erkannt", description: overlapCheck.warningMessage || "Zeitraum überschneidet sich mit einem bestehenden Vertrag.", variant: "destructive" });
          return;
        }
      }

      const mietvertragFields = [
        'start_datum', 'ende_datum', 'kaltmiete', 'betriebskosten', 'anzahl_personen',
        'ruecklastschrift_gebuehr', 'neue_anschrift', 'bankkonto_mieter',
        'kaution_betrag', 'kaution_ist',
        'kaltwasser_einzug', 'warmwasser_einzug', 'strom_einzug', 'gas_einzug',
        'kaltwasser_auszug', 'warmwasser_auszug', 'strom_auszug', 'gas_auszug',
      ];

      mietvertragFields.forEach(field => {
        if (editedValues[field] !== undefined) {
          if (field === 'start_datum') { mietvertragUpdates.start_datum = startForDb; return; }
          if (field === 'ende_datum') {
            mietvertragUpdates.ende_datum = endForDb;
            if (endForDb && new Date(endForDb) < new Date()) mietvertragUpdates.status = 'beendet';
            return;
          }
          mietvertragUpdates[field] = editedValues[field];
        }
      });

      // Check if kaltmiete changed
      const oldKaltmiete = Number(vertrag?.kaltmiete || 0);
      const newKaltmiete = Number(editedValues.kaltmiete ?? oldKaltmiete);
      if (newKaltmiete !== oldKaltmiete) {
        setPendingGlobalUpdates(mietvertragUpdates);
        setPendingKaltmieteValue(newKaltmiete);
        setShowRentIncreaseConfirm(true);
        return;
      }

      await finishGlobalSave(mietvertragUpdates);
    } catch (error) {
      toast({ title: "Fehler", description: "Die Änderungen konnten nicht gespeichert werden.", variant: "destructive" });
    }
  };

  const finishGlobalSave = async (mietvertragUpdates: Partial<Mietvertrag>) => {
    try {
      if (Object.keys(mietvertragUpdates).length > 0) {
        const { error } = await supabase.from('mietvertrag').update(mietvertragUpdates).eq('id', vertragId);
        if (error) throw error;
      }

      // History-Einträge für geänderte Zählerstände im Global-Edit-Mode
      if (einheitData?.id) {
        const zaehlerFelder = [
          'kaltwasser_einzug', 'warmwasser_einzug', 'strom_einzug', 'gas_einzug',
          'kaltwasser_auszug', 'warmwasser_auszug', 'strom_auszug', 'gas_auszug',
        ] as const;
        const today = format(new Date(), 'yyyy-MM-dd');
        const inserts = zaehlerFelder
          .filter(f => (mietvertragUpdates as Record<string, unknown>)[f] != null)
          .map(f => {
            const quelle = f.endsWith('_einzug') ? 'einzug' : 'auszug';
            const typ = f.replace('_einzug', '').replace('_auszug', '');
            const zaehlerNrKey = `${typ}_zaehler` as keyof Einheit;
            return {
              einheit_id: einheitData!.id,
              zaehler_typ: typ,
              zaehler_nummer: (einheitData![zaehlerNrKey] as string | null) ?? null,
              stand: (mietvertragUpdates as Record<string, unknown>)[f] as number,
              datum: today,
              quelle,
            };
          });
        if (inserts.length > 0) {
          const { error: histError } = await supabase.from('zaehlerstand_historie').insert(inserts);
          if (!histError) {
            queryClient.invalidateQueries({ queryKey: ['zaehlerstand-historie'] });
          }
        }
      }

      // Update einheit fields
      if (einheitData) {
        const einheitUpdates: Partial<Einheit> = {};
        ['kaltwasser_zaehler', 'warmwasser_zaehler', 'strom_zaehler', 'gas_zaehler', 'qm', 'soll_miete'].forEach(field => {
          if (editedValues[field] !== undefined) einheitUpdates[field] = editedValues[field];
        });
        if (Object.keys(einheitUpdates).length > 0) {
          const { error } = await supabase.from('einheiten').update(einheitUpdates).eq('id', einheitData.id);
          if (error) throw error;
        }
      }

      // Update mieter data
      if (mieter) {
        for (const m of mieter) {
          const mieterUpdates: Partial<Mieter> = {};
          if (editedValues[`mieter_${m.id}_vorname`] !== undefined) mieterUpdates.vorname = editedValues[`mieter_${m.id}_vorname`] as string;
          if (editedValues[`mieter_${m.id}_nachname`] !== undefined) mieterUpdates.nachname = editedValues[`mieter_${m.id}_nachname`] as string;
          if (editedValues[`mieter_${m.id}_hauptmail`] !== undefined) mieterUpdates.hauptmail = editedValues[`mieter_${m.id}_hauptmail`] as string;
          if (editedValues[`mieter_${m.id}_telnr`] !== undefined) mieterUpdates.telnr = editedValues[`mieter_${m.id}_telnr`] as string;
          if (Object.keys(mieterUpdates).length > 0) {
            const { error } = await supabase.from('mieter').update(mieterUpdates).eq('id', m.id);
            if (error) throw error;
          }
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mietvertrag-detail', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['mietvertrag-mieter-detail', vertragId] }),
        queryClient.invalidateQueries({ queryKey: ['einheit-detail', einheitData?.id] }),
        queryClient.invalidateQueries({ queryKey: ['rueckstaende'] }),
        queryClient.invalidateQueries({ queryKey: ['immobilie-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['immobilien'] }),
        queryClient.invalidateQueries({ queryKey: ['einheiten'] }),
        queryClient.invalidateQueries({ queryKey: ['mietaufstellung-bank'] }),
        queryClient.invalidateQueries({ queryKey: ['all-mietvertraege'] }),
        queryClient.invalidateQueries({ queryKey: ['mietvertraege'] }),
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'mietvertrag-detail' }),
        queryClient.invalidateQueries({ queryKey: ['mieter'] }),
        queryClient.invalidateQueries({ queryKey: ['all-tenants'] }),
        queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && (query.queryKey[0] === 'mietvertrag-mieter' || query.queryKey[0] === 'mietvertrag-mieter-detail') }),
      ]);

      const isRentIncrease = mietvertragUpdates.letzte_mieterhoehung_am;
      toast({
        title: isRentIncrease ? "Mieterhöhung dokumentiert" : "Erfolgreich gespeichert",
        description: isRentIncrease ? "Kaltmiete wurde erhöht und Datum der letzten Mieterhöhung wurde automatisch gesetzt." : "Alle Änderungen wurden übernommen.",
      });

      const mieterNameGlobal = mieter?.map(m => `${m.vorname} ${m.nachname}`.trim()).join(', ') || undefined;
      const feldLabels: Record<string, string> = {
        kaltmiete: 'Kaltmiete', betriebskosten: 'Betriebskosten', start_datum: 'Startdatum',
        ende_datum: 'Mietende', kaution_betrag: 'Kaution Soll', kaution_ist: 'Kaution Ist',
        anzahl_personen: 'Personenzahl', neue_anschrift: 'Neue Anschrift', ruecklastschrift_gebuehr: 'Rücklastschrift-Gebühr',
        bankkonto_mieter: 'Bankkonto',
      };
      const lesbareFelder = Object.keys(mietvertragUpdates)
        .filter(f => f !== 'letzte_mieterhoehung_am' && f !== 'status')
        .map(f => feldLabels[f] ?? f);
      logActivity(
        isRentIncrease ? 'mieterhoehung_dokumentiert' : 'mietvertrag_geaendert',
        'mietvertrag',
        vertragId,
        { geaenderteFelder: lesbareFelder, mieter: mieterNameGlobal }
      );

      setIsGlobalEditMode(false);
      setEditedValues({});
    } catch (error) {
      toast({ title: "Fehler", description: "Die Änderungen konnten nicht gespeichert werden.", variant: "destructive" });
    }
  };

  const handleUpdateEditedValue = (key: string, value: unknown) => {
    setEditedValues(prev => ({ ...prev, [key]: value }));
  };

  const handleRentIncreaseCancel = () => {
    setShowRentIncreaseConfirm(false);
    setPendingKaltmieteValue(null);
    setPendingGlobalUpdates(null);
    setEditingMietvertrag(null);
  };

  return {
    // Per-field editing
    editingKaution, setEditingKaution,
    editingMietvertrag, setEditingMietvertrag,
    editingMeter, setEditingMeter,
    editingMeterNumber, setEditingMeterNumber,

    // Global edit
    isGlobalEditMode, editedValues,
    handleStartGlobalEdit, handleCancelGlobalEdit, handleSaveGlobalEdit,
    handleUpdateEditedValue,

    // Mutations
    handleEditMietvertrag,
    handleEditKaution,
    handleEditMeter,
    handleEditMeterNumber,
    handleTerminationSuccess,

    // Rent increase confirmation
    showRentIncreaseConfirm, handleRentIncreaseConfirm, handleRentIncreaseCancel,

    // Dialog visibility
    showCreateForderungModal, setShowCreateForderungModal,
    showTerminationDialog, setShowTerminationDialog,
    showMahnungModal, setShowMahnungModal,
  };
}
