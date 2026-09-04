import { describe, it, expect } from 'vitest';
import {
    FACETS,
    FACETS_BY_KEY,
    facetValueLabel,
    matchesFacet,
    matchesSelection,
    facetOptions,
    selectionChips,
    countSelected
} from '../assets/js/facets.js';
import { filterCards } from '../assets/js/filters.js';

/**
 * Covers the facet rules.
 *
 * The counting behaviour is the part worth testing hardest. A faceted filter
 * that counts its own facet against itself tells the user every remaining
 * choice is a dead end, when ticking a second value would actually widen the
 * results — a wrong number that reads as a broken filter.
 */

const card = (fields = {}) => ({
    name: 'Test Card',
    type: 'monster',
    rarity: 'common',
    cardType: 'Insect / Effect',
    attribute: 'Earth',
    level: 4,
    serial: 'SDJ-017',
    isFirstEdition: false,
    ...fields
});

const collection = [
    card({ name: 'Earth Effect 4', attribute: 'Earth', level: 4 }),
    card({ name: 'Earth Normal 3', attribute: 'Earth', level: 3, cardType: 'Beast / Normal' }),
    card({ name: 'Dark First 4', attribute: 'Dark', level: 4, isFirstEdition: true, serial: 'LOB-005' }),
    card({ name: 'Light Rare 2', attribute: 'Light', level: 2, rarity: 'rare', serial: 'LOB-119' })
];

