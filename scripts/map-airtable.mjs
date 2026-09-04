/**
 * Airtable record mapping.
 *
 * Translates the Airtable column names and display values into the shape the
 * renderer expects. Kept pure and separate from the fetching code so the
 * mapping rules are unit testable without touching the network.
 *
 * Field names here must match the Airtable base exactly, including spaces.
 */

import { imagePath } from './mirror-images.mjs';

/**
 * Airtable columns that must never reach data/cards.json.
 *
 * The repo is public, so anything published is world-readable. These are
 * inventory and valuation details rather than card properties.
 */
export const PRIVATE_FIELDS = ['Condition', 'Quantity', 'Set Price'];

/** Airtable Type display value to the lowercase key the filters use. */
const TYPE_MAP = {
    Monster: 'monster',
    Spell: 'spell',
    Trap: 'trap',
    Token: 'token'
};

/** Airtable Rarity display value to the lowercase key the filters use. */
const RARITY_MAP = {
    'Common': 'common',
    'Short Print': 'short_print',
    'Rare': 'rare',
    'Super Rare': 'super',
    'Ultra Rare': 'ultra',
    'Secret Rare': 'secret',
    'Ultimate Rare': 'ultimate',
    "Collector's Rare": 'collector',
    'Ghost Rare': 'ghost',
    'Prismatic Secret Rare': 'prismatic',
    'Starlight Rare': 'starlight'
};

/**
 * Build the descriptive type line shown under a card name.
 *
 * Composes the Airtable race, summon type and effect flag into a single
 * string, e.g. "Spellcaster / Fusion / Effect".
 *
 * @param {object} fields - raw Airtable fields
 * @returns {string} display string, empty when nothing is known
 */
export function buildCardTypeLabel(fields) {
    const parts = [];

    if (fields['Card Type']) parts.push(fields['Card Type']);

    const summon = fields['Summon Type'];
    if (summon && summon !== 'None') parts.push(summon);

    if (fields['Type'] === 'Monster') {
        parts.push(fields['HasEffect'] ? 'Effect' : 'Normal');
    } else if (fields['Type']) {
        parts.push(fields['Type']);
    }

    return parts.join(' / ');
}

/**
 * Build the three stat boxes shown on a card.
 *
 * Monsters show combat stats; spells and traps have none, so they show
 * classification details instead.
 *
 * @param {object} fields - raw Airtable fields
 * @returns {{label: string, value: string}[]} exactly three stat entries
 */
export function buildStats(fields) {
    if (fields['Type'] === 'Monster') {
        return [
            { label: 'ATK', value: String(fields['Attack'] ?? '—') },
            { label: 'DEF', value: String(fields['Defense'] ?? '—') },
            // No star: emoji as UI chrome is one of the tells the design rules
            // rule out, and the label already says what the number is.
            { label: 'Level', value: fields['Level'] ? String(fields['Level']) : '—' }
        ];
    }

    return [
        { label: 'Type', value: fields['Type'] ?? '—' },
        { label: 'Attribute', value: fields['Card Sign'] || '—' },
        { label: 'Serial', value: fields['Serial'] ?? '—' }
    ];
}

/**
 * Which renderer-required fields a record cannot supply.
 *
 * Kept separate from mapRecord so a dropped row can be reported by name and by
 * cause. A count alone ("Skipped 1 record(s)") tells the owner a card is
 * missing from the site but not which one, which is exactly the gap that makes
 * a failed pipeline run read as "the pipeline missed a row".
 *
 * @param {{id: string, fields: object}} record - an Airtable record
 * @returns {string[]} the missing field names, empty when the record maps
 */
/**
 * Whether a record is a fully blank row: no Serial and no Name typed.
 *
 * Airtable's UI creates one of these whenever "+" is clicked without filling
 * anything in. It is not a real card missing required fields — it is not a
 * row at all — so it must not be reported as a dropped record.
 *
 * @param {object} [fields] - raw Airtable fields
 * @returns {boolean} true when both Serial and Name are empty/whitespace-only
 */
function isBlankRow(fields) {
    if (!fields) return false;
    const name = typeof fields['Name'] === 'string' ? fields['Name'].trim() : '';
    const serial = typeof fields['Serial'] === 'string' ? fields['Serial'].trim() : '';
    return name === '' && serial === '';
}

