/**
 * Facet definitions and counting.
 *
 * The old pill row filtered on card type, which is the one dimension this
 * collection does not vary by: 126 of 128 cards are monsters, and two of the
 * four pills matched nothing at all. What the collection does vary by —
 * attribute, level, race, rarity, edition, set — was already in the data and
 * unreachable from the page.
 *
 * A facet is declared once here, as a key, a label and a function pulling its
 * values off a card. Everything else — the dropdowns, the chips, the counts —
 * is generated from that list, so adding a facet is one entry rather than a
 * round of DOM edits.
 *
 * Pure and DOM-free, so the counting rules are directly testable.
 */

import { RARITY_ORDER } from './filters.js';

/** Human labels for the rarity keys stored in the data. */
const RARITY_LABELS = {
    common: 'Common',
    short_print: 'Short Print',
    rare: 'Rare',
    super: 'Super Rare',
    ultra: 'Ultra Rare',
    ultimate: 'Ultimate Rare',
    secret: 'Secret Rare',
    prismatic: 'Prismatic Secret Rare',
    collector: "Collector's Rare",
    ghost: 'Ghost Rare',
    starlight: 'Starlight Rare'
};

/** Title-case a stored key such as `monster`. */
const titleCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * The race is the first segment of the composed card-type line, e.g. the
 * "Insect" in "Insect / Effect". It is not stored as a field of its own.
 */
const raceOf = (card) => {
    const [race] = String(card?.cardType ?? '').split('/');
    return race.trim();
};

/**
 * Every facet, in the order the toolbar shows them.
 *
 * `values` returns an array because a facet may legitimately not apply to a
 * card — a Token has no level — and an empty array means "this card is not a
 * candidate for any value of this facet".
 */
export const FACETS = [
    {
        key: 'type',
        label: 'Type',
        values: (card) => (card?.type ? [card.type] : []),
        labelFor: titleCase
    },
    {
        key: 'attribute',
        label: 'Attribute',
        values: (card) => (card?.attribute ? [card.attribute] : []),
        labelFor: (value) => value
    },
    {
        key: 'race',
        label: 'Race',
        values: (card) => (raceOf(card) ? [raceOf(card)] : []),
        labelFor: (value) => value
    },
    {
        key: 'effect',
        label: 'Has Effect',
        // Monsters only. hasEffect is null for a spell or a trap — the concept
        // does not exist there — and undefined on any card mapped before the
        // field was published, so both are read the same way: no value, and so
        // not a candidate for either option. Same statement the level facet
        // makes about a Token, rather than inventing a "no" for a card the
        // question was never asked of.
        values: (card) =>
            (typeof card?.hasEffect === 'boolean' ? [card.hasEffect ? 'effect' : 'normal'] : []),
        labelFor: (value) => (value === 'effect' ? 'Effect' : 'Normal'),
        // Effect first: it is the far commoner of the two, and a fixed order
        // stops the pair swapping places as other filters change the counts.
        compare: (a, b) => (a.value === 'effect' ? -1 : 1)
    },
    {
        key: 'level',
        label: 'Level',
        values: (card) => (typeof card?.level === 'number' ? [String(card.level)] : []),
        labelFor: (value) => `Level ${value}`,
        // Numeric, so "10" sorts after "9" rather than between "1" and "2".
        compare: (a, b) => Number(a.value) - Number(b.value)
    },
    {
        key: 'rarity',
        label: 'Rarity',
        values: (card) => (card?.rarity ? [card.rarity] : []),
        labelFor: (value) => RARITY_LABELS[value] ?? value,
        // Scarcity order, not alphabetical — the same order RARITY_ORDER fixes.
        compare: (a, b) => RARITY_ORDER.indexOf(a.value) - RARITY_ORDER.indexOf(b.value)
    },
    {
        key: 'edition',
        label: 'Edition',
        // Every card has an edition: the absence of a 1st Edition tick means
        // Unlimited, which is a value worth filtering on rather than a blank.
        values: (card) => [card?.isFirstEdition === true ? 'first' : 'unlimited'],
        labelFor: (value) => (value === 'first' ? '1st Edition' : 'Unlimited'),
        compare: (a, b) => (a.value === 'first' ? -1 : 1)
    },
    {
        key: 'set',
        label: 'Set',
        // The set code is the part of the serial before the dash: SDJ-017 is
        // Starter Deck Joey.
        values: (card) => {
            const [set] = String(card?.serial ?? '').split('-');
            return set.trim() ? [set.trim()] : [];
        },
        labelFor: (value) => value
    }
];

/** Facet definitions by key, for lookups from a chip or a checkbox. */
export const FACETS_BY_KEY = Object.fromEntries(FACETS.map((facet) => [facet.key, facet]));

/**
 * Human label for one value of one facet.
 *
 * @param {string} facetKey - a key from FACETS
 * @param {string} value - the stored value
 * @returns {string} the display label, or the raw value for an unknown facet
 */
export function facetValueLabel(facetKey, value) {
    const facet = FACETS_BY_KEY[facetKey];
    if (!facet) return String(value);
    return facet.labelFor(String(value));
}

/**
 * Test one card against one facet's selected values.
 *
 * An empty selection applies no constraint; multiple values OR together, so
 * picking Earth and Dark widens rather than narrows.
 *
 * @param {object} card - a card record
 * @param {string} facetKey - a key from FACETS
 * @param {string[]} selected - selected values for that facet
 * @returns {boolean} true when the card is still a candidate
 */
export function matchesFacet(card, facetKey, selected) {
    if (!selected || selected.length === 0) return true;

    const facet = FACETS_BY_KEY[facetKey];
    // An unknown facet key constrains nothing rather than excluding every
    // card: a stale selection should not empty the page.
    if (!facet) return true;

    const values = facet.values(card);
    return values.some((value) => selected.includes(value));
}

