import { describe, it, expect } from 'vitest';
import {
    FACET_PREFIX,
    PARAM_VIEW,
    PARAM_DENSITY,
    PARAM_SORT,
    PARAM_QUERY,
    parseUrlState,
    serialiseUrlState
} from '../assets/js/url-state.js';
import { VIEW_GRID, VIEW_CAROUSEL, DENSITY_COMFORTABLE, DENSITY_COMPACT } from '../assets/js/view.js';
import { SORT_ASC, SORT_DESC, SORT_COLLECTION } from '../assets/js/sort.js';

/** The state the page opens in when the URL says nothing. */
const openingState = {
    view: VIEW_GRID,
    density: DENSITY_COMFORTABLE,
    sortField: SORT_COLLECTION,
    sortDirection: SORT_ASC,
    query: '',
    facets: {}
};

describe('parseUrlState', () => {
    it('returns the opening state for an empty query string', () => {
        expect(parseUrlState('')).toEqual(openingState);
        expect(parseUrlState('?')).toEqual(openingState);
    });

    it('returns the opening state for anything that is not a string', () => {
        for (const value of [null, undefined, 42, {}]) {
            expect(parseUrlState(value)).toEqual(openingState);
        }
    });

    it('reads the view, the density and the sort', () => {
        const state = parseUrlState('?view=carousel&density=compact&sort=atk:desc');

        expect(state.view).toBe(VIEW_CAROUSEL);
        expect(state.density).toBe(DENSITY_COMPACT);
        expect(state.sortField).toBe('atk');
        expect(state.sortDirection).toBe(SORT_DESC);
    });

    it('reads the search term, leading and trailing space included', () => {
        expect(parseUrlState('?q=dark%20magician').query).toBe('dark magician');
    });

    it('reads a facet with one value and with several', () => {
        const state = parseUrlState('?f.type=monster&f.attribute=Dark&f.attribute=Light');

        expect(state.facets).toEqual({
            type: ['monster'],
            attribute: ['Dark', 'Light']
        });
    });

    // A hand-edited link is user input like any other.
    it('drops a facet key this build does not have', () => {
        expect(parseUrlState('?f.colour=blue&f.type=monster').facets).toEqual({ type: ['monster'] });
    });

    it('drops an empty facet value rather than filtering on nothing', () => {
        expect(parseUrlState('?f.type=&f.type=monster').facets).toEqual({ type: ['monster'] });
    });

    it('de-duplicates a repeated value, so one filter cannot show two chips', () => {
        expect(parseUrlState('?f.set=LOB&f.set=LOB').facets).toEqual({ set: ['LOB'] });
    });

    it('falls back rather than blanking the page on an unknown view or density', () => {
        const state = parseUrlState('?view=list&density=cosy&sort=acquired:desc');

        expect(state.view).toBe(VIEW_GRID);
        expect(state.density).toBe(DENSITY_COMFORTABLE);
        expect(state.sortField).toBe(SORT_COLLECTION);
        expect(state.sortDirection).toBe(SORT_ASC);
    });

    it('ignores a parameter it does not know', () => {
        expect(parseUrlState('?page=3&utm_source=trello')).toEqual(openingState);
    });

    it('reads a value that needed escaping', () => {
        expect(parseUrlState('?f.race=Beast-Warrior&q=%26%3D%3F').facets.race).toEqual(['Beast-Warrior']);
        expect(parseUrlState('?q=%26%3D%3F').query).toBe('&=?');
    });
});

describe('serialiseUrlState', () => {
    // The shared link to an unfiltered collection should be the site address,
    // not the site address plus a paragraph of defaults.
    it('writes nothing at all for the opening state', () => {
        expect(serialiseUrlState(openingState)).toBe('');
        expect(serialiseUrlState({})).toBe('');
        expect(serialiseUrlState()).toBe('');
    });

    it('omits each value that is already the default', () => {
        const query = serialiseUrlState({ ...openingState, sortField: 'name', sortDirection: SORT_ASC });

        expect(query).toContain(`${PARAM_SORT}=name%3Aasc`);
        expect(query).not.toContain(PARAM_VIEW);
        expect(query).not.toContain(PARAM_DENSITY);
        expect(query).not.toContain(`${PARAM_QUERY}=`);
    });

    it('writes a facet value per parameter rather than joining them', () => {
        const query = serialiseUrlState({ ...openingState, facets: { attribute: ['Dark', 'Light'] } });

        expect(query).toBe(`${FACET_PREFIX}attribute=Dark&${FACET_PREFIX}attribute=Light`);
    });

    // Two selections built up in different orders are the same selection, and
    // a URL that says so is one URL rather than two.
    it('writes facets in a fixed order however the selection was built', () => {
        const one = serialiseUrlState({ ...openingState, facets: { set: ['LOB'], type: ['monster'] } });
        const other = serialiseUrlState({ ...openingState, facets: { type: ['monster'], set: ['LOB'] } });

        expect(one).toBe(other);
    });

    it('trims a search term of whitespace, which filters on nothing anyway', () => {
        expect(serialiseUrlState({ ...openingState, query: '   ' })).toBe('');
        expect(serialiseUrlState({ ...openingState, query: '  dragon  ' })).toContain('q=dragon');
    });

    it('escapes a value that needs it', () => {
        const query = serialiseUrlState({ ...openingState, query: 'a&b=c' });
        expect(query).toBe('q=a%26b%3Dc');
    });

    it('normalises what it writes, so a bad state cannot reach the address bar', () => {
        const query = serialiseUrlState({
            view: 'list',
            density: 'cosy',
            sortField: 'acquired',
            sortDirection: 'sideways',
            facets: {}
        });

        expect(query).toBe('');
    });

    it('survives a malformed facet selection without throwing', () => {
        expect(() =>
            serialiseUrlState({ ...openingState, facets: { type: 'monster', set: null, race: [42, ''] } })
        ).not.toThrow();
        expect(serialiseUrlState({ ...openingState, facets: { type: 'monster' } })).toBe('');
    });
});

describe('the round trip', () => {
    const states = [
        openingState,
        { ...openingState, view: VIEW_CAROUSEL },
        { ...openingState, density: DENSITY_COMPACT },
        { ...openingState, sortField: 'rarity', sortDirection: SORT_DESC },
        { ...openingState, query: 'blue-eyes' },
        { ...openingState, facets: { type: ['monster'], attribute: ['Dark', 'Light'], set: ['LOB'] } },
        {
            view: VIEW_CAROUSEL,
            density: DENSITY_COMPACT,
            sortField: 'atk',
            sortDirection: SORT_DESC,
            query: 'dragon & knight',
            facets: { level: ['4', '7'], rarity: ['ultra'] }
        }
    ];

    it.each(states)('survives serialise then parse: %j', (state) => {
        expect(parseUrlState(serialiseUrlState(state))).toEqual(state);
    });

    it('is stable across a second trip', () => {
        for (const state of states) {
            const once = serialiseUrlState(state);
            expect(serialiseUrlState(parseUrlState(once))).toBe(once);
        }
    });

    it('produces a query string a URL can actually carry', () => {
        for (const state of states) {
            const query = serialiseUrlState(state);
            expect(query).not.toMatch(/[ "<>#]/);
        }
    });
});
