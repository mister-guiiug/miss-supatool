import { describe, expect, it } from 'vitest';
import {
  parsePgArray,
  qualify,
  quoteIdentifier,
  quoteLiteral,
  tolerateDuplicate,
} from './sql.ts';

describe('quoteIdentifier', () => {
  it('double un guillemet interne', () => {
    expect(quoteIdentifier('ma table')).toBe('"ma table"');
    expect(quoteIdentifier('bizarre"nom')).toBe('"bizarre""nom"');
  });

  it('qualifie avec le schéma', () => {
    expect(qualify('public', 'clients')).toBe('"public"."clients"');
  });
});

describe('quoteLiteral', () => {
  it('double une apostrophe', () => {
    expect(quoteLiteral("l'été")).toBe("'l''été'");
  });

  it('rend NULL sans guillemets', () => {
    expect(quoteLiteral(null)).toBe('NULL');
    expect(quoteLiteral(undefined)).toBe('NULL');
  });
});

describe('tolerateDuplicate', () => {
  it('enveloppe dans un bloc qui avale « existe déjà »', () => {
    const sql = tolerateDuplicate(
      'create policy "p" on "public"."t" for select'
    );
    expect(sql).toContain('do $supatool$');
    expect(sql).toContain('when duplicate_object then null');
    expect(sql).toContain('create policy "p"');
  });

  it("n'empile pas deux points-virgules", () => {
    expect(tolerateDuplicate('create type "e" as enum (\'a\');')).not.toContain(
      ';;'
    );
  });

  it('utilise un délimiteur étiqueté, pas $$', () => {
    // Une expression de contrainte peut contenir `$$` : un délimiteur nu
    // refermerait le bloc au milieu de l'instruction.
    expect(tolerateDuplicate('select 1')).not.toMatch(/do \$\$/);
  });
});

describe('parsePgArray', () => {
  it('accepte un tableau JSON', () => {
    expect(parsePgArray(['anon', 'authenticated'])).toEqual([
      'anon',
      'authenticated',
    ]);
  });

  it('accepte un littéral Postgres', () => {
    expect(parsePgArray('{anon,authenticated}')).toEqual([
      'anon',
      'authenticated',
    ]);
  });

  it('gère les éléments entre guillemets et les virgules internes', () => {
    expect(parsePgArray('{"un, deux",trois}')).toEqual(['un, deux', 'trois']);
  });

  it('rend un tableau vide sur les cas dégénérés', () => {
    expect(parsePgArray('{}')).toEqual([]);
    expect(parsePgArray(null)).toEqual([]);
    expect(parsePgArray(42)).toEqual([]);
  });
});
