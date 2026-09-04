import { describe, it, expect } from 'vitest';
import {
    buildCardHTML,
    buildCardDetailHTML,
    buildCardImageHTML,
    buildEditionBadgeHTML,
    buildStatsHTML,
    frameAttribute,
    safeImagePath,
    rarityLabel
} from '../assets/js/render.js';

const baseCard = {
    name: 'Dark Magician',
    type: 'monster',
    rarity: 'ultra',
    cardType: 'Spellcaster / Effect',
    serial: 'LOB-005',
    image: 'assets/cards/46986414.jpg',
    stats: [
        { label: 'ATK', value: '2500' },
        { label: 'DEF', value: '2100' },
        { label: 'Serial', value: 'LOB-005' }
    ]
};

describe('buildEditionBadgeHTML', () => {
    it('returns the badge only for a literal true', () => {
        expect(buildEditionBadgeHTML({ isFirstEdition: true })).toContain('edition-badge');
    });

    it('returns nothing for anything else', () => {
        for (const card of [{ isFirstEdition: false }, {}, null, undefined, { isFirstEdition: 1 }]) {
            expect(buildEditionBadgeHTML(card)).toBe('');
        }
    });
});

describe('frameAttribute', () => {
    it('emits the attribute for a declared frame', () => {
        expect(frameAttribute('spell')).toBe(' data-frame="spell"');
    });

    // The value is derived, not user data, but it lands in an attribute, so
    // anything outside the declared set is dropped rather than written out.
    it('emits nothing for a frame it does not recognise', () => {
        expect(frameAttribute(null)).toBe('');
        expect(frameAttribute('skill')).toBe('');
        expect(frameAttribute('spell" onload="alert(1)')).toBe('');
    });
});

describe('safeImagePath', () => {
    it('passes through a mirrored art path', () => {
        expect(safeImagePath('assets/cards/46986414.jpg')).toBe('assets/cards/46986414.jpg');
    });

    it('rejects a path outside the mirror directory', () => {
        expect(safeImagePath('assets/cards/../../.env')).toBeNull();
        expect(safeImagePath('../../.env')).toBeNull();
    });

    // Escaping alone would let each of these through as a real request.
    it('rejects remote, protocol-relative and inline sources', () => {
        expect(safeImagePath('https://evil.example/x.jpg')).toBeNull();
        expect(safeImagePath('//evil.example/x.jpg')).toBeNull();
        expect(safeImagePath('data:image/svg+xml,<svg onload="alert(1)"/>')).toBeNull();
        expect(safeImagePath('javascript:alert(1)')).toBeNull();
    });

    it('rejects a non-jpg extension and a non-numeric name', () => {
        expect(safeImagePath('assets/cards/46986414.svg')).toBeNull();
        expect(safeImagePath('assets/cards/evil.jpg')).toBeNull();
    });

    it('returns null for missing or non-string values', () => {
        [undefined, null, 46986414, {}].forEach(value => {
            expect(safeImagePath(value)).toBeNull();
        });
    });
});

