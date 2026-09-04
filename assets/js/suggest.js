/**
 * Search suggestions.
 *
 * The search box filtered as you typed and offered nothing else: a name half
 * remembered, or a serial off the sleeve, had to be typed correctly before the
 * page said whether the card was in the collection at all.
 *
 * What a suggestion is, and which cards produce one, is decided here. The
 * dropdown in script.js only renders the list and moves a highlight through it,
 * the same division facets.js and focus.js already keep — pure and DOM-free, so
 * the matching and the wrap-around are testable without a browser.
 */

import { normaliseQuery, wrapIndex } from './filters.js';

/**
 * How many suggestions to offer.
 *
 * A dropdown is a shortcut, not a second results view — the collection already
 * has one of those below it. Eight fits on a phone without covering the page it
 * is filtering.
 */
export const SUGGESTION_LIMIT = 8;

/** Index meaning "no suggestion is highlighted". */
export const NO_SUGGESTION = -1;

/**
 * Suggest search terms for a partial query.
 *
 * A card is a candidate when the query appears in its name, its serial or its
 * passcode — the three things a collection is actually looked up by. The
 * suggested term is always the card's *name*, whichever field matched, because
 * that is what the search box does something useful with: picking a card found
 * by passcode then shows every printing of it rather than the one row.
 *
 * Deduplicated by name for the same reason. Records are keyed by printing, so a
 * card held twice is two rows, and two identical lines in a dropdown look like
 * a bug rather than like two sleeves.
 *
 * @param {object[]} cards - the collection to search
 * @param {unknown} query - raw search box text
 * @param {number} [limit] - most suggestions to return
 * @returns {{value: string, label: string, detail: string}[]} suggestions in
 *   collection order; `value` is what the search box is set to, `detail` the
 *   serial shown beside it to tell two similarly named cards apart
 */
export function searchSuggestions(cards, query, limit = SUGGESTION_LIMIT) {
    const term = normaliseQuery(query);
    if (term === '' || !Array.isArray(cards) || limit <= 0) return [];

    const suggestions = [];
    const seen = new Set();

    for (const card of cards) {
        if (suggestions.length >= limit) break;

        const name = typeof card?.name === 'string' ? card.name.trim() : '';
        // A card with no name has no term to suggest: matching it on its
        // passcode alone would offer the user an empty row to click.
        if (name === '') continue;

        const key = name.toLowerCase();
        if (seen.has(key)) continue;

        const matched = [name, card?.serial, card?.passcode].some(
            (field) => typeof field === 'string' && field.toLowerCase().includes(term)
        );
        if (!matched) continue;

        seen.add(key);
        suggestions.push({
            value: name,
            label: name,
            detail: typeof card?.serial === 'string' ? card.serial : ''
        });
    }

    return suggestions;
}

/**
 * Move the highlight through the suggestion list.
 *
 * Nothing highlighted is the state the dropdown opens in, and it is not the
 * same as being on the first option: the query the user typed is still what
 * would be searched, so Down has to reach the first option rather than the
 * second. From there the list wraps, which is what the combobox pattern asks
 * for and is one modulo away from being subtly wrong at both ends.
 *
 * @param {number} index - the highlighted index, or NO_SUGGESTION for none
 * @param {number} delta - 1 for Down, -1 for Up
 * @param {number} length - number of suggestions on offer
 * @returns {number} the next index, or NO_SUGGESTION when there is nothing to
 *   highlight
 */
export function nextSuggestionIndex(index, delta, length) {
    if (!length || length <= 0) return NO_SUGGESTION;
    if (index === NO_SUGGESTION) return delta > 0 ? 0 : length - 1;
    return wrapIndex(index + delta, length);
}
