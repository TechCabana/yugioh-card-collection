/**
 * The browsing state, expressed as a query string.
 *
 * Everything the user chooses — the view, the density, the sort, the search
 * term and every ticked facet — lived only in module variables, so a reload
 * threw it away and a filtered collection could not be linked to. This module
 * is the translation in both directions, and nothing else in the app knows how
 * the URL is spelled.
 *
 * Two properties matter more than the exact spelling:
 *
 * 1. **Nothing is trusted.** A query string is user input, and a hand-edited
 *    or truncated link must land on a working page rather than an empty one.
 *    Every value goes through the same normaliser the rest of the app uses, and
 *    an unknown facet key is dropped rather than left to filter on nothing.
 * 2. **Defaults are absent, not spelled out.** A page in its opening state
 *    produces an empty query string, so the shared URL of an unfiltered
 *    collection is just the site address.
 *
 * Pure and DOM-free: it takes a string and returns a string, so the round trip
 * is testable without a browser. URLSearchParams does the escaping, which is
 * the whole reason there is no delimiter to get wrong.
 */

import { VIEW_DEFAULT, DENSITY_DEFAULT, normaliseView, normaliseDensity } from './view.js';
import { SORT_COLLECTION, normaliseSort, sortValue, parseSortValue } from './sort.js';
import { FACETS, FACETS_BY_KEY } from './facets.js';

/**
 * Prefix marking a parameter as one facet's selection.
 *
 * Namespaced so a facet named `view` or `sort` could never collide with the
 * app's own parameters, and repeated rather than comma-joined — `f.set=LOB`
 * twice is two values, with no separator to escape and no value that could
 * contain one.
 */
export const FACET_PREFIX = 'f.';

/** Parameter names that are not facets. */
export const PARAM_VIEW = 'view';
export const PARAM_DENSITY = 'density';
export const PARAM_SORT = 'sort';
export const PARAM_QUERY = 'q';

/**
 * Read a query string into the state the app runs on.
 *
 * Absent parameters are not an error: each one falls back to the same default
 * the app would have used anyway, so an empty string yields the opening state.
 *
 * @param {unknown} search - a query string, with or without its leading `?`
 * @returns {{view: string, density: string, sortField: string,
 *            sortDirection: string, query: string,
 *            facets: Record<string, string[]>}} the parsed state
 */
export function parseUrlState(search) {
    const params = new URLSearchParams(typeof search === 'string' ? search : '');

    const facets = {};
    for (const [name, value] of params) {
        if (!name.startsWith(FACET_PREFIX)) continue;

        const facetKey = name.slice(FACET_PREFIX.length);
        // A facet this build does not have cannot be checked against anything,
        // so it is dropped rather than kept as a filter nothing can satisfy.
        if (!Object.hasOwn(FACETS_BY_KEY, facetKey)) continue;
        if (value === '') continue;

        const selected = facets[facetKey] ?? (facets[facetKey] = []);
        // A repeated value in a hand-edited URL would otherwise produce a
        // duplicate chip for one filter.
        if (!selected.includes(value)) selected.push(value);
    }

    const sort = parseSortValue(params.get(PARAM_SORT));

    return {
        view: normaliseView(params.get(PARAM_VIEW)),
        density: normaliseDensity(params.get(PARAM_DENSITY)),
        sortField: sort.field,
        sortDirection: sort.direction,
        query: params.get(PARAM_QUERY) ?? '',
        facets
    };
}

/**
 * Write the app's state back out as a query string.
 *
 * Anything sitting at its default is omitted, so the URL says only what the
 * user actually chose. The result carries no leading `?` — the caller decides
 * whether there is one, because an empty string has to become the bare path
 * rather than a dangling question mark.
 *
 * @param {object} [state] - the current state, in the shape parseUrlState returns
 * @returns {string} an escaped query string, empty when nothing is selected
 */
export function serialiseUrlState(state = {}) {
    const params = new URLSearchParams();

    const view = normaliseView(state.view);
    if (view !== VIEW_DEFAULT) params.set(PARAM_VIEW, view);

    const density = normaliseDensity(state.density);
    if (density !== DENSITY_DEFAULT) params.set(PARAM_DENSITY, density);

    const sort = normaliseSort(state.sortField, state.sortDirection);
    if (sort.field !== SORT_COLLECTION) {
        params.set(PARAM_SORT, sortValue(sort.field, sort.direction));
    }

    // Trimmed, because a search of whitespace matches everything and filtering
    // already treats it as empty — see normaliseQuery in filters.js.
    const query = typeof state.query === 'string' ? state.query.trim() : '';
    if (query !== '') params.set(PARAM_QUERY, query);

    // FACETS order rather than object order, so two identical selections built
    // up in different orders produce the same URL.
    for (const facet of FACETS) {
        const selected = state.facets?.[facet.key];
        if (!Array.isArray(selected)) continue;

        for (const value of selected) {
            if (typeof value !== 'string' || value === '') continue;
            params.append(`${FACET_PREFIX}${facet.key}`, value);
        }
    }

    return params.toString();
}
