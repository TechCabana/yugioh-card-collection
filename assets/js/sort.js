/**
 * Ordering the filtered collection.
 *
 * Sorting is the half of "browse a collection" that filtering does not cover:
 * a filter says which cards, an order says which of them you meet first. The
 * two compose — this runs over whatever filterCards() returned, never over the
 * whole collection — so a sort never widens or narrows a selection.
 *
 * There is deliberately no "date acquired" field to sort on. data/cards.json
 * carries nothing of the kind (see the record shape in assets/js/data.js), and
 * an Airtable record id is not time-ordered, so the option would have to be
 * invented rather than read.
 *
 * Pure and DOM-free, so every comparison rule is directly testable.
 */

import { RARITY_ORDER } from './filters.js';
import { FACETS_BY_KEY } from './facets.js';

/** Ascending: A to Z, weakest first, commonest first. */
export const SORT_ASC = 'asc';

/** Descending: the reverse of the above. */
export const SORT_DESC = 'desc';

/** Every direction a sort can run in. */
export const SORT_DIRECTIONS = [SORT_ASC, SORT_DESC];

/**
 * The order data/cards.json already carries, and the default.
 *
 * Making a real sort the default would silently reorder the collection for
 * everyone who has never asked for one, so "no sort" stays a first-class
 * choice rather than being spelled as an absent value.
 */
export const SORT_COLLECTION = 'collection';

/**
 * A sortable string, or null when the field does not apply to this card.
 *
 * @param {unknown} value - a raw field value
 * @returns {string|null} the trimmed text, or null
 */
const textKey = (value) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * A sortable number, or null when the field does not apply to this card.
 *
 * A Token has no ATK and a Spell has no level, and both arrive as null in the
 * data. Coercing those to 0 would sort them alongside a genuine 0 ATK monster,
 * which is a different statement.
 *
 * @param {unknown} value - a raw field value
 * @returns {number|null} the number, or null
 */
const numberKey = (value) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Every field the collection can be ordered by, in the order the menu shows.
 *
 * `keyOf` returns the value the comparison actually runs on, or null when the
 * card has nothing to offer for that field. `directions` names each direction
 * in the field's own terms — "High to low" says more about ATK than
 * "Descending" does, and "Rarest first" says more about rarity than either.
 */
export const SORT_FIELDS = [
    {
        key: SORT_COLLECTION,
        label: 'Collection order',
        keyOf: null,
        directions: null
    },
    {
        key: 'name',
        label: 'Name',
        keyOf: (card) => textKey(card?.name),
        directions: { [SORT_ASC]: 'A to Z', [SORT_DESC]: 'Z to A' }
    },
    {
        key: 'atk',
        label: 'ATK',
        keyOf: (card) => numberKey(card?.atk),
        directions: { [SORT_ASC]: 'Low to high', [SORT_DESC]: 'High to low' }
    },
    {
        key: 'def',
        label: 'DEF',
        keyOf: (card) => numberKey(card?.def),
        directions: { [SORT_ASC]: 'Low to high', [SORT_DESC]: 'High to low' }
    },
    {
        key: 'level',
        label: 'Level',
        keyOf: (card) => numberKey(card?.level),
        directions: { [SORT_ASC]: 'Low to high', [SORT_DESC]: 'High to low' }
    },
    {
        // Scarcity, not the alphabet: RARITY_ORDER is the same list the rarity
        // facet and the "rare or better" threshold already sort by, so a
        // second ordering of the same values cannot drift away from it.
        key: 'rarity',
        label: 'Rarity',
        keyOf: (card) => {
            const tier = RARITY_ORDER.indexOf(card?.rarity);
            return tier === -1 ? null : tier;
        },
        directions: { [SORT_ASC]: 'Commonest first', [SORT_DESC]: 'Rarest first' }
    },
    {
        // The set code is the part of the serial before the dash. Read through
        // the facet that already defines that, rather than splitting the
        // string a second time here.
        key: 'set',
        label: 'Set',
        keyOf: (card) => {
            const [code] = FACETS_BY_KEY.set.values(card);
            return textKey(code);
        },
        directions: { [SORT_ASC]: 'A to Z', [SORT_DESC]: 'Z to A' }
    }
];

/** Sort field definitions by key, for lookups from a menu value or a URL. */
export const SORT_FIELDS_BY_KEY = Object.fromEntries(
    SORT_FIELDS.map((field) => [field.key, field])
);

/**
 * Whether a value names a field this app knows how to sort by.
 *
 * @param {unknown} field - candidate field key
 * @returns {boolean} true when the field is known
 */
export function isValidSortField(field) {
    return Object.hasOwn(SORT_FIELDS_BY_KEY, String(field));
}

