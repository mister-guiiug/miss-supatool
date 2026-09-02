import { describe, expect, it } from 'vitest';
import {
  columnNames,
  findTable,
  parseForeignKey,
  parseOpenApiSchema,
  stripSchema,
} from './schema.ts';

/** Extrait fidèle d'un document PostgREST : c'est cette forme-là qu'on reçoit. */
const doc = {
  swagger: '2.0',
  paths: {
    '/': {},
    '/auteurs': { get: {}, post: {}, patch: {}, delete: {} },
    '/livres': { get: {}, post: {}, patch: {}, delete: {} },
    '/livres_en_vue': { get: {} },
  },
  definitions: {
    auteurs: {
      required: ['id', 'nom'],
      properties: {
        id: {
          description: 'Note:\nThis is a Primary Key<pk/>',
          format: 'uuid',
          type: 'string',
        },
        nom: { format: 'text', type: 'string' },
        bio: { format: 'text', type: 'string' },
      },
      type: 'object',
    },
    livres: {
      required: ['id', 'titre'],
      properties: {
        id: {
          description: 'Note:\nThis is a Primary Key<pk/>',
          format: 'bigint',
          type: 'integer',
        },
        titre: { format: 'text', type: 'string' },
        auteur_id: {
          description:
            "Note:\nThis is a Foreign Key to `auteurs.id`.<fk table='auteurs' column='id'/>",
          format: 'uuid',
          type: 'string',
        },
      },
      type: 'object',
    },
    livres_en_vue: {
      properties: {
        titre: { format: 'text', type: 'string' },
      },
      type: 'object',
    },
  },
};

describe('parseOpenApiSchema', () => {
  const schema = parseOpenApiSchema(doc);

  it('relève les tables par ordre alphabétique', () => {
    expect(schema.tables.map(t => t.name)).toEqual([
      'auteurs',
      'livres',
      'livres_en_vue',
    ]);
  });

  it('reconnaît la clé primaire à son marqueur', () => {
    expect(findTable(schema, 'livres')?.primaryKey).toEqual(['id']);
    expect(findTable(schema, 'livres_en_vue')?.primaryKey).toEqual([]);
  });

  it('extrait la clé étrangère de la description', () => {
    const column = findTable(schema, 'livres')?.columns.find(
      c => c.name === 'auteur_id'
    );
    expect(column?.foreignKey).toEqual({ table: 'auteurs', column: 'id' });
  });

  it('marque « obligatoire » ce que PostgREST déclare requis', () => {
    const titre = findTable(schema, 'livres')?.columns.find(
      c => c.name === 'titre'
    );
    const bio = findTable(schema, 'auteurs')?.columns.find(
      c => c.name === 'bio'
    );
    expect(titre?.required).toBe(true);
    expect(bio?.required).toBe(false);
  });

  it("distingue une vue en lecture seule d'une table", () => {
    expect(findTable(schema, 'livres')?.insertable).toBe(true);
    expect(findTable(schema, 'livres_en_vue')?.insertable).toBe(false);
  });

  it('rend le type SQL, pas le type JSON', () => {
    const auteurs = findTable(schema, 'auteurs');
    expect(auteurs ? columnNames(auteurs) : []).toEqual(['id', 'nom', 'bio']);
    expect(
      findTable(schema, 'livres')?.columns.find(c => c.name === 'id')?.type
    ).toBe('bigint');
  });

  it('survit à un document absent, tronqué ou étranger', () => {
    expect(parseOpenApiSchema(undefined).tables).toEqual([]);
    expect(parseOpenApiSchema({ definitions: 'nope' }).tables).toEqual([]);
    expect(
      parseOpenApiSchema({ definitions: { vide: { properties: {} } } }).tables
    ).toEqual([]);
  });
});

describe('parseForeignKey', () => {
  it('retire le schéma du nom de table', () => {
    expect(parseForeignKey("<fk table='public.auteurs' column='id'/>")).toEqual(
      { table: 'auteurs', column: 'id' }
    );
    expect(stripSchema('auteurs')).toBe('auteurs');
  });

  it('rend undefined quand la description ne porte pas de marqueur', () => {
    expect(parseForeignKey('Note: colonne libre')).toBeUndefined();
  });
});
