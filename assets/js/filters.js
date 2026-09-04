/**
 * Pure collection logic: filtering, searching, pagination and carousel slotting.
 *
 * Everything here is free of DOM access so it can be unit tested directly.
 * Rendering code is responsible for reading state, calling these functions and
 * writing the result to the page.
 *
 * The facet rules themselves live in facets.js, which declares what a facet is
 * and how its options are counted. This file owns how a card is matched.
 */

import { matchesSelection } from './facets.js';

/**
 * Rarity tiers in ascending scarcity. Index position defines "rare or better",
 * so the order matters — do not sort this alphabetically.
 *
 * Mirrors the Rarity options in the Airtable base. A value missing from this
 * list is rejected by any active rarity filter, so both must be kept in step.
 */
export const RARITY_ORDER = [
    'common',
    'short_print',
    'rare',
    'super',
    'ultra',
    'ultimate',
    'secret',
    'prismatic',
    'collector',
    'ghost',
    'starlight'
];

/** Lowest tier that the "Rare Only" filter accepts. */
const RARE_THRESHOLD = RARITY_ORDER.indexOf('rare');

/** Carousel slot classes, ordered from leftmost to rightmost. */
export const CAROUSEL_POSITIONS = [
    'pos-left',
    'pos-center-left',
    'pos-center',
    'pos-center-right',
    'pos-right'
];

/**
 * Escape a value for safe interpolation into HTML.
 *
 * Card data will come from Airtable, which is user-editable, so every field must
 * be treated as untrusted before it reaches innerHTML.
 *
 * @param {unknown} value - any value; non-strings are coerced
 * @returns {string} the value with HTML-significant characters replaced
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Normalise a raw search box value into a comparable term.
 *
 * @param {unknown} query - raw input value
 * @returns {string} trimmed, lowercased query; empty string when absent
 */
export function normaliseQuery(query) {
    if (query === null || query === undefined) return '';
    return String(query).trim().toLowerCase();
}

/**
 * Test whether a card matches a free-text search across name, type, serial and
 * passcode.
 *
 * An empty query matches everything, so callers can pass the raw input through
 * without branching.
 *
 * The passcode is searched because the suggestions dropdown offers cards by it
 * (see suggest.js). Without it here, typing a passcode would list a card in the
 * dropdown while the results behind it stayed empty — the two would disagree
 * about what the same query means.
 *
 * @param {object} card - a card record
 * @param {string} query - raw or normalised query text
 * @returns {boolean} true when the card should be shown
 */
export function matchesSearch(card, query) {
    const term = normaliseQuery(query);
    if (term === '') return true;

    const haystack = [card.name, card.cardType, card.type, card.serial, card.passcode]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return haystack.includes(term);
}

/**
 * Test a card against the selected type pills.
 *
 * An empty selection applies no constraint. Multiple types are OR'd together.
 *
 * @param {object} card - a card record
 * @param {string[]} types - selected type values, e.g. ['monster', 'spell']
 * @returns {boolean} true when the card should be shown
 */
export function matchesTypes(card, types) {
    if (!types || types.length === 0) return true;
    return types.includes(card.type);
}

/**
 * Test a card against the selected rarity constraint.
 *
 * "rare" is a threshold rather than an exact match: it accepts rare and every
 * tier above it. Unknown rarity values never match a constraint.
 *
 * @param {object} card - a card record
 * @param {string[]} rarities - selected rarity constraints, e.g. ['rare']
 * @returns {boolean} true when the card should be shown
 */
export function matchesRarities(card, rarities) {
    if (!rarities || rarities.length === 0) return true;

    const tier = RARITY_ORDER.indexOf(card.rarity);
    if (tier === -1) return false;

    return rarities.some(rarity => {
        if (rarity === 'rare') return tier >= RARE_THRESHOLD;
        return card.rarity === rarity;
    });
}

/**
 * Filter a collection by facets, the legacy pill groups, and a search term.
 *
 * Groups combine with AND, values within a group combine with OR. Selecting
 * Monster plus Rare Only therefore yields rare-or-better monsters, not the
 * union of the two sets. The facet selection follows exactly the same rule —
 * it is that rule generalised from two hardcoded groups to any number.
 *
 * `types` and `rarities` are the original pill groups. They are kept because
 * the "Rare Only" threshold is not an equality test — it accepts rare and
 * every tier above it — and because the tests written against them are the
 * evidence that generalising the logic did not change it.
 *
 * @param {object[]} cards - the full collection
 * @param {object} [criteria] - filter criteria
 * @param {Record<string, string[]>} [criteria.facets] - selected facet values by key
 * @param {string[]} [criteria.types] - selected type pills
 * @param {string[]} [criteria.rarities] - selected rarity pills
 * @param {string} [criteria.query] - search box text
 * @returns {object[]} a new array of matching cards
 */
