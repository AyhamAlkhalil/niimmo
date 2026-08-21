import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Copy, Check, Mail, Phone, Building2, Square, XCircle, AlertTriangle, RotateCcw, FileText } from "lucide-react";
import { MietvertragEditableField } from "./MietvertragEditableField";
import { MahnstufeIndicator } from "../MahnstufeIndicator";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditableField } from "@/hooks/useEditableField";
import { useState } from "react";
import { RUECKLASTSCHRIFT_GEBUEHR_EUR } from "@/constants/config";
import { toast } from "sonner";

interface MietvertragContractInfoProps {
  vertrag: any;
  einheit?: any;
  immobilie?: any;
  mieter?: any[];
  isGlobalEditMode?: boolean;
  editedValues?: Record<string, any>;
  onUpdateEditedValue?: (key: string, value: any) => void;
  editingMietvertrag: 'kaltmiete' | 'betriebskosten' | 'neue_anschrift' | 'ruecklastschrift_gebuehr' | 'start_datum' | 'ende_datum' | 'anzahl_personen' | 'mahnstufe' | null;
  onEditMietvertrag: (field: 'kaltmiete' | 'betriebskosten' | 'neue_anschrift' | 'ruecklastschrift_gebuehr' | 'start_datum' | 'ende_datum' | 'anzahl_personen' | 'mahnstufe', value: string) => void;
  onStartEdit: (field: 'kaltmiete' | 'betriebskosten' | 'neue_anschrift' | 'ruecklastschrift_gebuehr' | 'start_datum' | 'ende_datum' | 'anzahl_personen' | 'mahnstufe') => void;
  onCancelEdit: () => void;
  formatDatum: (datum: string) => string;
  formatBetrag: (betrag: number) => string;
  onShowMahnung?: () => void;
  onShowKuendigung?: () => void;
  onShowVertragPdf?: () => void;
}

