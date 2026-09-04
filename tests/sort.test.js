import { describe, it, expect } from 'vitest';
import {
    SORT_ASC,
    SORT_DESC,
    SORT_DIRECTIONS,
    SORT_COLLECTION,
    SORT_FIELDS,
    SORT_FIELDS_BY_KEY,
    isValidSortField,
    normaliseSort,
    sortValue,
    parseSortValue,
    sortOptions,
    sortCards
} from '../assets/js/sort.js';
import { RARITY_ORDER } from '../assets/js/filters.js';

/**
 * Fixture spanning every case the comparisons have to handle: monsters with
 * full stats, a Spell and a Trap with none, two cards sharing a rarity, and
 * two sets.
 */
const cards = [
    { name: 'Dark Magician', type: 'monster', rarity: 'ultra', atk: 2500, def: 2100, level: 7, serial: 'LOB-005' },
    { name: 'Blue-Eyes White Dragon', type: 'monster', rarity: 'secret', atk: 3000, def: 2500, level: 8, serial: 'SDK-001' },
    { name: 'Summoned Skull', type: 'monster', rarity: 'rare', atk: 2500, def: 1200, level: 6, serial: 'LOB-017' },
    { name: 'Pot of Greed', type: 'spell', rarity: 'common', atk: null, def: null, level: null, serial: 'LOB-119' },
    { name: 'Mirror Force', type: 'trap', rarity: 'rare', atk: null, def: null, level: null, serial: 'MRD-138' }
];

const names = (result) => result.map((card) => card.name);

describe('SORT_FIELDS', () => {
    it('offers every field the card asked for and no invented one', () => {
        expect(SORT_FIELDS.map((field) => field.key)).toEqual([
            SORT_COLLECTION, 'name', 'atk', 'def', 'level', 'rarity', 'set'
        ]);
    });

    // The card is explicit: data/cards.json has no acquisition date, and an
    // Airtable record id is not time-ordered, so the option cannot be honest.
    it('offers no date field, because the data carries none', () => {
        const keys = SORT_FIELDS.map((field) => field.key).join(' ');
        expect(keys).not.toMatch(/date|acquired|added/i);
    });

    it('gives every real field both directions and a label for each', () => {
        for (const field of SORT_FIELDS) {
            if (field.key === SORT_COLLECTION) continue;

            expect(typeof field.keyOf).toBe('function');
            for (const direction of SORT_DIRECTIONS) {
                expect(field.directions[direction]).toMatch(/\S/);
            }
        }
    });

    it('indexes every field by key', () => {
        expect(Object.keys(SORT_FIELDS_BY_KEY).sort()).toEqual(
            SORT_FIELDS.map((field) => field.key).sort()
        );
    });
});

describe('isValidSortField', () => {
    it('accepts every declared field', () => {
        for (const field of SORT_FIELDS) {
            expect(isValidSortField(field.key)).toBe(true);
        }
    });

    it('rejects anything else, including near misses and prototype keys', () => {
        expect(isValidSortField('ATK')).toBe(false);
        expect(isValidSortField('acquired')).toBe(false);
        expect(isValidSortField('')).toBe(false);
        // Object.hasOwn rather than `in`, so an inherited property cannot pass.
        expect(isValidSortField('toString')).toBe(false);
        expect(isValidSortField('constructor')).toBe(false);
    });

    it('rejects a missing value without throwing', () => {
        expect(isValidSortField(null)).toBe(false);
        expect(isValidSortField(undefined)).toBe(false);
    });
});

describe('normaliseSort', () => {
    it('leaves a valid pair alone', () => {
        expect(normaliseSort('atk', SORT_DESC)).toEqual({ field: 'atk', direction: SORT_DESC });
    });

    it('falls back to collection order for an unknown field', () => {
        expect(normaliseSort('acquired', SORT_DESC)).toEqual({
            field: SORT_COLLECTION,
            direction: SORT_ASC
        });
    });

    it('falls back to ascending for an unknown direction', () => {
        expect(normaliseSort('name', 'sideways')).toEqual({ field: 'name', direction: SORT_ASC });
        expect(normaliseSort('name', undefined)).toEqual({ field: 'name', direction: SORT_ASC });
    });

    // Collection order does not reverse, so a direction it ignores must not be
    // able to reach a shared URL and mean nothing there.
    it('reports collection order as ascending whatever direction is asked for', () => {
        expect(normaliseSort(SORT_COLLECTION, SORT_DESC).direction).toBe(SORT_ASC);
    });

    it('survives a hostile value without throwing', () => {
        expect(normaliseSort({}, [])).toEqual({ field: SORT_COLLECTION, direction: SORT_ASC });
    });
});

describe('sortValue and parseSortValue', () => {
    it('round-trips every option the menu offers', () => {
        for (const option of sortOptions()) {
            expect(parseSortValue(option.value)).toEqual({
                field: option.field,
                direction: option.direction
            });
        }
    });

    it('encodes as field:direction', () => {
        expect(sortValue('rarity', SORT_DESC)).toBe('rarity:desc');
    });

    it('normalises what it encodes, so a bad pair cannot round-trip as itself', () => {
        expect(sortValue('acquired', SORT_DESC)).toBe(`${SORT_COLLECTION}:${SORT_ASC}`);
    });

    it('decodes junk to the default rather than throwing', () => {
        for (const value of ['', 'nonsense', 'name:', ':desc', null, undefined, 42]) {
            expect(parseSortValue(value).field).toBeDefined();
        }
        expect(parseSortValue('nonsense')).toEqual({
            field: SORT_COLLECTION,
            direction: SORT_ASC
        });
    });
});