/**
 * Coerce any pair of values into a usable sort.
 *
 * Both halves arrive from outside the app — a URL query string, a select's
 * value — so neither can be trusted to name something real. An unknown field
 * falls back to the collection's own order rather than blanking the grid.
 *
 * Collection order is always reported as ascending: it does not reverse, and a
 * direction it ignores would otherwise show up in a shared URL meaning nothing.
 *
 * @param {unknown} field - candidate field key
 * @param {unknown} direction - candidate direction
 * @returns {{field: string, direction: string}} a usable sort
 */
export function normaliseSort(field, direction) {
    const safeField = isValidSortField(field) ? String(field) : SORT_COLLECTION;
    const safeDirection = SORT_DIRECTIONS.includes(direction) ? direction : SORT_ASC;

    return {
        field: safeField,
        direction: safeField === SORT_COLLECTION ? SORT_ASC : safeDirection
    };
}

/**
 * Encode a sort as a single token, e.g. `atk:desc`.
 *
 * One token rather than two, because the field and the direction are one
 * choice: a direction without a field means nothing, and keeping them together
 * means the menu, the URL and the state can all use the same encoding.
 *
 * @param {unknown} field - candidate field key
 * @param {unknown} direction - candidate direction
 * @returns {string} the encoded sort
 */
export function sortValue(field, direction) {
    const sort = normaliseSort(field, direction);
    return `${sort.field}:${sort.direction}`;
}

/**
 * Decode a token produced by sortValue, or anything else, into a usable sort.
 *
 * @param {unknown} value - candidate token
 * @returns {{field: string, direction: string}} a usable sort
 */
export function parseSortValue(value) {
    const [field, direction] = String(value ?? '').split(':');
    return normaliseSort(field, direction);
}

/**
 * Every choice the sort menu offers, in display order.
 *
 * Both directions of every real field, and one entry for collection order,
 * which has only one. Generated from SORT_FIELDS so adding a field is one
 * entry there rather than two options in the markup.
 *
 * @returns {{field: string, direction: string, label: string, value: string}[]}
 */
export function sortOptions() {
    const options = [];

    for (const field of SORT_FIELDS) {
        if (field.directions === null) {
            options.push({
                field: field.key,
                direction: SORT_ASC,
                label: field.label,
                value: sortValue(field.key, SORT_ASC)
            });
            continue;
        }

        for (const direction of SORT_DIRECTIONS) {
            options.push({
                field: field.key,
                direction,
                label: `${field.label}: ${field.directions[direction]}`,
                value: sortValue(field.key, direction)
            });
        }
    }

    return options;
}

/**
 * Compare two non-null sort keys of the same kind.
 *
 * localeCompare is pinned to 'en' rather than left to the runtime's locale: an
 * ordering that changes with the machine it runs on is a test that passes here
 * and fails in CI, which is the same reason formatUpdatedAt in data.js builds
 * its clock by hand.
 *
 * @param {number|string} a - first key
 * @param {number|string} b - second key
 * @returns {number} negative, zero or positive
 */
function compareKeys(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'en');
}

/**
 * Order a filtered collection by one field.
 *
 * Returns a new array; the input is never mutated, because the caller holds
 * the unsorted collection as its source of truth and re-filters from it.
 *
 * Two rules are worth stating because both are easy to get wrong:
 *
 * 1. A card the field does not apply to sorts **last in both directions**. A
 *    Spell has no ATK, and reversing the order should not promote every Spell
 *    to the top of an ATK sort — "no value" is not "the largest value".
 * 2. Ties keep collection order. Without that, two cards of the same rarity
 *    could swap places between renders of an unchanged selection.
 *
 * @param {object[]} cards - the already-filtered collection
 * @param {unknown} field - a key from SORT_FIELDS
 * @param {unknown} direction - SORT_ASC or SORT_DESC
 * @returns {object[]} a new, ordered array
 */
export function sortCards(cards, field, direction) {
    if (!Array.isArray(cards)) return [];

    const sort = normaliseSort(field, direction);
    const definition = SORT_FIELDS_BY_KEY[sort.field];

    // Collection order asks for no comparison at all. Still a copy, so every
    // caller gets the same "new array, input untouched" contract.
    if (definition.keyOf === null) return [...cards];

    const sign = sort.direction === SORT_DESC ? -1 : 1;

    return cards
        .map((card, index) => ({ card, index, key: definition.keyOf(card) }))
        .sort((a, b) => {
            if (a.key === null && b.key === null) return a.index - b.index;
            if (a.key === null) return 1;
            if (b.key === null) return -1;

            const result = compareKeys(a.key, b.key);
            return result === 0 ? a.index - b.index : sign * result;
        })
        .map((entry) => entry.card);
}
