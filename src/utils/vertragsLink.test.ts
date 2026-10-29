import { describe, expect, it } from 'vitest';
import { vertragAusAdresse, vertragsLink } from './vertragsLink';

const id = '3257980e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('vertragsLink', () => {
  it('baut die Adresse und liest sie wieder', () => {
    expect(vertragsLink(id)).toBe(`/?vertrag=${id}`);
    expect(vertragAusAdresse(`?vertrag=${id}`)).toBe(id);
    expect(vertragAusAdresse(vertragsLink(id).slice(1))).toBe(id);
  });

  it('nimmt nur eine gültige UUID an', () => {
    expect(vertragAusAdresse('')).toBeNull();
    expect(vertragAusAdresse('?vertrag=')).toBeNull();
    expect(vertragAusAdresse('?vertrag=123')).toBeNull();
    expect(vertragAusAdresse(`?vertrag=${id}%27%20or%201%3D1`)).toBeNull();
    expect(vertragAusAdresse(`?andere=${id}`)).toBeNull();
  });
});
