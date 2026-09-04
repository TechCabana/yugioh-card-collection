/**
 * Card markup construction.
 *
 * Every value that reaches the DOM passes through escapeHtml first. Card data
 * comes from Airtable, which is user-editable, so all of it is untrusted — a
 * card named `<img src=x onerror=...>` must render as text, not execute.
 *
 * One value cannot be handled by escaping alone, because it ends up inside an
 * attribute the browser acts on rather than displays: the art path in a src.
 * It goes through an allowlist instead — see safeImagePath.
 *
 * There used to be a second such value, a per-card gradient interpolated into
 * a style attribute. Card colour is now a frame key from a fixed set, resolved
 * to a colour by styles.css, so no card data reaches a style attribute at all
 * and that allowlist could be deleted rather than tightened.
 *
 * Functions here return strings and touch no DOM, so the escaping behaviour is
 * directly testable.
 */

import { escapeHtml } from './filters.js';
import { cardFrame, frameLabel, FRAME_KEYS } from './frames.js';

/**
 * Human-readable labels for the rarity values used in the data.
 * Keys mirror RARITY_ORDER in filters.js and the Airtable Rarity options.
 */
export const RARITY_LABELS = {
    common: 'Common',
    short_print: 'Short Print',
    super_short_print: 'Super Short Print',
    rare: 'Rare',
    super: 'Super Rare',
    ultra: 'Ultra Rare',
    ultimate: 'Ultimate Rare',
    secret: 'Secret Rare',
    prismatic: 'Prismatic Secret Rare',
    collector: "Collector's Rare",
    ghost: 'Ghost Rare',
    starlight: 'Starlight Rare',
    quarter_century: 'Quarter Century Secret Rare'
};

/**
 * Mirrored card art lives at assets/cards/<passcode>.jpg and nowhere else, so
 * the src is checked against that exact shape rather than merely escaped. A
 * path is not a text node: escaping stops attribute break-out but would still
 * happily emit `//evil.example/x.jpg` or a data: URI as a real request.
 *
 * The rule mirrors isValidPasscode in scripts/mirror-images.mjs. It is stated
 * twice on purpose — this half runs in the browser and cannot import a script
 * that pulls in node:fs.
 */
const SAFE_IMAGE_PATH = /^assets\/cards\/\d{1,10}\.jpg$/;

/**
 * Intrinsic size of a YGOPRODeck card face.
 *
 * Emitted as width/height attributes so the browser reserves the right box
 * before the image arrives. 421/614 is 0.6857 against the true card ratio of
 * 59/86 = 0.6860, so the reserved box and the CSS aspect-ratio agree and
 * nothing shifts on load.
 */
const IMAGE_WIDTH = 421;
const IMAGE_HEIGHT = 614;

/**
 * Build the data-frame attribute for a card.
 *
 * The value can only ever be one of FRAME_KEYS, checked here rather than
 * trusted: cardFrame derives it from card data, and an attribute value is one
 * of the few places where a mistake upstream would become a markup bug rather
 * than a wrong colour.
 *
 * @param {string|null} frame - a frame key from cardFrame
 * @returns {string} ` data-frame="..."`, or an empty string for an unknown frame
 */
export function frameAttribute(frame) {
    return FRAME_KEYS.includes(frame) ? ` data-frame="${frame}"` : '';
}

/**
 * Return a card art path only if it points inside the mirror directory.
 *
 * @param {unknown} image - candidate image path from the data
 * @returns {string|null} a path safe to use as a src, or null
 */
export function safeImagePath(image) {
    if (typeof image !== 'string') return null;
    const trimmed = image.trim();
    return SAFE_IMAGE_PATH.test(trimmed) ? trimmed : null;
}

/**
 * Build the art element for a card.
 *
 * Returns an empty string when there is no usable image, which leaves the
 * type-coloured ground of .card-image-area showing on its own.
 *
 * A src that passes safeImagePath still is not a guarantee the file exists:
 * mirror-images.mjs assigns the path from the passcode alone at sync time,
 * before the download runs, and a single failed download is deliberately
 * non-fatal (mirror-images.mjs, process-data.yml) so the card's data still
 * ships. That leaves a real gap between "has a plausible path" and "has art
 * on disk" until the next sync retries it. The onerror handler closes that
 * gap client-side: it removes the broken <img> so the ground shows through
 * cleanly, the same placeholder treatment as a missing passcode gets. The
 * handler is a fixed string, not built from card data, so it carries none of
 * the injection risk escapeHtml/safeImagePath exist to prevent.
 *
 * The alt is deliberately empty: the card name is rendered as adjacent text in
 * .card-name, so a descriptive alt would make a screen reader announce the same
 * name twice.
 *
 * @param {object} card - a card record
 * @returns {string} an img tag, or an empty string
 */
export function buildCardImageHTML(card) {
    const src = safeImagePath(card?.image);
    if (!src) return '';

    return `<img class="card-image" src="${src}" alt="" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" loading="lazy" decoding="async" onerror="this.remove()">`;
}