export function filterCards(cards, criteria = {}) {
    if (!Array.isArray(cards)) return [];

    const { facets = {}, types = [], rarities = [], query = '' } = criteria;

    return cards.filter(card =>
        matchesTypes(card, types) &&
        matchesRarities(card, rarities) &&
        matchesSelection(card, facets) &&
        matchesSearch(card, query)
    );
}

/**
 * Total number of pages needed to show a set of items.
 *
 * Returns 0 for an empty collection so callers can distinguish "no results"
 * from "one empty page".
 *
 * @param {number} totalItems - number of items to paginate
 * @param {number} perPage - items shown per page
 * @returns {number} page count, never negative
 */
export function getTotalPages(totalItems, perPage) {
    if (!totalItems || totalItems <= 0) return 0;
    if (!perPage || perPage <= 0) return 0;
    return Math.ceil(totalItems / perPage);
}

/**
 * Constrain a page number to the valid range.
 *
 * Guards against stale page state after a filter shrinks the result set.
 *
 * @param {number} page - requested page, 1-indexed
 * @param {number} totalPages - result of getTotalPages
 * @returns {number} a page within [1, totalPages], or 1 when there are no pages
 */
export function clampPage(page, totalPages) {
    if (!totalPages || totalPages <= 0) return 1;
    if (!Number.isFinite(page)) return 1;
    return Math.min(Math.max(Math.trunc(page), 1), totalPages);
}

/**
 * Slice out the items belonging to a single page.
 *
 * The page is clamped first, so an out-of-range page returns real content
 * rather than an empty array.
 *
 * @param {object[]} items - already-filtered items
 * @param {number} page - requested page, 1-indexed
 * @param {number} perPage - items per page
 * @returns {object[]} the items for that page
 */
export function getPageSlice(items, page, perPage) {
    if (!Array.isArray(items) || items.length === 0) return [];
    if (!perPage || perPage <= 0) return [];

    const safePage = clampPage(page, getTotalPages(items.length, perPage));
    const start = (safePage - 1) * perPage;

    return items.slice(start, start + perPage);
}

/**
 * Wrap an index into a circular range.
 *
 * Handles negative values, and returns 0 for an empty collection so callers
 * never propagate NaN from a modulo-by-zero.
 *
 * @param {number} index - possibly out-of-range index
 * @param {number} length - collection length
 * @returns {number} an index within [0, length - 1], or 0 when length is 0
 */
export function wrapIndex(index, length) {
    if (!length || length <= 0) return 0;
    if (!Number.isFinite(index)) return 0;
    return ((Math.trunc(index) % length) + length) % length;
}

/**
 * Offsets to render for a given collection size.
 *
 * Fewer than five cards would otherwise wrap around and place the same card in
 * two slots, so the window narrows instead of repeating.
 *
 * @param {number} length - number of available cards
 * @returns {number[]} offsets relative to the centre card
 */
function getSlotOffsets(length) {
    if (length >= 5) return [-2, -1, 0, 1, 2];
    if (length === 4) return [-1, 0, 1, 2];
    if (length === 3) return [-1, 0, 1];
    if (length === 2) return [0, 1];
    if (length === 1) return [0];
    return [];
}

/**
 * Build the carousel slots around a centre index.
 *
 * Guarantees no card appears twice: with fewer than five cards the window
 * shrinks rather than wrapping onto itself.
 *
 * @param {object[]} cards - the filtered collection
 * @param {number} currentIndex - index of the centre card
 * @returns {{card: object, index: number, position: string, isCenter: boolean}[]}
 *          one entry per visible slot, empty when there are no cards
 */
export function getCarouselSlots(cards, currentIndex) {
    if (!Array.isArray(cards) || cards.length === 0) return [];

    const centre = wrapIndex(currentIndex, cards.length);

    return getSlotOffsets(cards.length).map(offset => {
        const index = wrapIndex(centre + offset, cards.length);

        return {
            card: cards[index],
            index,
            position: CAROUSEL_POSITIONS[offset + 2],
            isCenter: offset === 0
        };
    });
}
