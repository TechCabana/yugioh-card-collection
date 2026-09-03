import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guards the rule that a pointer cursor means a real control.
 *
 * A `cursor: pointer` on an element with no handler is an affordance that
 * lies: it promises an action to a mouse user that never happens, and it
 * promises nothing at all to a keyboard user, because a cursor is not an
 * interaction. The grid card carried exactly that for several PRs.
 *
 * Read as text, like motion.test.js and tokens.test.js — this is a property of
 * what the stylesheet says, and a browser renders the lie perfectly happily.
 * There is no DOM test environment here, so the pairing of a selector to a
 * handler is asserted by keeping the allowlist below in step with the markup
 * and the script, not by clicking anything.
 */

const read = (relativePath) =>
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const stylesCss = read('../styles.css');
const scriptJs = read('../script.js');
const indexHtml = read('../index.html');

/**
 * Selectors allowed to carry `cursor: pointer`.
 *
 * Each one is a real control — a <button>, or the <label> of a checkbox, which
 * a browser makes clickable and focusable through the input it wraps. The
 * comment records where the behaviour lives, so a selector cannot be added
 * here without naming the handler that justifies it.
 */
const interactive_selectors = new Map([
    ['.empty-state-action', 'button built in script.js buildEmptyStateItem'],
    ['.facet-btn', 'button built in script.js renderFacetControls'],
    ['.facet-option', 'label wrapping the facet checkbox, script.js renderFacetOptions'],
    ['.chip', 'button built in script.js renderChips'],
    ['.clear-btn', 'button in index.html, clearFilters'],
    ['.refresh-btn', 'button in index.html, handler in script.js'],
    ['.view-btn', 'button in index.html, handler in script.js'],
    ['.density-btn', 'button in index.html, handler in script.js'],
    ['.carousel-card-action', 'button built in script.js buildCarouselCardAction'],
    ['.grid-card-action', 'button built in script.js buildGridCardAction, opens the detail dialog'],
    ['.dialog-close', 'button in index.html, cardDialogClose'],
    ['.nav-btn', 'button in index.html, prevBtn and nextBtn'],
    ['.page-btn', 'button in index.html, prevPage and nextPage']
]);

/**
 * Every selector whose rule block declares `cursor: pointer`.
 *
 * Splits on the closing brace and keeps the blocks that declare it, so a
 * declaration is attributed to the selector that actually owns it rather than
 * to whichever selector happens to sit above it in the file.
 *
 * @returns {string[]} one entry per selector, comma-separated groups split out
 */
const pointer_selectors = () => {
    const blocks = stylesCss.split('}');
    const selectors = [];

    for (const block of blocks) {
        const brace = block.indexOf('{');
        if (brace === -1) continue;

        const body = block.slice(brace + 1);
        if (!/cursor:\s*pointer\s*;/.test(body)) continue;

        // Strip comments before reading the selector: a block preceded by a
        // /* ... */ comment carries it in the same chunk.
        const head = block.slice(0, brace).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const selector of head.split(',')) {
            const trimmed = selector.trim();
            if (trimmed !== '') selectors.push(trimmed);
        }
    }

    return selectors;
};

describe('pointer cursors', () => {
    it('declares some, so the assertions below are not vacuous', () => {
        expect(pointer_selectors().length).toBeGreaterThan(0);
    });

    it('puts one only on a selector backed by a real control', () => {
        const offenders = pointer_selectors().filter(
            (selector) => !interactive_selectors.has(selector)
        );
        expect(offenders).toEqual([]);
    });

    it('keeps the allowlist honest by requiring each entry to be used', () => {
        const used = new Set(pointer_selectors());
        const unused = [...interactive_selectors.keys()].filter(
            (selector) => !used.has(selector)
        );
        expect(unused).toEqual([]);
    });
});

/*
 * The grid card now has an action: clicking it opens the card's detail dialog.
 *
 * The rule these tests hold has not changed, only which side of it the grid
 * card sits on. It used to have a pointer cursor and nothing behind it, and
 * the fix was to remove the cursor. The fix is not to add the cursor back on
 * the card — a cursor is not an interaction, and a mouse-only affordance is
 * still a lie to everyone else. It is to give the card a real <button>, which
 * a keyboard reaches, Enter and Space activate, and the focus ring traces.
 *
 * So the pairing is what is asserted: the cursor and the tab stop both live on
 * .grid-card-action, and the <li> stays a plain list item.
 */