describe('sortOptions', () => {
    it('offers one entry for collection order and two for every other field', () => {
        expect(sortOptions()).toHaveLength(1 + (SORT_FIELDS.length - 1) * 2);
    });

    it('gives every option a distinct value', () => {
        const values = sortOptions().map((option) => option.value);
        expect(new Set(values).size).toBe(values.length);
    });

    it('names each direction in the field own terms rather than asc and desc', () => {
        const labels = sortOptions().map((option) => option.label);

        expect(labels).toContain('ATK: High to low');
        expect(labels).toContain('Rarity: Rarest first');
        expect(labels).toContain('Name: A to Z');
        expect(labels).toContain('Collection order');
        for (const label of labels) {
            expect(label).not.toMatch(/\basc\b|\bdesc\b/);
        }
    });

    it('leads with collection order, which is the default', () => {
        expect(sortOptions()[0]).toMatchObject({ field: SORT_COLLECTION, direction: SORT_ASC });
    });
});

describe('sortCards', () => {
    it('leaves collection order untouched', () => {
        expect(names(sortCards(cards, SORT_COLLECTION, SORT_ASC))).toEqual(names(cards));
    });

    it('never mutates its input', () => {
        const before = names(cards);
        sortCards(cards, 'atk', SORT_DESC);
        expect(names(cards)).toEqual(before);
    });

    it('returns a new array even for collection order', () => {
        expect(sortCards(cards, SORT_COLLECTION, SORT_ASC)).not.toBe(cards);
    });

    it('sorts by name in both directions', () => {
        const ascending = names(sortCards(cards, 'name', SORT_ASC));
        expect(ascending[0]).toBe('Blue-Eyes White Dragon');
        expect(names(sortCards(cards, 'name', SORT_DESC))).toEqual([...ascending].reverse());
    });

    it('sorts numbers numerically rather than as text', () => {
        // 3000 before 2500 requires a numeric compare; as text "3000" < "2500"
        // is false but "1200" would sort before "900".
        const withSmall = [...cards, { name: 'Kuriboh', rarity: 'common', atk: 300, def: 200, level: 1, serial: 'LOB-100' }];
        const ascending = sortCards(withSmall, 'atk', SORT_ASC)
            .map((card) => card.atk)
            .filter((atk) => atk !== null);

        expect(ascending).toEqual([300, 2500, 2500, 3000]);
    });

    it('sorts rarity by scarcity, not alphabetically', () => {
        const ascending = sortCards(cards, 'rarity', SORT_ASC).map((card) => card.rarity);
        const tiers = ascending.map((rarity) => RARITY_ORDER.indexOf(rarity));

        expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
        // Alphabetically 'common' < 'rare' < 'secret' < 'ultra', which happens
        // to agree; 'ultra' before 'secret' is where scarcity order differs.
        expect(sortCards(cards, 'rarity', SORT_DESC)[0].rarity).toBe('secret');
    });

    it('sorts by the set code rather than the whole serial', () => {
        const sets = sortCards(cards, 'set', SORT_ASC).map((card) => card.serial.split('-')[0]);
        expect(sets).toEqual(['LOB', 'LOB', 'LOB', 'MRD', 'SDK']);
    });

    // "No value" is not "the largest value": reversing an ATK sort must not
    // promote every Spell and Trap to the top of the grid.
    it.each(SORT_DIRECTIONS)('puts cards the field does not apply to last, sorting %s', (direction) => {
        const sorted = sortCards(cards, 'atk', direction);
        const missing = sorted.slice(-2).map((card) => card.name).sort();

        expect(missing).toEqual(['Mirror Force', 'Pot of Greed']);
    });

    it('keeps cards with no value in collection order among themselves', () => {
        const sorted = sortCards(cards, 'level', SORT_DESC);
        expect(names(sorted).slice(-2)).toEqual(['Pot of Greed', 'Mirror Force']);
    });

    // Two cards on 2500 ATK must not swap places between renders of an
    // unchanged selection.
    it('breaks ties with collection order, so the result is stable', () => {
        const tied = sortCards(cards, 'atk', SORT_DESC).filter((card) => card.atk === 2500);
        expect(names(tied)).toEqual(['Dark Magician', 'Summoned Skull']);
        expect(names(sortCards(cards, 'atk', SORT_DESC))).toEqual(
            names(sortCards(cards, 'atk', SORT_DESC))
        );
    });

    it('falls back to collection order for an unknown field rather than emptying the grid', () => {
        expect(names(sortCards(cards, 'acquired', SORT_DESC))).toEqual(names(cards));
    });

    it('returns an empty array for anything that is not a collection', () => {
        expect(sortCards(null, 'name', SORT_ASC)).toEqual([]);
        expect(sortCards(undefined, 'name', SORT_ASC)).toEqual([]);
        expect(sortCards('cards', 'name', SORT_ASC)).toEqual([]);
    });

    it('handles an empty collection and a single card', () => {
        expect(sortCards([], 'name', SORT_ASC)).toEqual([]);
        expect(names(sortCards([cards[0]], 'atk', SORT_DESC))).toEqual(['Dark Magician']);
    });

    it('survives a malformed record without throwing', () => {
        const messy = [{}, { name: 'Real Card', atk: 1000 }, null];
        expect(() => sortCards(messy, 'atk', SORT_ASC)).not.toThrow();
        expect(sortCards(messy, 'atk', SORT_ASC)[0]).toEqual({ name: 'Real Card', atk: 1000 });
    });
});
