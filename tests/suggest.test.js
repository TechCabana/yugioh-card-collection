import { describe, it, expect } from 'vitest';
import {
    searchSuggestions,
    nextSuggestionIndex,
    SUGGESTION_LIMIT,
    NO_SUGGESTION
} from '../assets/js/suggest.js';
import { matchesSearch } from '../assets/js/filters.js';

/**
 * Covers the search suggestions.
 *
 * Two things are worth testing hardest here. The first is that a suggestion and
 * the filter behind it agree: a dropdown offering a card the results then do
 * not show is worse than no dropdown at all. The second is the highlight,
 * because "nothing highlighted" is a third state either side of the list and is
 * one comparison away from making Down skip the first option.
 */

const card = (fields = {}) => ({
    name: 'Dark Magician',
    type: 'monster',
    rarity: 'ultra',
    cardType: 'Spellcaster / Effect',
    serial: 'LOB-005',
    passcode: '46986414',
    ...fields
});

const collection = [
    card(),
    card({ name: 'Blue-Eyes White Dragon', serial: 'SDK-001', passcode: '89631139' }),
    card({ name: 'Summoned Skull', serial: 'LOB-017', passcode: '70781052' }),
    card({ name: 'Pot of Greed', type: 'spell', serial: 'LOB-119', passcode: '55144522' })
];

describe('searchSuggestions', () => {
    it('offers nothing for an empty query, so the dropdown stays shut', () => {
        expect(searchSuggestions(collection, '')).toEqual([]);
        expect(searchSuggestions(collection, '   ')).toEqual([]);
        expect(searchSuggestions(collection, null)).toEqual([]);
    });

    it('matches on name, regardless of case or surrounding space', () => {
        for (const query of ['magician', 'MAGICIAN', '  magician  ']) {
            expect(searchSuggestions(collection, query).map((s) => s.value))
                .toEqual(['Dark Magician']);
        }
    });

    it('matches on serial', () => {
        expect(searchSuggestions(collection, 'sdk-001').map((s) => s.value))
            .toEqual(['Blue-Eyes White Dragon']);
    });

    // The three ways a collection is actually looked up. A passcode is the one
    // the old search could not answer at all.
    it('matches on passcode', () => {
        expect(searchSuggestions(collection, '70781052').map((s) => s.value))
            .toEqual(['Summoned Skull']);
        expect(searchSuggestions(collection, '7078').map((s) => s.value))
            .toEqual(['Summoned Skull']);
    });

    // Whichever field matched, the suggested term is the name: it is what the
    // search box does something useful with, and picking a card found by
    // passcode then shows every printing of it rather than the one row.
    it('always suggests the name, never the field that matched', () => {
        const [suggestion] = searchSuggestions(collection, '89631139');

        expect(suggestion.value).toBe('Blue-Eyes White Dragon');
        expect(suggestion.label).toBe('Blue-Eyes White Dragon');
        expect(suggestion.detail).toBe('SDK-001');
    });

    // Records are keyed by printing, so a card held twice is two rows. Two
    // identical lines in a dropdown read as a bug rather than as two sleeves.
    it('deduplicates by name across printings', () => {
        const twice = [card({ serial: 'LOB-005' }), card({ serial: 'SDJ-004' })];

        expect(searchSuggestions(twice, 'magician')).toHaveLength(1);
    });

    it('caps the list, so the dropdown cannot cover the page it filters', () => {
        const many = Array.from({ length: 40 }, (_, index) =>
            card({ name: `Dragon ${index}`, serial: `SET-${index}` })
        );

        expect(searchSuggestions(many, 'dragon')).toHaveLength(SUGGESTION_LIMIT);
        expect(searchSuggestions(many, 'dragon', 3)).toHaveLength(3);
        expect(searchSuggestions(many, 'dragon', 0)).toEqual([]);
    });

    it('returns nothing when nothing matches', () => {
        expect(searchSuggestions(collection, 'exodia')).toEqual([]);
    });

    // A named card with no serial and no passcode still maps, and its detail
    // line is simply empty rather than the string "undefined".
    it('carries an empty detail rather than a missing one', () => {
        const bare = [{ name: 'Nameless Set Card', type: 'monster', rarity: 'common' }];

        expect(searchSuggestions(bare, 'nameless')).toEqual([
            { value: 'Nameless Set Card', label: 'Nameless Set Card', detail: '' }
        ]);
    });

    // Matching a card on its passcode alone would otherwise offer an empty row.
    it('skips a card with no name to suggest', () => {
        const unnamed = [{ name: '   ', passcode: '46986414' }, { passcode: '46986414' }];

        expect(searchSuggestions(unnamed, '46986414')).toEqual([]);
    });

    it('survives a malformed collection without throwing', () => {
        expect(searchSuggestions(null, 'dragon')).toEqual([]);
        expect(searchSuggestions(undefined, 'dragon')).toEqual([]);
        expect(() => searchSuggestions([null, undefined, {}], 'dragon')).not.toThrow();
    });

    /*
     * The agreement that matters: every suggestion, applied as the search term,
     * must actually leave its card in the results. This is the assertion that
     * would have caught matchesSearch not knowing about passcodes.
     */
    it('offers only terms the filter behind it can satisfy', () => {
        for (const query of ['magician', 'sdk-001', '70781052', 'greed', 'lob']) {
            for (const suggestion of searchSuggestions(collection, query)) {
                expect(collection.some((entry) => matchesSearch(entry, suggestion.value)))
                    .toBe(true);
            }
        }
    });
});

describe('nextSuggestionIndex', () => {
    // Nothing highlighted is the state the dropdown opens in, and it is not the
    // same as being on the first option: Down has to reach the first, not the
    // second.
    it('moves from nothing highlighted to the near end of the list', () => {
        expect(nextSuggestionIndex(NO_SUGGESTION, 1, 4)).toBe(0);
        expect(nextSuggestionIndex(NO_SUGGESTION, -1, 4)).toBe(3);
    });

    it('steps through the list', () => {
        expect(nextSuggestionIndex(0, 1, 4)).toBe(1);
        expect(nextSuggestionIndex(2, -1, 4)).toBe(1);
    });

    it('wraps at both ends', () => {
        expect(nextSuggestionIndex(3, 1, 4)).toBe(0);
        expect(nextSuggestionIndex(0, -1, 4)).toBe(3);
    });

    it('has nothing to highlight in an empty list', () => {
        expect(nextSuggestionIndex(NO_SUGGESTION, 1, 0)).toBe(NO_SUGGESTION);
        expect(nextSuggestionIndex(0, 1, 0)).toBe(NO_SUGGESTION);
    });

    it('handles a single suggestion by staying on it', () => {
        expect(nextSuggestionIndex(0, 1, 1)).toBe(0);
        expect(nextSuggestionIndex(0, -1, 1)).toBe(0);
    });
});