describe('buildCardImageHTML', () => {
    it('emits the attributes that keep CLS at zero', () => {
        const html = buildCardImageHTML(baseCard);

        expect(html).toContain('src="assets/cards/46986414.jpg"');
        expect(html).toContain('width="421"');
        expect(html).toContain('height="614"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('decoding="async"');
    });

    // The card name is rendered as adjacent text, so a descriptive alt would
    // make a screen reader announce the same name twice.
    it('marks the image decorative with an empty alt', () => {
        expect(buildCardImageHTML(baseCard)).toContain('alt=""');
    });

    // mirror-images.mjs assigns the path from the passcode before the download
    // runs, and a failed download is deliberately non-fatal, so a src that
    // passes safeImagePath is not a guarantee the file exists on disk. This is
    // the client-side half of the placeholder fallback: it must fire on a 404
    // exactly like the missing-passcode case does.
    it('drops itself on a load failure instead of leaving a broken-image icon', () => {
        expect(buildCardImageHTML(baseCard)).toContain('onerror="this.remove()"');
    });

    it('emits nothing when the card has no art, leaving the placeholder ground', () => {
        expect(buildCardImageHTML({ ...baseCard, image: null })).toBe('');
        expect(buildCardImageHTML({ ...baseCard, image: undefined })).toBe('');
        expect(buildCardImageHTML(null)).toBe('');
    });

    it('emits nothing rather than a hostile src', () => {
        const html = buildCardImageHTML({ ...baseCard, image: 'x.jpg" onerror="alert(1)' });

        expect(html).toBe('');
    });
});

describe('rarityLabel', () => {
    it('maps a known rarity to its label', () => {
        expect(rarityLabel('ultra')).toBe('Ultra Rare');
        expect(rarityLabel('common')).toBe('Common');
    });

    it('echoes an unknown rarity rather than dropping it', () => {
        expect(rarityLabel('promo')).toBe('promo');
    });

    it('escapes an unknown rarity carrying markup', () => {
        expect(rarityLabel('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
    });

    it('returns an empty string for a missing rarity', () => {
        expect(rarityLabel(undefined)).toBe('');
    });
});

describe('buildStatsHTML', () => {
    it('escapes stat labels and values', () => {
        const html = buildStatsHTML([{ label: '<b>ATK</b>', value: '<i>2500</i>' }]);
        expect(html).not.toContain('<b>');
        expect(html).not.toContain('<i>');
        expect(html).toContain('&lt;b&gt;ATK&lt;/b&gt;');
    });

    it('returns an empty string when stats are missing or malformed', () => {
        expect(buildStatsHTML(undefined)).toBe('');
        expect(buildStatsHTML('ATK')).toBe('');
    });

    it('tolerates null entries without throwing', () => {
        expect(() => buildStatsHTML([null])).not.toThrow();
    });
});

describe('buildCardHTML', () => {
    it('renders a normal card with its real values', () => {
        const html = buildCardHTML(baseCard);
        expect(html).toContain('Dark Magician');
        expect(html).toContain('Ultra Rare');
        expect(html).toContain('2500');
    });

    // The card's Done-when: a card named <script>alert(1)</script> renders as literal text.
    it('renders a script-tag card name as literal text', () => {
        const html = buildCardHTML({ ...baseCard, name: '<script>alert(1)</script>' });

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('neutralises an img onerror payload in the card name', () => {
        const html = buildCardHTML({ ...baseCard, name: '<img src=x onerror="alert(1)">' });

        // The card art is itself an img now, and it legitimately carries its own
        // fixed onerror handler (see buildCardImageHTML), so the assertion is
        // that the only img in the output is that one, wired to that exact
        // fixed handler, and the name became literal text rather than a second
        // live attribute built from attacker-controlled input.
        expect(html.match(/<img/g)).toHaveLength(1);
        expect(html).toContain('<img class="card-image"');
        expect(html.match(/onerror="/g)).toHaveLength(1);
        expect(html).toContain('onerror="this.remove()"');
        expect(html).not.toContain('onerror="alert(1)"');
        expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    });

    it('injects no img at all for a hostile name on a card with no art', () => {
        const html = buildCardHTML({
            ...baseCard,
            image: null,
            name: '<img src=x onerror="alert(1)">'
        });

        expect(html).not.toContain('<img');
    });

    it('escapes markup in every interpolated field', () => {
        const hostile = '<svg onload="alert(1)">';
        const html = buildCardHTML({
            ...baseCard,
            name: hostile,
            cardType: hostile,
            rarity: hostile
        });

        expect(html).not.toContain('<svg');
        expect(html).not.toContain('onload="');
    });

    // The gradient used to be interpolated into a style attribute and had to be
    // allowlisted. Card colour is now a key resolved by CSS, so no card data
    // reaches a style attribute at all and the whole class of break-out is gone.
    it('puts no card data in a style attribute', () => {
        const html = buildCardHTML({
            ...baseCard,
            gradient: 'red" onmouseover="alert(1)',
            type: 'monster" onmouseover="alert(1)'
        });

        expect(html).not.toContain('onmouseover');
        expect(html).not.toContain('style="background');
    });

    it('carries the derived frame on both card areas', () => {
        const html = buildCardHTML({ ...baseCard, type: 'spell', cardType: 'Quick-Play / Spell' });

        expect(html).toContain('class="card-image-area" data-frame="spell"');
        expect(html).toContain('class="card-info-area" data-frame="spell"');
        expect(html).toContain('<span class="type-chip">Spell</span>');
    });

    it('reads a fusion monster as the fusion frame rather than the effect one', () => {
        const html = buildCardHTML({
            ...baseCard,
            summonType: 'Fusion',
            cardType: 'Warrior / Fusion / Effect'
        });

        expect(html).toContain('data-frame="fusion"');
        expect(html).not.toContain('data-frame="effect"');
    });

    it('renders an unknown card type with no frame and no chip', () => {
        const html = buildCardHTML({ ...baseCard, type: 'skill' });

        expect(html).not.toContain('data-frame');
        expect(html).not.toContain('type-chip');
        expect(html).toContain('Dark Magician');
    });

    describe('the 1st Edition badge', () => {
        it('marks a 1st Edition card', () => {
            const html = buildCardHTML({ ...baseCard, isFirstEdition: true });

            expect(html).toContain('<div class="edition-badge">1st Edition</div>');
        });

        it('says nothing at all on an Unlimited card', () => {
            const html = buildCardHTML({ ...baseCard, isFirstEdition: false });

            expect(html).not.toContain('edition-badge');
            expect(html).not.toContain('1st Edition');
        });

        // Data written before the field existed has no isFirstEdition key. It
        // must render as "not a 1st Edition", never as a badge.
        it('says nothing when the field is missing entirely', () => {
            expect(buildCardHTML(baseCard)).not.toContain('edition-badge');
        });

        it('treats a truthy non-boolean as not a 1st Edition', () => {
            for (const value of ['true', 1, 'yes', {}]) {
                expect(buildCardHTML({ ...baseCard, isFirstEdition: value }))
                    .not.toContain('edition-badge');
            }
        });

        // It moved off the art and onto the card-type row: the rarity badge
        // keeps the art to itself, and the marker sits opposite the type text
        // where it covers no card image.
        it('sits on the card type row, after the type text, not over the art', () => {
            const html = buildCardHTML({ ...baseCard, isFirstEdition: true });

            expect(html).toContain('rarity-badge');
            expect(html.indexOf('edition-badge')).toBeGreaterThan(html.indexOf('card-info-area'));
            expect(html.indexOf('edition-badge')).toBeGreaterThan(html.indexOf('card-type-text'));
        });

        it('leaves only the rarity badge over the art', () => {
            const html = buildCardHTML({ ...baseCard, isFirstEdition: true });
            const badges = html.match(/<div class="card-badges">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';

            expect(badges).toContain('rarity-badge');
            expect(badges).not.toContain('edition-badge');
        });

        // The type text and the marker are siblings in one flex row, so the
        // text needs its own element to be the half that truncates.
        it('wraps the type text so it can truncate independently', () => {
            const html = buildCardHTML({ ...baseCard, cardType: 'Insect / Effect' });

            expect(html).toMatch(/<span class="card-type-text">.*Insect \/ Effect<\/span>/);
        });

        // Both badges are flex children of one wrapper so a long rarity label
        // and the edition mark share space instead of overlapping — see
        // tests/layout.test.js for the CSS side of this. This just locks in
        // that render.js still emits the wrapper the CSS relies on.
        it('wraps both badges in a single .card-badges container', () => {
            const html = buildCardHTML({ ...baseCard, isFirstEdition: true });
            const wrapperOpen = html.indexOf('class="card-badges"');

            expect(wrapperOpen).toBeGreaterThan(-1);
            expect(wrapperOpen).toBeGreaterThan(html.indexOf('card-image-area'));
            expect(wrapperOpen).toBeLessThan(html.indexOf('edition-badge'));
            expect(wrapperOpen).toBeLessThan(html.indexOf('rarity-badge'));
        });
    });

    it('keeps the surrounding markup structure intact', () => {
        const html = buildCardHTML(baseCard);
        expect(html).toContain('class="card-image-area"');
        expect(html).toContain('class="rarity-badge"');
        expect(html).toContain('class="card-stats-grid"');
    });

    // A long rarity label truncates with ellipsis under tests/layout.test.js's
    // flex-shrink rules; the title attribute keeps the full label reachable
    // on hover and via assistive tech reading the accessible name.
    it('carries the full rarity label in a title attribute, for when the badge truncates', () => {
        const html = buildCardHTML({ ...baseCard, rarity: 'prismatic' });
        expect(html).toContain('title="Prismatic Secret Rare"');
    });

    it('places the art inside the art area', () => {
        const html = buildCardHTML(baseCard);

        expect(html).toContain('class="card-image"');
        expect(html.indexOf('class="card-image"')).toBeGreaterThan(html.indexOf('card-image-area'));
        expect(html.indexOf('class="card-image"')).toBeLessThan(html.indexOf('card-info-area'));
    });

    it('renders a card with no art without an img tag', () => {
        const html = buildCardHTML({ ...baseCard, image: null });

        expect(html).not.toContain('<img');
        expect(html).toContain('class="card-image-area"');
        expect(html).toContain('Dark Magician');
    });

    // Emoji as UI chrome is a design smell the mirrored art replaces.
    it('renders no placeholder glyph', () => {
        expect(buildCardHTML({ ...baseCard, emoji: '🐉' })).not.toContain('🐉');
    });

    it('returns an empty string for a missing card', () => {
        expect(buildCardHTML(null)).toBe('');
        expect(buildCardHTML('card')).toBe('');
    });
});

describe('buildCardDetailHTML', () => {
    const detailCard = { ...baseCard, attribute: 'Dark', passcode: '46986414' };

    // The detail view is the same card the user clicked, not a second
    // rendering of it — so the art keeps its 59:86 box and the escaping,
    // the frame colour and the badges all come along unchanged.
    it('opens with the card markup the grid already renders', () => {
        expect(buildCardDetailHTML(detailCard)).toContain(buildCardHTML(detailCard));
    });

    it('adds the fields the card face does not carry', () => {
        const html = buildCardDetailHTML(detailCard);

        expect(html).toContain('<dl class="card-detail-list">');
        for (const label of ['Serial', 'Attribute', 'Passcode']) {
            expect(html).toContain(`<dt class="detail-label">${label}</dt>`);
        }
        expect(html).toContain('>LOB-005</dd>');
        expect(html).toContain('>Dark</dd>');
        expect(html).toContain('>46986414</dd>');
    });

    // A blank row reads as a missing value rather than as a field that does
    // not apply — a Token has no attribute, and says so by not saying it.
    it('leaves out a field the card has no value for', () => {
        const html = buildCardDetailHTML({ ...detailCard, attribute: null, passcode: '' });

        expect(html).toContain('Serial');
        expect(html).not.toContain('Attribute');
        expect(html).not.toContain('Passcode');
    });

    it('emits no empty list when the card carries none of them', () => {
        const html = buildCardDetailHTML({ name: 'Nameless', type: 'monster', rarity: 'common' });

        expect(html).not.toContain('card-detail-list');
        expect(html).toContain('Nameless');
    });

    // This markup reaches innerHTML like every other card rendering, and the
    // data behind it is Airtable's.
    it('escapes a hostile field value', () => {
        const html = buildCardDetailHTML({
            ...detailCard,
            serial: '<img src=x onerror="alert(1)">'
        });

        expect(html).toContain('&lt;img src=x');
        expect(html).not.toContain('<img src=x');
    });

    it('returns an empty string for a missing card', () => {
        expect(buildCardDetailHTML(null)).toBe('');
        expect(buildCardDetailHTML(undefined)).toBe('');
        expect(buildCardDetailHTML('card')).toBe('');
    });
});
