import { describe, expect, it } from 'vitest';
import { maskKey, redact, redactDeep } from './redact.ts';

const jwt = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(40)}.${'b'.repeat(30)}`;
const namedKey = `sb_secret_${'C'.repeat(24)}`;

describe('redact', () => {
  it('coupe un JWT dans un message', () => {
    const masked = redact(`Refusé pour apikey=${jwt} sur /rest/v1/clients`);
    expect(masked).not.toContain(jwt);
    expect(masked).toContain('/rest/v1/clients');
  });

  it('coupe une clé nommée', () => {
    expect(redact(`clé ${namedKey}`)).not.toContain(namedKey);
  });

  it('laisse intact un texte sans secret', () => {
    expect(redact('HTTP 404 sur /rest/v1/inconnu')).toBe(
      'HTTP 404 sur /rest/v1/inconnu'
    );
  });
});

describe('maskKey', () => {
  it('garde de quoi reconnaître la clé, pas de quoi s’en servir', () => {
    const masked = maskKey('abcdefghijklmnop');
    expect(masked).toBe('abc…mnop');
    expect(maskKey('court')).toBe('••••');
  });
});

describe('redactDeep', () => {
  it('descend dans les objets et les tableaux', () => {
    const report = {
      table: 'clients',
      erreurs: [{ message: `échec avec ${jwt}` }],
      nombre: 3,
    };
    const clean = redactDeep(report);
    expect(JSON.stringify(clean)).not.toContain(jwt);
    expect(clean.nombre).toBe(3);
    expect(clean.table).toBe('clients');
  });
});