describe('facet definitions', () => {
    it('gives every facet a key, a label and a value reader', () => {
        for (const facet of FACETS) {
            expect(typeof facet.key).toBe('string');
            expect(typeof facet.label).toBe('string');
            expect(typeof facet.values).toBe('function');
            expect(typeof facet.labelFor).toBe('function');
        }
    });

    it('keys every facet uniquely', () => {
        const keys = FACETS.map((facet) => facet.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('reads the race out of the composed card type line', () => {
        expect(FACETS_BY_KEY.race.values(card({ cardType: 'Insect / Effect' }))).toEqual(['Insect']);
    });

    it('reads the set code out of the serial', () => {
        expect(FACETS_BY_KEY.set.values(card({ serial: 'SDJ-017' }))).toEqual(['SDJ']);
    });

    // Every card has an edition. An unticked box means Unlimited, which is a
    // value worth filtering on rather than an absence.
    it('treats edition as a value on every card', () => {
        expect(FACETS_BY_KEY.edition.values(card({ isFirstEdition: true }))).toEqual(['first']);
        expect(FACETS_BY_KEY.edition.values(card({ isFirstEdition: false }))).toEqual(['unlimited']);
        expect(FACETS_BY_KEY.edition.values(card({}))).toEqual(['unlimited']);
    });

    // A Token has no level. Returning nothing keeps it out of every level
    // option rather than inventing a zero.
    it('returns no value where a facet does not apply', () => {
        expect(FACETS_BY_KEY.level.values(card({ level: null }))).toEqual([]);
        expect(FACETS_BY_KEY.attribute.values(card({ attribute: null }))).toEqual([]);
    });

    it('survives a malformed card without throwing', () => {
        for (const facet of FACETS) {
            expect(() => facet.values(null)).not.toThrow();
            expect(() => facet.values({})).not.toThrow();
        }
    });

    /*
     * Has Effect. Monsters only, and the "not applicable" case is the whole
     * point: hasEffect is null for a spell or a trap, and undefined on every
     * card mapped before the field was published. Both have to read as "no
     * value" rather than as "no effect", or the facet would offer Normal for
     * a Trap and for the entire pre-sync collection.
     */
    describe('the effect facet', () => {
        it('reads a monster as Effect or Normal', () => {
            expect(FACETS_BY_KEY.effect.values(card({ hasEffect: true }))).toEqual(['effect']);
            expect(FACETS_BY_KEY.effect.values(card({ hasEffect: false }))).toEqual(['normal']);
        });

        it('offers no value for a card the concept does not apply to', () => {
            expect(FACETS_BY_KEY.effect.values(card({ hasEffect: null }))).toEqual([]);
        });

        // The live data/cards.json predates the field, so every card in it
        // reaches this function with hasEffect undefined. It must behave
        // exactly like the null case rather than falling through to 'normal'.
        it('offers no value for a card published before the field existed', () => {
            expect(FACETS_BY_KEY.effect.values(card({}))).toEqual([]);
            expect(FACETS_BY_KEY.effect.values(card({ hasEffect: undefined }))).toEqual([]);
        });

        // Only a real boolean. A truthy string would otherwise be read as an
        // effect monster by a facet whose source field is a checkbox.
        it('offers no value for a non-boolean', () => {
            for (const value of ['true', 1, {}]) {
                expect(FACETS_BY_KEY.effect.values(card({ hasEffect: value }))).toEqual([]);
            }
        });

        it('labels both values the way a card is described', () => {
            expect(facetValueLabel('effect', 'effect')).toBe('Effect');
            expect(facetValueLabel('effect', 'normal')).toBe('Normal');
        });
    });
});

describe('facetValueLabel', () => {
    it('labels a level and a rarity readably', () => {
        expect(facetValueLabel('level', '4')).toBe('Level 4');
        expect(facetValueLabel('rarity', 'ultimate')).toBe('Ultimate Rare');
        expect(facetValueLabel('edition', 'first')).toBe('1st Edition');
    });

    it('echoes the value for an unknown facet rather than throwing', () => {
        expect(facetValueLabel('nonsense', 'x')).toBe('x');
    });
});

describe('matchesFacet', () => {
    it('applies no constraint for an empty selection', () => {
        expect(matchesFacet(card(), 'attribute', [])).toBe(true);
        expect(matchesFacet(card(), 'attribute', undefined)).toBe(true);
    });

    it('ORs values within one facet', () => {
        const dark = card({ attribute: 'Dark' });

        expect(matchesFacet(dark, 'attribute', ['Earth'])).toBe(false);
        expect(matchesFacet(dark, 'attribute', ['Earth', 'Dark'])).toBe(true);
    });

    // A selection left over from a facet that no longer exists should not
    // empty the page.
    it('constrains nothing for an unknown facet key', () => {
        expect(matchesFacet(card(), 'nonsense', ['x'])).toBe(true);
    });
});

describe('matchesSelection', () => {
    it('ANDs facets against each other', () => {
        const target = card({ attribute: 'Earth', level: 4 });

        expect(matchesSelection(target, { attribute: ['Earth'], level: ['4'] })).toBe(true);
        expect(matchesSelection(target, { attribute: ['Earth'], level: ['3'] })).toBe(false);
    });

    it('skips the facet it is told to skip', () => {
        const target = card({ attribute: 'Earth' });

        expect(matchesSelection(target, { attribute: ['Dark'] })).toBe(false);
        expect(matchesSelection(target, { attribute: ['Dark'] }, 'attribute')).toBe(true);
    });

    it('matches everything for an empty selection', () => {
        expect(matchesSelection(card(), {})).toBe(true);
        expect(matchesSelection(card())).toBe(true);
    });
});

describe('facetOptions', () => {
    it('counts every value in the collection', () => {
        const options = facetOptions(collection, 'attribute');

        expect(options).toEqual([
            { value: 'Earth', label: 'Earth', count: 2 },
            { value: 'Dark', label: 'Dark', count: 1 },
            { value: 'Light', label: 'Light', count: 1 }
        ]);
    });

    // The point of the whole counting rule: ticking Earth must not tell the
    // user that Dark now returns nothing, because ticking Dark as well would
    // widen the results to include it.
    it('excludes a facet from its own counts', () => {
        const options = facetOptions(collection, 'attribute', {
            selection: { attribute: ['Earth'] }
        });

        expect(options.find((option) => option.value === 'Dark').count).toBe(1);
        expect(options.find((option) => option.value === 'Earth').count).toBe(2);
    });

    it('narrows every other facet against the selection', () => {
        const levels = facetOptions(collection, 'level', {
            selection: { attribute: ['Earth'] }
        });

        expect(levels.find((option) => option.value === '4').count).toBe(1);
        expect(levels.find((option) => option.value === '2').count).toBe(0);
    });

    it('keeps an unreachable value at zero rather than dropping it', () => {
        const levels = facetOptions(collection, 'level', {
            selection: { attribute: ['Dark'] }
        });

        // Every level in the collection is still listed, so the menu does not
        // reshuffle under the cursor as boxes are ticked.
        expect(levels.map((option) => option.value)).toEqual(['2', '3', '4']);
        expect(levels.find((option) => option.value === '3').count).toBe(0);
    });

    /*
     * The live data/cards.json has no hasEffect on any card yet — the field
     * only reaches it on the next Airtable sync. buildFacetBar() in script.js
     * skips a facet whose facetOptions() comes back empty, so this is what
     * keeps the Has Effect button off the toolbar until there is data behind
     * it, rather than rendering an empty menu.
     */
    it('returns nothing for a facet no card carries a value for', () => {
        const preSync = collection.map(({ hasEffect, ...rest }) => rest);
        expect(facetOptions(preSync, 'effect')).toEqual([]);
    });

    it('offers both values once the data carries them, effect first', () => {
        const mixed = [
            card({ hasEffect: false }),
            card({ hasEffect: true }),
            card({ hasEffect: true }),
            // A spell: no value either way, so it counts towards neither.
            card({ type: 'spell', hasEffect: null })
        ];

        expect(facetOptions(mixed, 'effect')).toEqual([
            { value: 'effect', label: 'Effect', count: 2 },
            { value: 'normal', label: 'Normal', count: 1 }
        ]);
    });

    it('applies the search predicate to the counts', () => {
        const options = facetOptions(collection, 'attribute', {
            matchesQuery: (candidate) => candidate.name.includes('Dark')
        });

        expect(options.find((option) => option.value === 'Dark').count).toBe(1);
        expect(options.find((option) => option.value === 'Earth').count).toBe(0);
    });

    it('orders levels numerically and rarities by scarcity', () => {
        const many = [
            card({ level: 10 }), card({ level: 2 }), card({ level: 4 })
        ];
        expect(facetOptions(many, 'level').map((option) => option.value)).toEqual(['2', '4', '10']);

        const rarities = [
            card({ rarity: 'ultimate' }), card({ rarity: 'common' }), card({ rarity: 'rare' })
        ];
        expect(facetOptions(rarities, 'rarity').map((option) => option.value))
            .toEqual(['common', 'rare', 'ultimate']);
    });

    it('orders the rest commonest first', () => {
        expect(facetOptions(collection, 'attribute').map((option) => option.count))
            .toEqual([2, 1, 1]);
    });

    it('returns nothing for an unknown facet or a non-array collection', () => {
        expect(facetOptions(collection, 'nonsense')).toEqual([]);
        expect(facetOptions(null, 'attribute')).toEqual([]);
    });
});

describe('selectionChips', () => {
    it('flattens a selection into one chip per value, in facet order', () => {
        const chips = selectionChips({ level: ['4'], attribute: ['Earth', 'Dark'] });

        // attribute is declared before level in FACETS, so it leads whatever
        // order the selection object happened to be built in.
        expect(chips.map((chip) => chip.label)).toEqual(['Earth', 'Dark', 'Level 4']);
        expect(chips[0]).toMatchObject({ facetKey: 'attribute', facetLabel: 'Attribute' });
    });

    it('returns nothing for an empty selection', () => {
        expect(selectionChips({})).toEqual([]);
        expect(selectionChips()).toEqual([]);
    });
});

describe('countSelected', () => {
    it('totals values across facets', () => {
        expect(countSelected({ attribute: ['Earth', 'Dark'], level: ['4'] })).toBe(3);
        expect(countSelected({})).toBe(0);
        expect(countSelected()).toBe(0);
    });
});

describe('filterCards with facets', () => {
    it('ANDs facets and ORs within one', () => {
        const earthOrDark = filterCards(collection, { facets: { attribute: ['Earth', 'Dark'] } });
        expect(earthOrDark).toHaveLength(3);

        const earthLevel4 = filterCards(collection, {
            facets: { attribute: ['Earth'], level: ['4'] }
        });
        expect(earthLevel4.map((match) => match.name)).toEqual(['Earth Effect 4']);
    });

    it('ANDs the search term on top of the facets', () => {
        const matches = filterCards(collection, {
            facets: { attribute: ['Earth'] },
            query: 'Normal'
        });

        expect(matches.map((match) => match.name)).toEqual(['Earth Normal 3']);
    });

    it('applies no constraint for an empty facet selection', () => {
        expect(filterCards(collection, { facets: {} })).toHaveLength(collection.length);
    });

    // The counts a menu shows have to agree with what filtering actually
    // returns, or the number beside a value is a lie.
    it('agrees with the counts facetOptions reports', () => {
        const selection = { attribute: ['Earth'] };

        for (const option of facetOptions(collection, 'level', { selection })) {
            const matches = filterCards(collection, {
                facets: { ...selection, level: [option.value] }
            });

            expect(matches).toHaveLength(option.count);
        }
    });
});