/**
 * Test one card against a whole selection.
 *
 * Facets AND together, values within a facet OR — the same rule the type and
 * rarity pills already followed, generalised.
 *
 * @param {object} card - a card record
 * @param {Record<string, string[]>} [selection] - selected values keyed by facet
 * @param {string} [skipKey] - a facet to ignore, used when counting its own options
 * @returns {boolean} true when the card matches
 */
export function matchesSelection(card, selection = {}, skipKey = null) {
    return Object.entries(selection).every(([facetKey, selected]) =>
        facetKey === skipKey ? true : matchesFacet(card, facetKey, selected)
    );
}

/**
 * Build the options for one facet, with a count against every other filter.
 *
 * The facet's own selection is deliberately excluded from its own counts.
 * Otherwise, ticking Earth would drop every other attribute to zero and the
 * menu would tell the user their remaining choices are all dead ends, when in
 * fact ticking Fire as well would widen the results.
 *
 * Values that cannot be reached at all are returned with a count of 0 rather
 * than dropped, so a menu does not reshuffle under the cursor as boxes are
 * ticked. The caller decides how to present them.
 *
 * @param {object[]} cards - the full collection
 * @param {string} facetKey - a key from FACETS
 * @param {object} [options]
 * @param {Record<string, string[]>} [options.selection] - current selection
 * @param {(card: object) => boolean} [options.matchesQuery] - search predicate
 * @returns {{value: string, label: string, count: number}[]} options in display order
 */
export function facetOptions(cards, facetKey, { selection = {}, matchesQuery = () => true } = {}) {
    const facet = FACETS_BY_KEY[facetKey];
    if (!facet || !Array.isArray(cards)) return [];

    const totals = new Map();

    // Every value present anywhere in the collection, so the menu is stable.
    for (const card of cards) {
        for (const value of facet.values(card)) {
            if (!totals.has(value)) totals.set(value, 0);
        }
    }

    for (const card of cards) {
        if (!matchesQuery(card)) continue;
        if (!matchesSelection(card, selection, facetKey)) continue;

        for (const value of facet.values(card)) {
            totals.set(value, totals.get(value) + 1);
        }
    }

    const options = [...totals.entries()].map(([value, count]) => ({
        value,
        label: facet.labelFor(value),
        count
    }));

    // A facet declaring its own order gets it; everything else goes commonest
    // first, then alphabetically, so the useful values are at the top.
    options.sort(
        facet.compare ??
            ((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    );

    return options;
}

/**
 * Flatten a selection into the chips shown under the toolbar.
 *
 * @param {Record<string, string[]>} [selection] - selected values keyed by facet
 * @returns {{facetKey: string, facetLabel: string, value: string, label: string}[]}
 */
export function selectionChips(selection = {}) {
    const chips = [];

    // FACETS order rather than object order, so chips stay in toolbar order
    // however the selection object was built up.
    for (const facet of FACETS) {
        for (const value of selection[facet.key] ?? []) {
            chips.push({
                facetKey: facet.key,
                facetLabel: facet.label,
                value,
                label: facet.labelFor(value)
            });
        }
    }

    return chips;
}

/**
 * Drop selected values that no card in the collection can satisfy.
 *
 * The refresh button replaces the collection under a live selection. A value
 * that has since left the data — the last Earth card removed, a set no longer
 * held — would otherwise sit in the chip tray filtering everything out, and
 * the page would look broken rather than empty for a reason.
 *
 * Only impossible values are dropped. A value that merely returns nothing in
 * combination with another filter is kept, because removing the other filter
 * brings it back.
 *
 * @param {Record<string, string[]>} [selection] - selected values keyed by facet
 * @param {object[]} [cards] - the collection to check against
 * @returns {Record<string, string[]>} a new selection holding only reachable values
 */
export function pruneSelection(selection = {}, cards = []) {
    const pruned = {};

    for (const [facetKey, selected] of Object.entries(selection)) {
        const facet = FACETS_BY_KEY[facetKey];
        // An unknown facet key cannot be checked, so it is dropped: it can only
        // be a leftover from a facet that no longer exists.
        if (!facet || !Array.isArray(selected)) continue;

        const available = new Set(cards.flatMap(card => facet.values(card)));
        const kept = selected.filter(value => available.has(value));

        if (kept.length > 0) pruned[facetKey] = kept;
    }

    return pruned;
}

/**
 * Decide whether a facet panel that was open before a rebuild should reopen.
 *
 * A refresh rebuilds the whole facet toolbar in place (see buildFacetBar in
 * script.js), including any panel the user had open at the time. Reopening it
 * is only possible when that facet is still on the rebuilt toolbar — a facet
 * no card carries a value for any more is skipped entirely, so there is
 * nothing to reopen.
 *
 * Pure and DOM-free on purpose: the decision of *whether* to reopen is one
 * branch, easy to get backwards under a null check, so it is tested on its
 * own; the actual `.focus()` call belongs to the caller, same division as
 * focus.js.
 *
 * @param {string|null} facetKey - the facet whose panel was open before the rebuild
 * @param {string[]} availableFacetKeys - keys the rebuilt toolbar actually renders
 * @returns {boolean} whether that panel should reopen
 */
export function shouldReopenFacet(facetKey, availableFacetKeys) {
    return facetKey !== null && Array.isArray(availableFacetKeys) && availableFacetKeys.includes(facetKey);
}

/**
 * Count how many values are selected across every facet.
 *
 * @param {Record<string, string[]>} [selection] - selected values keyed by facet
 * @returns {number} total selected values
 */
export function countSelected(selection = {}) {
    return Object.values(selection).reduce((total, values) => total + (values?.length ?? 0), 0);
}
