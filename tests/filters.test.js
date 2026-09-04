import { describe, it, expect } from 'vitest';
import {
    escapeHtml,
    normaliseQuery,
    matchesSearch,
    matchesTypes,
    matchesRarities,
    filterCards,
    getTotalPages,
    clampPage,
    getPageSlice,
    wrapIndex,
    getCarouselSlots,
    CAROUSEL_POSITIONS
} from '../assets/js/filters.js';

/** Minimal fixture covering every type and a spread of rarities. */
const cards = [
    { name: 'Dark Magician', type: 'monster', rarity: 'ultra', cardType: 'Spellcaster / Effect', serial: 'LOB-005' },
    { name: 'Blue-Eyes White Dragon', type: 'monster', rarity: 'secret', cardType: 'Dragon / Normal', serial: 'SDK-001' },
    { name: 'Summoned Skull', type: 'monster', rarity: 'rare', cardType: 'Fiend / Normal', serial: 'LOB-017' },
    { name: 'Pot of Greed', type: 'spell', rarity: 'common', cardType: 'Normal Spell', serial: 'LOB-119' },
    { name: 'Mystical Space Typhoon', type: 'spell', rarity: 'rare', cardType: 'Quick-Play Spell', serial: 'MRL-049' },
    { name: 'Mirror Force', type: 'trap', rarity: 'rare', cardType: 'Normal Trap', serial: 'MRD-138' },
    { name: 'Call of the Haunted', type: 'trap', rarity: 'common', cardType: 'Continuous Trap', serial: 'PSV-012' }
];

const names = result => result.map(card => card.name);