export function missingRequiredFields(record) {
    const fields = record?.fields;
    if (!fields) return ['Name', 'Type', 'Rarity'];

    const missing = [];
    if (!(typeof fields['Name'] === 'string' && fields['Name'].trim())) missing.push('Name');
    if (!TYPE_MAP[fields['Type']]) missing.push('Type');
    if (!RARITY_MAP[fields['Rarity']]) missing.push('Rarity');

    return missing;
}

/**
 * Map one Airtable record to a renderable card.
 *
 * Returns null for a record missing the fields the renderer depends on, so the
 * caller can count and report skipped rows rather than emitting broken cards.
 *
 * @param {{id: string, fields: object}} record - an Airtable record
 * @returns {object|null} a card object, or null when unusable
 */
export function mapRecord(record) {
    const fields = record?.fields;
    if (!fields) return null;

    const name = typeof fields['Name'] === 'string' ? fields['Name'].trim() : '';
    const type = TYPE_MAP[fields['Type']];
    const rarity = RARITY_MAP[fields['Rarity']];

    // name, type and rarity are what the filters and renderer require. Asked
    // through missingRequiredFields so the drop rule has exactly one
    // definition and the reported cause can never disagree with the filter.
    if (missingRequiredFields(record).length > 0) return null;

    const passcode = fields['Passcode'] ? String(fields['Passcode']).trim() : '';

    return {
        id: record.id,
        name,
        type,
        rarity,
        passcode,
        serial: fields['Serial'] ? String(fields['Serial']).trim() : '',
        cardType: buildCardTypeLabel(fields),
        summonType: fields['Summon Type'] && fields['Summon Type'] !== 'None'
            ? fields['Summon Type']
            : null,
        attribute: fields['Card Sign'] || null,
        atk: typeof fields['Attack'] === 'number' ? fields['Attack'] : null,
        def: typeof fields['Defense'] === 'number' ? fields['Defense'] : null,
        level: typeof fields['Level'] === 'number' ? fields['Level'] : null,
        // Owner-typed, never enriched: a 1st Edition and an Unlimited copy
        // share a set code, and no YGOPRODeck endpoint reports edition.
        // Strict === true because an unticked Airtable checkbox arrives as
        // undefined rather than false, and undefined would serialise as a
        // missing key instead of a published "no".
        isFirstEdition: fields['IsFirstEdition'] === true,
        // No colour is published: assets/js/frames.js derives the card frame
        // from type, summonType and cardType at render time, so a card can
        // never carry a colour that disagrees with what it is.
        // Repo-relative path to the mirrored art, or null when the passcode is
        // missing or malformed. The renderer falls back to a type-coloured
        // block for a null, so an unmatched card still lays out correctly.
        image: imagePath(passcode),
        stats: buildStats(fields)
    };
}

/**
 * Map a full set of Airtable records.
 *
 * Records are keyed by printing rather than by card, so two rows sharing a
 * passcode with different serials are both kept. Deduplication would lose a
 * printing from the collection.
 *
 * @param {{id: string, fields: object}[]} records - raw Airtable records
 * @returns {{cards: object[], skipped: number, dropped: {id: string, serial: string, missing: string[]}[]}}
 *   mapped cards, a skip count, and the identity and cause of each dropped row
 */
export function mapRecords(records) {
    if (!Array.isArray(records)) {
        throw new Error('Airtable records must be an array');
    }

    const cards = records.map(mapRecord).filter(Boolean);

    const dropped = records
        .filter(record => missingRequiredFields(record).length > 0 && !isBlankRow(record?.fields))
        .map(record => ({
            id: record?.id ?? '',
            serial: record?.fields?.['Serial'] ? String(record.fields['Serial']).trim() : '',
            missing: missingRequiredFields(record)
        }));

    return { cards, skipped: records.length - cards.length, dropped };
}

/**
 * Confirm no private column leaked into the published output.
 *
 * A guard rather than a formality: the repo is public, so a mapping mistake
 * would publish inventory data permanently.
 *
 * @param {object[]} cards - mapped cards
 * @throws {Error} when a private field name appears on any card
 */
export function assertNoPrivateFields(cards) {
    const lowered = PRIVATE_FIELDS.map(f => f.toLowerCase());

    for (const card of cards) {
        for (const key of Object.keys(card)) {
            if (lowered.includes(key.toLowerCase())) {
                throw new Error(`Private field "${key}" must not be published to data/cards.json`);
            }
        }
    }
}
