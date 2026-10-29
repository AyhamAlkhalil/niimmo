/**
 * Adresse, die einen Mietvertrag direkt öffnet (29.10.2026): Die Liste „Noch offen“ der Startseite öffnet
 * Verträge in einem neuen Tab. Die Navigation liegt sonst nur im sessionStorage und hat keine eigene Adresse;
 * Index.tsx liest den Parameter beim Laden und entfernt ihn danach wieder aus der Adresse.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const vertragsLink = (mietvertragId: string): string => `/?vertrag=${encodeURIComponent(mietvertragId)}`;

/** Die Vertrags-ID aus `window.location.search` — nur eine gültige UUID, sonst null */
export const vertragAusAdresse = (search: string): string | null => {
  const id = new URLSearchParams(search).get('vertrag');
  return id && UUID.test(id) ? id : null;
};