describe('escapeHtml', () => {
    it('renders script tags inert', () => {
        expect(escapeHtml('<script>alert(1)</script>'))
            .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('neutralises an img onerror payload', () => {
        const result = escapeHtml('<img src=x onerror="alert(1)">');
        expect(result).not.toContain('<img');
        expect(result).not.toContain('"');
    });

    it('escapes ampersands before other entities so they are not double-encoded', () => {
        expect(escapeHtml('Fire & Ice')).toBe('Fire &amp; Ice');
        expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
    });

    it('escapes both quote styles', () => {
        expect(escapeHtml(`"double" 'single'`))
            .toBe('&quot;double&quot; &#39;single&#39;');
    });

    it('returns an empty string for null and undefined', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('coerces non-string values to strings before escaping', () => {
        expect(escapeHtml(42)).toBe('42');
        expect(escapeHtml(true)).toBe('true');
    });

    it('leaves ordinary card names untouched', () => {
        expect(escapeHtml('Blue-Eyes White Dragon')).toBe('Blue-Eyes White Dragon');
    });
});

describe('normaliseQuery', () => {
    it('trims surrounding whitespace and lowercases', () => {
        expect(normaliseQuery('  DRAGON  ')).toBe('dragon');
    });

    it('treats null, undefined and blank input as empty', () => {
        expect(normaliseQuery(null)).toBe('');
        expect(normaliseQuery(undefined)).toBe('');
        expect(normaliseQuery('   ')).toBe('');
    });
});

describe('matchesSearch', () => {
    const card = cards[0];

    it('matches on name regardless of case', () => {
        expect(matchesSearch(card, 'dark')).toBe(true);
        expect(matchesSearch(card, 'DARK')).toBe(true);
    });

    it('matches on card type', () => {
        expect(matchesSearch(card, 'spellcaster')).toBe(true);
    });

    it('matches on serial', () => {
        expect(matchesSearch(card, 'lob-005')).toBe(true);
    });

    // The suggestions dropdown offers a card by its passcode, so the filter
    // behind it has to accept one too — otherwise the dropdown lists a card
    // while the results below stay empty for the same query.
    it('matches on passcode', () => {
        expect(matchesSearch({ ...card, passcode: '46986414' }, '46986414')).toBe(true);
        expect(matchesSearch({ ...card, passcode: '46986414' }, '4698')).toBe(true);
    });

    it('survives a card with no passcode, which is how an unmirrored card maps', () => {
        expect(matchesSearch({ ...card, passcode: '' }, 'dark')).toBe(true);
        expect(matchesSearch({ ...card, passcode: '' }, '46986414')).toBe(false);
    });

    it('ignores surrounding whitespace', () => {
        expect(matchesSearch(card, '  magician  ')).toBe(true);
    });

    it('returns false when nothing matches', () => {
        expect(matchesSearch(card, 'exodia')).toBe(false);
    });

    it('matches everything when the query is empty', () => {
        expect(matchesSearch(card, '')).toBe(true);
        expect(matchesSearch(card, '   ')).toBe(true);
    });
});

describe('matchesTypes', () => {
    it('applies no constraint when nothing is selected', () => {
        expect(matchesTypes(cards[0], [])).toBe(true);
        expect(matchesTypes(cards[0], undefined)).toBe(true);
    });

    it('matches a single selected type', () => {
        expect(matchesTypes(cards[0], ['monster'])).toBe(true);
        expect(matchesTypes(cards[0], ['spell'])).toBe(false);
    });

    it('ORs multiple selected types', () => {
        expect(matchesTypes(cards[3], ['monster', 'spell'])).toBe(true);
    });
});

describe('matchesRarities', () => {
    it('applies no constraint when nothing is selected', () => {
        expect(matchesRarities(cards[3], [])).toBe(true);
    });

    it('treats "rare" as rare-or-better, not an exact match', () => {
        expect(matchesRarities({ rarity: 'rare' }, ['rare'])).toBe(true);
        expect(matchesRarities({ rarity: 'super' }, ['rare'])).toBe(true);
        expect(matchesRarities({ rarity: 'ultra' }, ['rare'])).toBe(true);
        expect(matchesRarities({ rarity: 'secret' }, ['rare'])).toBe(true);
        expect(matchesRarities({ rarity: 'common' }, ['rare'])).toBe(false);
    });

    it('rejects an unknown rarity when a constraint is active', () => {
        expect(matchesRarities({ rarity: 'promo' }, ['rare'])).toBe(false);
    });

    // Every other test above only exercises the "rare" threshold branch (or the
    // tier === -1 early return). This covers the exact-match branch used for any
    // other rarity pill, so a regression there wouldn't slip through untested.
    it('exact-matches a non-"rare" rarity constraint rather than treating it as a threshold', () => {
        expect(matchesRarities({ rarity: 'ultra' }, ['ultra'])).toBe(true);
        expect(matchesRarities({ rarity: 'secret' }, ['ultra'])).toBe(false);
        expect(matchesRarities({ rarity: 'super' }, ['ultra'])).toBe(false);
    });

    it('ORs multiple non-"rare" rarity selections together', () => {
        expect(matchesRarities({ rarity: 'common' }, ['common', 'ultra'])).toBe(true);
        expect(matchesRarities({ rarity: 'ultra' }, ['common', 'ultra'])).toBe(true);
        expect(matchesRarities({ rarity: 'super' }, ['common', 'ultra'])).toBe(false);
    });
});

describe('filterCards', () => {
    it('returns everything when no criteria are given', () => {
        expect(filterCards(cards)).toHaveLength(cards.length);
    });

    it('filters by type only', () => {
        expect(filterCards(cards, { types: ['trap'] })).toHaveLength(2);
    });

    it('filters by rarity only', () => {
        const result = filterCards(cards, { rarities: ['rare'] });
        expect(result).toHaveLength(5);
        expect(names(result)).not.toContain('Pot of Greed');
    });

    // This is the bug the "fix filter combination logic" card addresses: the old
    // implementation OR'd the groups, so this returned common monsters and rare spells.
    it('ANDs across groups while ORing within a group', () => {
        const result = filterCards(cards, { types: ['monster'], rarities: ['rare'] });

        expect(names(result)).toEqual([
            'Dark Magician',
            'Blue-Eyes White Dragon',
            'Summoned Skull'
        ]);
        expect(names(result)).not.toContain('Mirror Force');
        expect(names(result)).not.toContain('Pot of Greed');
    });

    // Proves the AND-across-groups fix also holds for the exact-match rarity
    // branch, not just the "rare" threshold branch exercised above.
    it('ANDs a type filter with an exact (non-threshold) rarity filter', () => {
        const result = filterCards(cards, { types: ['spell'], rarities: ['common'] });
        expect(names(result)).toEqual(['Pot of Greed']);
    });

    it('ANDs the search term on top of the pills', () => {
        const result = filterCards(cards, { types: ['monster'], query: 'dragon' });
        expect(names(result)).toEqual(['Blue-Eyes White Dragon']);
    });

    it('returns an empty array when nothing matches', () => {
        expect(filterCards(cards, { types: ['spell'], query: 'dragon' })).toEqual([]);
    });

    it('does not mutate the source collection', () => {
        const before = [...cards];
        filterCards(cards, { types: ['monster'] });
        expect(cards).toEqual(before);
    });

    it('tolerates a non-array input', () => {
        expect(filterCards(null)).toEqual([]);
    });
});

// getFilterGroup and its two constants routed a pill's data-filter value into
// the type or rarity group. There are no pills: the facet toolbar reads its
// groups from FACETS, and the routing tests went with the code they covered.
// The behaviour they protected — values OR within a group, groups AND against
// each other — is now covered against facets in facets.test.js.

describe('getTotalPages', () => {
    it('divides exactly when the count is a multiple of the page size', () => {
        expect(getTotalPages(36, 18)).toBe(2);
    });

    it('rounds up on a remainder', () => {
        expect(getTotalPages(37, 18)).toBe(3);
        expect(getTotalPages(1, 18)).toBe(1);
    });

    it('returns 0 for an empty collection', () => {
        expect(getTotalPages(0, 18)).toBe(0);
    });

    it('returns 0 for a nonsensical page size rather than dividing by zero', () => {
        expect(getTotalPages(10, 0)).toBe(0);
    });
});

describe('clampPage', () => {
    it('leaves an in-range page alone', () => {
        expect(clampPage(2, 3)).toBe(2);
    });

    it('clamps below the first page', () => {
        expect(clampPage(0, 3)).toBe(1);
        expect(clampPage(-5, 3)).toBe(1);
    });

    it('clamps beyond the last page', () => {
        expect(clampPage(99, 3)).toBe(3);
    });

    it('returns 1 when there are no pages', () => {
        expect(clampPage(4, 0)).toBe(1);
    });

    it('returns 1 for NaN rather than propagating it', () => {
        expect(clampPage(NaN, 3)).toBe(1);
    });
});

describe('getPageSlice', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }));

    it('returns the first page', () => {
        expect(getPageSlice(items, 1, 3).map(i => i.id)).toEqual([1, 2, 3]);
    });

    it('returns a partial final page', () => {
        expect(getPageSlice(items, 3, 3).map(i => i.id)).toEqual([7]);
    });

    it('clamps an out-of-range page instead of returning nothing', () => {
        expect(getPageSlice(items, 99, 3).map(i => i.id)).toEqual([7]);
    });

    it('returns an empty array for an empty collection', () => {
        expect(getPageSlice([], 1, 3)).toEqual([]);
    });
});