export function MietvertragContractInfo({
  vertrag,
  einheit,
  immobilie,
  mieter = [],
  isGlobalEditMode = false,
  editedValues = {},
  onUpdateEditedValue,
  editingMietvertrag,
  onEditMietvertrag,
  onStartEdit,
  onCancelEdit,
  formatDatum,
  formatBetrag,
  onShowMahnung,
  onShowKuendigung,
  onShowVertragPdf,
}: MietvertragContractInfoProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const {
    startEditing,
    updateValue,
    cancelEdit,
    getEditingValue,
    isFieldEditing,
    saveSingleField
  } = useEditableField();

  const kaltmiete = isGlobalEditMode && editedValues.kaltmiete !== undefined ? editedValues.kaltmiete : vertrag.kaltmiete;
  const betriebskosten = isGlobalEditMode && editedValues.betriebskosten !== undefined ? editedValues.betriebskosten : vertrag.betriebskosten;
  const anzahlPersonen = isGlobalEditMode && editedValues.anzahl_personen !== undefined ? editedValues.anzahl_personen : vertrag.anzahl_personen;
  const qmValue = isGlobalEditMode && editedValues.qm !== undefined ? editedValues.qm : einheit?.qm;
  const sollMieteValue = isGlobalEditMode && editedValues.soll_miete !== undefined ? editedValues.soll_miete : einheit?.soll_miete;
  const mietbeginnValue = isGlobalEditMode
    ? (editedValues.start_datum ?? (vertrag.start_datum || ''))
    : (vertrag.start_datum || '');

  const mietendeValue = isGlobalEditMode
    ? (editedValues.ende_datum ?? (vertrag.ende_datum || ''))
    : (vertrag.ende_datum || '');

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    toast.success(`${fieldName} kopiert`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const CopyButton = ({ text, fieldName }: { text: string; fieldName: string }) => {
    if (!text || isGlobalEditMode) return null;
    return (
      <button
        onClick={() => copyToClipboard(text, fieldName)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
        title="Kopieren"
      >
        {copiedField === fieldName ? (
          <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    );
  };

  // Tenant helpers
  const getMieterValue = (mieterId: string, field: string, originalValue: any) => {
    const key = `mieter_${mieterId}_${field}`;
    if (isGlobalEditMode && editedValues[key] !== undefined) {
      return editedValues[key];
    }
    if (isFieldEditing(mieterId, field)) {
      return getEditingValue(mieterId, field);
    }
    return originalValue;
  };

  const handleMieterChange = (mieterId: string, field: string, value: any) => {
    if (isGlobalEditMode) {
      onUpdateEditedValue?.(`mieter_${mieterId}_${field}`, value);
    } else {
      updateValue(mieterId, field, value);
    }
  };

  const handleMieterSave = async (mieterId: string, field: string) => {
    await saveSingleField(mieterId, field, { table: 'mieter' });
  };

  const isMieterEditing = (mieterId: string, field: string) => {
    return isGlobalEditMode || isFieldEditing(mieterId, field);
  };

  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-4">
          {/* LEFT: Contract Info - takes most space */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Vertragsdaten</h3>
              <Badge variant={vertrag.status === 'aktiv' ? 'default' : 'secondary'} className="text-[10px] h-5">
                {vertrag.status}
              </Badge>
            </div>

            {/* Objekt & Einheit compact */}
            {(immobilie || einheit) && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {immobilie && (
                  <span className="group flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {immobilie.name}{immobilie.adresse ? ` · ${immobilie.adresse}` : ''}
                    <CopyButton text={`${immobilie.name} ${immobilie.adresse || ''}`} fieldName="Adresse" />
                  </span>
                )}
                {einheit && (
                  <span className="group flex items-center gap-1">
                    <Square className="h-3 w-3" />
                    {einheit.einheitentyp || 'Einheit'} {einheit.etage ? `· ${einheit.etage}` : ''}
                  </span>
                )}
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-2">
              <MietvertragEditableField
                label="Mietbeginn"
                value={mietbeginnValue}
                isEditing={isGlobalEditMode || editingMietvertrag === 'start_datum'}
                onEdit={() => !isGlobalEditMode && onStartEdit('start_datum')}
                onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.('start_datum', raw) : undefined}
                onSave={(value) => {
                  if (isGlobalEditMode) onUpdateEditedValue?.('start_datum', value);
                  else onEditMietvertrag('start_datum', value);
                }}
                onCancel={onCancelEdit}
                type="date"
                formatter={(val) => formatDatum(val as string)}
                hideEditButton={true}
                isGlobalEditMode={isGlobalEditMode}
              />
              <MietvertragEditableField
                label="Mietende"
                value={mietendeValue}
                isEditing={isGlobalEditMode || editingMietvertrag === 'ende_datum'}
                onEdit={() => !isGlobalEditMode && onStartEdit('ende_datum')}
                onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.('ende_datum', raw) : undefined}
                onSave={(value) => {
                  if (isGlobalEditMode) onUpdateEditedValue?.('ende_datum', value);
                  else onEditMietvertrag('ende_datum', value);
                }}
                onCancel={onCancelEdit}
                type="date"
                formatter={(val) => (val ? formatDatum(val as string) : 'Unbefristet')}
                placeholder="Unbefristet"
                hideEditButton={true}
                isGlobalEditMode={isGlobalEditMode}
              />
            </div>

            {/* Rent */}
            <div className="grid grid-cols-2 gap-2">
              <MietvertragEditableField
                label="Kaltmiete"
                value={Number(kaltmiete || 0)}
                isEditing={isGlobalEditMode || editingMietvertrag === 'kaltmiete'}
                onEdit={() => !isGlobalEditMode && onStartEdit('kaltmiete')}
                onValueChange={isGlobalEditMode ? (raw) => {
                  const parsed = parseFloat(raw);
                  onUpdateEditedValue?.('kaltmiete', isNaN(parsed) ? 0 : parsed);
                } : undefined}
                onSave={(value) => {
                  if (isGlobalEditMode) onUpdateEditedValue?.('kaltmiete', parseFloat(value));
                  else onEditMietvertrag('kaltmiete', value);
                }}
                onCancel={onCancelEdit}
                type="number"
                step="0.01"
                className="font-semibold"
                formatter={formatBetrag}
                showLastUpdate={vertrag.letzte_mieterhoehung_am ? formatDatum(vertrag.letzte_mieterhoehung_am) : undefined}
                hideEditButton={true}
                isGlobalEditMode={isGlobalEditMode}
              />
              <MietvertragEditableField
                label="Betriebskosten"
                value={Number(betriebskosten || 0)}
                isEditing={isGlobalEditMode || editingMietvertrag === 'betriebskosten'}
                onEdit={() => !isGlobalEditMode && onStartEdit('betriebskosten')}
                onValueChange={isGlobalEditMode ? (raw) => {
                  const parsed = parseFloat(raw);
                  onUpdateEditedValue?.('betriebskosten', isNaN(parsed) ? 0 : parsed);
                } : undefined}
                onSave={(value) => {
                  if (isGlobalEditMode) onUpdateEditedValue?.('betriebskosten', parseFloat(value));
                  else onEditMietvertrag('betriebskosten', value);
                }}
                onCancel={onCancelEdit}
                type="number"
                step="0.01"
                formatter={formatBetrag}
                hideEditButton={true}
                isGlobalEditMode={isGlobalEditMode}
              />
            </div>

            {/* Warmmiete + QM row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="group flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Warmmiete:</span>
                <span className="text-sm font-bold text-primary">
                  {formatBetrag(Number(kaltmiete || 0) + Number(betriebskosten || 0))}
                </span>
                <CopyButton text={String(Number(kaltmiete || 0) + Number(betriebskosten || 0))} fieldName="Warmmiete" />
              </div>
              <MietvertragEditableField
                label="Wohnfläche (m²)"
                value={qmValue !== null && qmValue !== undefined ? Number(qmValue) : ''}
                isEditing={isGlobalEditMode}
                onEdit={() => {}}
                onValueChange={isGlobalEditMode ? (raw) => {
                  const trimmed = raw.trim();
                  onUpdateEditedValue?.('qm', trimmed === '' ? null : parseFloat(trimmed) || null);
                } : undefined}
                onSave={(value) => {
                  if (isGlobalEditMode) onUpdateEditedValue?.('qm', value ? parseFloat(value) : null);
                }}
                onCancel={onCancelEdit}
                type="number"
                step="0.01"
                placeholder="–"
                formatter={(val) => val ? `${val} m²` : '–'}
                hideEditButton={true}
                isGlobalEditMode={isGlobalEditMode}
              />
            </div>

            {/* SOLL-Miete (Einheit) + Kaltmiete/m² */}
            <div className="grid grid-cols-2 gap-2">
              <MietvertragEditableField
                label="SOLL-Miete (p.m.)"
                value={sollMieteValue !== null && sollMieteValue !== undefined ? Number(sollMieteValue) : ''}
                isEditing={isGlobalEditMode}
                onEdit={() => {}}
                onValueChange={isGlobalEditMode ? (raw) => {
                  const trimmed = raw.trim();
                  onUpdateEditedValue?.('soll_miete', trimmed === '' ? null : parseFloat(trimmed) || null);
                } : undefined}
                onSave={(value) => {
                  if (isGlobalEditMode) onUpdateEditedValue?.('soll_miete', value ? parseFloat(value) : null);
                }}
                onCancel={onCancelEdit}
                type="number"
                step="0.01"
                placeholder="–"
                formatter={(val) => val ? formatBetrag(Number(val)) : '–'}
                hideEditButton={true}
                isGlobalEditMode={isGlobalEditMode}
              />
              {qmValue && Number(qmValue) > 0 ? (
                <div className="group flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Kaltmiete/m²:</span>
                  <span className="text-sm font-semibold text-foreground">
                    {formatBetrag(Number(kaltmiete || 0) / Number(qmValue))}
                  </span>
                </div>
              ) : <div />}
            </div>

            {/* Personen */}
            <div className="grid grid-cols-2 gap-2">
              <div />
              <MietvertragEditableField
                label="Personen"
                value={anzahlPersonen !== null && anzahlPersonen !== undefined ? Number(anzahlPersonen) : ''}
                isEditing={isGlobalEditMode || editingMietvertrag === 'anzahl_personen'}
                onEdit={() => !isGlobalEditMode && onStartEdit('anzahl_personen')}
                onValueChange={isGlobalEditMode ? (raw) => {
                  const trimmed = raw.trim();
                  onUpdateEditedValue?.('anzahl_personen', trimmed === '' ? null : parseInt(trimmed, 10) || null);
                } : undefined}
                onSave={(value) => {
                  if (isGlobalEditMode) onUpdateEditedValue?.('anzahl_personen', value ? parseInt(value, 10) : null);
                  else onEditMietvertrag('anzahl_personen', value);
                }}
                onCancel={onCancelEdit}
                type="number"
                step="1"
                placeholder="–"
                hideEditButton={true}
                isGlobalEditMode={isGlobalEditMode}
              />
            </div>

            {/* Mahnstufe */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">Mahnstufe</p>
                <div className="flex items-center gap-2 mt-1">
                  <MahnstufeIndicator stufe={vertrag.mahnstufe || 0} />
                  <span className="text-sm font-semibold">{vertrag.mahnstufe || 0}</span>

                  {/* Manuell ist nur das Zurücksetzen erlaubt. Erhöht wird die Mahnstufe
                      ausschliesslich beim tatsaechlichen Mahnungsversand. */}
                  {(vertrag.mahnstufe || 0) > 0 && editingMietvertrag !== 'mahnstufe' && (
                    <Button
                      onClick={() => onStartEdit('mahnstufe')}
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs opacity-60 hover:opacity-100"
                      title="Mahnstufe zurücksetzen"
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Zurücksetzen
                    </Button>
                  )}
                  {editingMietvertrag === 'mahnstufe' && (
                    <Select
                      value={String(vertrag.mahnstufe || 0)}
                      onValueChange={(val) => onEditMietvertrag('mahnstufe', val)}
                    >
                      <SelectTrigger className="w-20 h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: (vertrag.mahnstufe || 0) + 1 }, (_, stufe) => (
                          <SelectItem key={stufe} value={String(stufe)}>{stufe}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Steigt nur beim tatsächlichen Mahnungsversand
                </p>
              </div>
              <div />
            </div>

            {/* Rücklastschrift-Gebühr */}
            {vertrag.lastschrift && (
              <MietvertragEditableField
                label="Rücklastschrift-Gebühr"
                value={Number(vertrag.ruecklastschrift_gebuehr || RUECKLASTSCHRIFT_GEBUEHR_EUR)}
                isEditing={editingMietvertrag === 'ruecklastschrift_gebuehr'}
                onEdit={() => onStartEdit('ruecklastschrift_gebuehr')}
                onSave={(value) => onEditMietvertrag('ruecklastschrift_gebuehr', value)}
                onCancel={onCancelEdit}
                type="number"
                step="0.01"
                formatter={formatBetrag}
                hideEditButton={true}
              />
            )}

            {/* IBAN */}
            <div className="contents">
              <MietvertragEditableField
                label="IBAN"
                value={isGlobalEditMode && editedValues.bankkonto_mieter !== undefined ? editedValues.bankkonto_mieter : (vertrag.bankkonto_mieter || '')}
                isEditing={isGlobalEditMode}
                onEdit={() => {}}
                onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.('bankkonto_mieter', raw) : undefined}
                onSave={(value) => { if (isGlobalEditMode) onUpdateEditedValue?.('bankkonto_mieter', value); }}
                onCancel={onCancelEdit}
                type="text"
                placeholder="DE89 3704 0044 0532 0130 00"
                hideEditButton={true}
                isGlobalEditMode={isGlobalEditMode}
                inputClassName="w-full h-8 text-sm sm:w-56 font-mono"
              />
              {!isGlobalEditMode && vertrag.bankkonto_mieter && (
                <div className="group flex items-center gap-1 mt-0.5">
                  <span className="text-xs text-muted-foreground font-mono">{vertrag.bankkonto_mieter}</span>
                  <CopyButton text={vertrag.bankkonto_mieter} fieldName="IBAN" />
                  {!vertrag.bankkonto_mieter_geprueft && (
                    <span className="flex items-center gap-0.5 text-[10px] text-amber-600">
                      <AlertCircle className="h-3 w-3" /> Ungeprüft
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Neue Anschrift for terminated */}
            {(vertrag.status === 'beendet' || vertrag.status === 'gekuendigt') && (
              <MietvertragEditableField
                label="Neue Anschrift"
                value={isGlobalEditMode && editedValues.neue_anschrift !== undefined ? editedValues.neue_anschrift : (vertrag.neue_anschrift || '')}
                isEditing={isGlobalEditMode || editingMietvertrag === 'neue_anschrift'}
                onEdit={() => !isGlobalEditMode && onStartEdit('neue_anschrift')}
                onValueChange={isGlobalEditMode ? (raw) => onUpdateEditedValue?.('neue_anschrift', raw) : undefined}
                onSave={(value) => {
                  if (isGlobalEditMode) onUpdateEditedValue?.('neue_anschrift', value);
                  else onEditMietvertrag('neue_anschrift', value);
                }}
                onCancel={onCancelEdit}
                type="textarea"
                className="text-muted-foreground"
                placeholder="Straße, PLZ Ort"
                hideEditButton={false}
                isGlobalEditMode={isGlobalEditMode}
              />
            )}
          </div>

          {/* RIGHT: Tenant Info - compact & copyable */}
          <div className="space-y-2.5 md:border-l md:pl-4 border-border/50 md:w-72 md:min-w-[18rem]">
            <h3 className="text-sm font-semibold text-foreground">Mieter</h3>
            
            {mieter && mieter.length > 0 ? (
              <div className="space-y-2">
                {mieter.map((m: any) => (
                  <div key={m.id} className="space-y-1.5 p-2.5 rounded-md bg-muted/30 border border-border/30">
                    {/* Name */}
                    <div className="group flex items-center gap-1.5">
                      {isMieterEditing(m.id, 'vorname') ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            type="text"
                            value={getMieterValue(m.id, 'vorname', m.vorname) || ''}
                            onChange={(e) => handleMieterChange(m.id, 'vorname', e.target.value)}
                            className="h-7 text-sm flex-1"
                            placeholder="Vorname"
                          />
                          <Input
                            type="text"
                            value={getMieterValue(m.id, 'nachname', m.nachname) || ''}
                            onChange={(e) => handleMieterChange(m.id, 'nachname', e.target.value)}
                            className="h-7 text-sm flex-1"
                            placeholder="Nachname"
                          />
                          {!isGlobalEditMode && (
                            <>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleMieterSave(m.id, 'vorname')}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => cancelEdit(m.id, 'vorname')}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-medium">
                            {getMieterValue(m.id, 'vorname', m.vorname)} {getMieterValue(m.id, 'nachname', m.nachname)}
                          </span>
                          <CopyButton 
                            text={`${m.vorname || ''} ${m.nachname || ''}`} 
                            fieldName={`Name ${m.id}`} 
                          />
                        </>
                      )}
                    </div>

                    {/* Email */}
                    <div className="group flex items-center gap-1.5">
                      <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      {isMieterEditing(m.id, 'hauptmail') ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            type="email"
                            value={getMieterValue(m.id, 'hauptmail', m.hauptmail) || ''}
                            onChange={(e) => handleMieterChange(m.id, 'hauptmail', e.target.value)}
                            className="h-6 text-xs flex-1"
                          />
                          {!isGlobalEditMode && (
                            <>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => handleMieterSave(m.id, 'hauptmail')}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => cancelEdit(m.id, 'hauptmail')}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">{m.hauptmail || '–'}</span>
                          {m.hauptmail && <CopyButton text={m.hauptmail} fieldName={`Email ${m.id}`} />}
                        </>
                      )}
                    </div>

                    {/* Phone */}
                    <div className="group flex items-center gap-1.5">
                      <Phone className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      {isMieterEditing(m.id, 'telnr') ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            type="tel"
                            value={getMieterValue(m.id, 'telnr', m.telnr) || ''}
                            onChange={(e) => handleMieterChange(m.id, 'telnr', e.target.value)}
                            className="h-6 text-xs flex-1"
                          />
                          {!isGlobalEditMode && (
                            <>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => handleMieterSave(m.id, 'telnr')}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => cancelEdit(m.id, 'telnr')}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">{m.telnr || '–'}</span>
                          {m.telnr && <CopyButton text={m.telnr} fieldName={`Tel ${m.id}`} />}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Keine Mieter zugeordnet</p>
            )}

            {/* Vertragsdokument — auch für gekündigte Verträge, etwa für einen Nachdruck */}
            {onShowVertragPdf && !isGlobalEditMode && (
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onShowVertragPdf}
                  className="h-8 text-xs w-full gap-1.5"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Mietvertrag erzeugen
                </Button>
              </div>
            )}

            {/* Action Buttons - below tenant list */}
            {vertrag.status === 'aktiv' && !isGlobalEditMode && (
              <div className="flex gap-2 pt-1">
                {onShowMahnung && (
                  <Button variant="outline" size="sm" onClick={onShowMahnung} className="h-8 text-xs flex-1 gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Mahnung
                  </Button>
                )}
                {onShowKuendigung && (
                  <Button variant="destructive" size="sm" onClick={onShowKuendigung} className="h-8 text-xs flex-1 gap-1.5">
                    <XCircle className="h-3.5 w-3.5" />
                    Kündigung
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}