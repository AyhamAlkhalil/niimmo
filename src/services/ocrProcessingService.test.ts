import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import { OCRProcessingService } from './ocrProcessingService';

function docx(dokumentXml: string): Blob {
  const zip = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(dokumentXml),
  });
  return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

describe('Text aus Word-Dateien', () => {
  it('liest Absätze, Tabulatoren und Sonderzeichen wie im alten Vertrag', async () => {
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>NiImmo Projektentwicklung &amp; Bau GmbH</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>2.1</w:t></w:r><w:r><w:tab/><w:t>laufende öffentliche Lasten</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>[x] Zentralschließanlage oder [ ] Einzelschließanlage</w:t></w:r></w:p>' +
      '<w:p></w:p>' +
      '</w:body></w:document>';

    const text = await OCRProcessingService.extractTextFromDocx(docx(xml));
    expect(text.split('\n')).toEqual([
      'NiImmo Projektentwicklung & Bau GmbH',
      '2.1\tlaufende öffentliche Lasten',
      '[x] Zentralschließanlage oder [ ] Einzelschließanlage',
    ]);
  });

  it('weist eine Datei ohne Word-Inhalt zurück', async () => {
    const zip = zipSync({ 'irgendwas.txt': strToU8('x') });
    await expect(OCRProcessingService.extractTextFromDocx(new Blob([zip]))).rejects.toThrow('keine Word-Datei');
  });
});