describe('wrapIndex', () => {
    it('wraps forward past the end', () => {
        expect(wrapIndex(5, 5)).toBe(0);
        expect(wrapIndex(6, 5)).toBe(1);
    });

    it('wraps backward past the start', () => {
        expect(wrapIndex(-1, 5)).toBe(4);
        expect(wrapIndex(-6, 5)).toBe(4);
    });

    // Guards the NaN bug: the old code evaluated x % 0 when a filter emptied the set.
    it('returns 0 for an empty collection instead of NaN', () => {
        expect(wrapIndex(3, 0)).toBe(0);
        expect(Number.isNaN(wrapIndex(3, 0))).toBe(false);
    });

    it('recovers from a NaN index', () => {
        expect(wrapIndex(NaN, 5)).toBe(0);
    });
});

describe('getCarouselSlots', () => {
    const build = n => Array.from({ length: n }, (_, i) => ({ name: `card-${i}` }));

    it('renders five slots for a full collection', () => {
        const slots = getCarouselSlots(build(12), 0);
        expect(slots).toHaveLength(5);
        expect(slots.map(s => s.position)).toEqual(CAROUSEL_POSITIONS);
    });

    it('centres the requested card', () => {
        const centre = getCarouselSlots(build(12), 4).find(s => s.isCenter);
        expect(centre.index).toBe(4);
        expect(centre.position).toBe('pos-center');
    });

    it('wraps around the ends of a full collection', () => {
        expect(getCarouselSlots(build(12), 0).map(s => s.index))
            .toEqual([10, 11, 0, 1, 2]);
    });

    // The duplication bug: three traps previously rendered one of them twice.
    it.each([1, 2, 3, 4])('renders %i distinct cards without repeating any', n => {
        const slots = getCarouselSlots(build(n), 0);
        expect(slots).toHaveLength(n);
        expect(new Set(slots.map(s => s.index)).size).toBe(n);
    });

    it('shows a single card exactly once, centred', () => {
        const slots = getCarouselSlots(build(1), 0);
        expect(slots).toHaveLength(1);
        expect(slots[0].isCenter).toBe(true);
    });

    it('always produces exactly one centre slot', () => {
        [1, 2, 3, 4, 5, 12].forEach(n => {
            expect(getCarouselSlots(build(n), 0).filter(s => s.isCenter)).toHaveLength(1);
        });
    });

    it('returns no slots for an empty collection', () => {
        expect(getCarouselSlots([], 0)).toEqual([]);
    });

    it('recovers from a NaN index rather than rendering undefined cards', () => {
        const slots = getCarouselSlots(build(3), NaN);
        expect(slots).toHaveLength(3);
        slots.forEach(slot => expect(slot.card).toBeDefined());
    });
});