/**
 * Build the 1st Edition marker for a card.
 *
 * Strict === true, matching how the field is published: anything else — false,
 * a missing field on data written before the field existed, a truthy string —
 * renders nothing. A card that is not a 1st Edition print says nothing at all
 * rather than carrying a greyed marker, so the marker means something when it
 * does appear.
 *
 * It sits on the card-type row rather than over the art. Two badges on the art
 * had to be taught not to collide; the type row already has unused space to
 * its right, so the marker lands somewhere it obscures no card image and cannot
 * run into the rarity badge at any width.
 *
 * The label is a fixed string, never card data, so there is nothing to escape.
 *
 * @param {object} card - a card record
 * @returns {string} the marker markup, or an empty string
 */
export function buildEditionBadgeHTML(card) {
    return card?.isFirstEdition === true
        ? '<div class="edition-badge">1st Edition</div>'
        : '';
}

/**
 * Map a rarity value to its display label.
 *
 * Unknown values are echoed back escaped rather than dropped, so a new Airtable
 * rarity shows up instead of silently vanishing.
 *
 * @param {unknown} rarity - rarity key from the data
 * @returns {string} escaped, human-readable label
 */
export function rarityLabel(rarity) {
    return escapeHtml(RARITY_LABELS[rarity] ?? rarity ?? '');
}

/**
 * Build the stat boxes shown beneath a card name.
 *
 * @param {{label: string, value: string}[]} stats - stat entries
 * @returns {string} escaped HTML for the stat grid
 */
export function buildStatsHTML(stats) {
    if (!Array.isArray(stats)) return '';

    return stats.map(stat => {
        const label = escapeHtml(stat?.label);
        const value = escapeHtml(stat?.value);
        // Serials are long, so they get a smaller type size.
        const style = stat?.label === 'Serial' ? ' style="font-size: 0.8rem;"' : '';

        return `
        <div class="stat-box">
            <div class="stat-label">${label}</div>
            <div class="stat-value"${style}>${value}</div>
        </div>
    `;
    }).join('');
}

/**
 * Build the inner markup for a single card.
 *
 * The name is an h3, under the h2 each view carries: a card is a section of
 * the collection, and a document whose only heading is the page title has no
 * outline to navigate by.
 *
 * @param {object} card - a card record
 * @returns {string} escaped HTML, safe to assign to innerHTML
 */
export function buildCardHTML(card) {
    if (!card || typeof card !== 'object') return '';

    // Both areas carry the attribute so each resolves --frame in its own
    // subtree; they are siblings, not nested, so one would not reach the other.
    const frame = cardFrame(card);
    const frameAttr = frameAttribute(frame);
    const chip = frame ? `<span class="type-chip">${escapeHtml(frameLabel(frame))}</span>` : '';
    // Computed once: the title attribute repeats it for a rarity long enough
    // that the flex layout in styles.css truncates the badge with ellipsis.
    const rarity = rarityLabel(card.rarity);

    return `
        <div class="card-image-area"${frameAttr}>
            ${buildCardImageHTML(card)}
            <div class="card-badges">
                <div class="rarity-badge" title="${rarity}">${rarity}</div>
            </div>
        </div>
        <div class="card-info-area"${frameAttr}>
            <h3 class="card-name">${escapeHtml(card.name)}</h3>
            <div class="card-type">
                <span class="card-type-text">${chip}${escapeHtml(card.cardType)}</span>
                ${buildEditionBadgeHTML(card)}
            </div>
            <div class="card-stats-grid">
                ${buildStatsHTML(card.stats)}
            </div>
        </div>
    `;
}

/**
 * Fields the detail view adds, in display order.
 *
 * Only what the card face does not already carry. A monster's three stat boxes
 * are ATK, DEF and Level, so its serial and attribute appear nowhere on it; a
 * Spell's are Type, Attribute and Serial, so for that card two of these three
 * rows are the second time it has been said. Repeating them is the lesser
 * fault: a detail view whose contents change shape by card type is harder to
 * read than one that always answers the same questions.
 *
 * Read straight off the record — no derived values — so nothing here can
 * disagree with the data.
 */
const DETAIL_ROWS = [
    { label: 'Serial', key: 'serial' },
    { label: 'Attribute', key: 'attribute' },
    { label: 'Passcode', key: 'passcode' }
];

/**
 * Build the body of the card detail dialog.
 *
 * The card itself is the same markup the grid and the carousel render, so the
 * detail view cannot drift away from the card it was opened from, and the
 * 59:86 art box comes with it. Beneath it sits a definition list of the fields
 * the face leaves out.
 *
 * Every value is escaped, exactly as in buildCardHTML: this markup reaches
 * innerHTML and the data is Airtable's, which is to say untrusted.
 *
 * @param {object} card - a card record
 * @returns {string} escaped HTML, safe to assign to innerHTML
 */
export function buildCardDetailHTML(card) {
    if (!card || typeof card !== 'object') return '';

    const rows = DETAIL_ROWS
        .map(({ label, key }) => ({ label, value: card[key] }))
        // A field the card has no value for is left out rather than rendered
        // blank, so an empty row never reads as a missing value.
        .filter(({ value }) => value !== null && value !== undefined && String(value).trim() !== '')
        .map(({ label, value }) => `
            <div class="detail-row">
                <dt class="detail-label">${escapeHtml(label)}</dt>
                <dd class="detail-value">${escapeHtml(value)}</dd>
            </div>
        `)
        .join('');

    // A <dl> with no rows is an empty box on screen, so it is not emitted.
    const list = rows === '' ? '' : `<dl class="card-detail-list">${rows}</dl>`;

    return `${buildCardHTML(card)}${list}`;
}