describe('the grid card', () => {
    /** The `.grid-card { ... }` block on its own, comments excluded. */
    const grid_card_block = () => {
        const match = stylesCss.match(/(^|\n)\.grid-card\s*\{([^}]*)\}/);
        expect(match).not.toBeNull();
        return match[2];
    };

    /** The `.grid-card-action { ... }` block on its own. */
    const grid_card_action_block = () => {
        const match = stylesCss.match(/(^|\n)\.grid-card-action\s*\{([^}]*)\}/);
        expect(match).not.toBeNull();
        return match[2];
    };

    it('carries no pointer cursor itself, because the card is not the control', () => {
        expect(grid_card_block()).not.toMatch(/cursor:/);
    });

    it('creates a plain li with no tab stop of its own', () => {
        const creation = scriptJs.match(/cardEl\.className = 'grid-card';[\s\S]{0,300}/);
        expect(creation).not.toBeNull();

        // Comments stripped first, the same way structure.test.js reads
        // index.html: the comment here explains that the li deliberately gets
        // no tabindex and no role, and naming them is not setting them.
        const statements = creation[0].replace(/\/\/[^\n]*/g, '');
        expect(statements).not.toMatch(/tabIndex|tabindex|role\s*=/);
    });

    it('puts the action on a real button, not on the li', () => {
        expect(scriptJs).toMatch(/function buildGridCardAction\(card\)/);
        expect(scriptJs).toMatch(/action\.type = 'button';\s*\n\s*action\.className = 'grid-card-action';/);
        expect(scriptJs).toMatch(/action\.addEventListener\('click', \(\) => openCardDialog\(card, action\)\)/);
    });

    // The button is empty and transparent, so it has no text of its own to be
    // named by — the same reason .carousel-card-action carries one.
    it('gives that button an accessible name naming the card', () => {
        expect(scriptJs).toMatch(/action\.setAttribute\('aria-label', `Show details for \$\{card\?\.name \?\? 'card'\}`\)/);
    });

    it('gives the pointer cursor and the focus ring to that button together', () => {
        expect(grid_card_action_block()).toMatch(/cursor:\s*pointer/);
        expect(stylesCss).toMatch(/\.grid-card-action:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
    });

    it('still answers hover, so the grid does not go flat', () => {
        expect(stylesCss).toMatch(/\.grid-card:hover\s*\{[^}]*transform:\s*translateY\(/);
    });
});

/*
 * Grid density.
 *
 * The sizes are two custom properties rather than two full
 * grid-template-columns declarations, which is what lets the breakpoints
 * resize the grid without disabling the compact class at those widths. An
 * inline style would defeat both.
 */
describe('grid density', () => {
    it('drives the grid from two custom properties', () => {
        expect(stylesCss).toMatch(/\.card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(var\(--grid-min\),\s*1fr\)\)/);
        expect(stylesCss).toMatch(/\.card-grid\s*\{[^}]*gap:\s*var\(--grid-gap\)/);
    });

    it('expresses compact by overriding those properties, not the whole template', () => {
        const compact = stylesCss.match(/\.card-grid\.is-compact\s*\{([^}]*)\}/);

        expect(compact).not.toBeNull();
        expect(compact[1]).toMatch(/--grid-min:/);
        expect(compact[1]).toMatch(/--grid-gap:/);
        expect(compact[1]).not.toMatch(/grid-template-columns:/);
    });

    it('keeps every breakpoint on the same two properties', () => {
        // A breakpoint restating grid-template-columns would pin the column
        // width there and silently switch the compact class off below it.
        const media = stylesCss.slice(stylesCss.indexOf('Responsive breakpoints'));
        expect(media).not.toMatch(/grid-template-columns:\s*repeat\(auto-fill/);
        expect(media).not.toMatch(/\.card-grid\s*\{[^}]*grid-template-columns/);
    });

    it('is applied as a class toggle rather than as an inline style', () => {
        expect(scriptJs).toMatch(/classList\.toggle\('is-compact', currentDensity === DENSITY_COMPACT\)/);
        expect(scriptJs).not.toMatch(/cardGrid'\)\.style\./);
    });
});

describe('the focus ring', () => {
    it('is declared globally rather than control by control', () => {
        expect(stylesCss).toMatch(/(^|\n):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
    });

    it('is never removed without a replacement', () => {
        expect(stylesCss).not.toMatch(/outline:\s*(none|0)\s*;/);
    });

    it('offsets the ring so it clears the element it traces', () => {
        expect(stylesCss).toMatch(/(^|\n):focus-visible\s*\{[^}]*outline-offset:/);
    });
});

describe('every control in the markup', () => {
    /** Every <button> in index.html, with its attributes. */
    const buttons = () => [...indexHtml.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);

    it('declares a button type, so none of them submits anything', () => {
        expect(buttons().length).toBeGreaterThan(0);
        for (const button of buttons()) {
            expect(button).toMatch(/type="button"/);
        }
    });

    it('never carries a positive tabindex, which would reorder the tab sequence', () => {
        const offenders = [...indexHtml.matchAll(/tabindex="([^"]+)"/g)]
            .map((m) => m[1])
            .filter((value) => Number(value) > 0);
        expect(offenders).toEqual([]);
    });
});
