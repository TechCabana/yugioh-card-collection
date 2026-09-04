import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCardHTML } from '../assets/js/render.js';

/**
 * Guards the document structure.
 *
 * A landmark is not something a browser complains about when it goes missing:
 * the page renders identically either way, and only a screen reader user finds
 * out. So the shape of index.html is asserted here, read as text, the same way
 * tokens.test.js guards where colour is allowed to live.
 */

const read = (relativePath) =>
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const stylesCss = read('../styles.css');
const scriptJs = read('../script.js');

/**
 * index.html with its comments stripped.
 *
 * The comments in that file discuss the very elements these tests count — a
 * note explaining why `<main>` wraps both views would otherwise be counted as
 * a second `<main>`.
 */
const indexHtml = read('../index.html').replace(/<!--[\s\S]*?-->/g, '');

describe('landmarks', () => {
    it.each([
        ['header', /<header[\s>]/],
        ['main', /<main[\s>]/],
        ['search', /<search[\s>]/]
    ])('exposes exactly one %s landmark', (_name, pattern) => {
        const matches = indexHtml.match(new RegExp(pattern, 'g')) ?? [];
        expect(matches).toHaveLength(1);
    });

    // Two navs — carousel and pagination — so each needs its own name or a
    // screen reader announces "navigation" twice with no way to tell them apart.
    it('names every nav', () => {
        const navs = [...indexHtml.matchAll(/<nav([^>]*)>/g)].map((match) => match[1]);

        expect(navs.length).toBeGreaterThanOrEqual(2);
        for (const attributes of navs) {
            expect(attributes).toMatch(/aria-label="[^"]+"/);
        }
    });

    it('names the search landmark, since there is other filtering on the page', () => {
        expect(indexHtml).toMatch(/<search[^>]*aria-label="[^"]+"/);
    });

    it('leaves no top-level div container behind', () => {
        // The three that remain are inside a landmark: the status banner and
        // the two view wrappers. What must not survive is a div standing in
        // for a landmark.
        expect(indexHtml).not.toMatch(/<div class="header"/);
        expect(indexHtml).not.toMatch(/<div class="controls"/);
    });
});

describe('the skip link', () => {
    it('is the first focusable element and points at main', () => {
        const skip = indexHtml.match(/<a class="skip-link" href="#([^"]+)"/);

        expect(skip).not.toBeNull();
        expect(indexHtml).toMatch(new RegExp(`<main id="${skip[1]}"`));
    });

    it('comes before the header in source order', () => {
        expect(indexHtml.indexOf('skip-link')).toBeLessThan(indexHtml.indexOf('<header'));
    });

    // Hidden by transform rather than display:none — a skip link that is not
    // in the tab order is not a skip link.
    it('is revealed on focus rather than removed from the page', () => {
        expect(stylesCss).toMatch(/\.skip-link:focus-visible\s*{/);
        expect(stylesCss).not.toMatch(/\.skip-link\s*{[^}]*display:\s*none/);
    });
});

describe('the card lists', () => {
    it('renders both views as real lists', () => {
        expect(indexHtml).toMatch(/<ul class="carousel-stage"/);
        expect(indexHtml).toMatch(/<ul class="card-grid"/);
    });

    it('strips the list styling that comes with them', () => {
        expect(stylesCss).toMatch(/\.carousel-stage,\s*\n\.card-grid\s*{[^}]*list-style:\s*none/);
    });

    // A <div> child of a <ul> is invalid and drops out of the list as far as
    // assistive technology is concerned — including the empty state, which is
    // the one message that must not be missed.
    it('builds every card as an li', () => {
        expect(scriptJs).toMatch(/createElement\('li'\);[\s\S]{0,200}?carousel-card/);
        expect(scriptJs).toMatch(/createElement\('li'\);[\s\S]{0,200}?'grid-card'/);
        expect(scriptJs).not.toMatch(/createElement\('div'\);[\s\S]{0,200}?'grid-card'/);
    });

    it('wraps the empty state in a list item in both views', () => {
        // buildEmptyStateItem is the only thing either renderer may append —
        // the unwrapped block is a div, which is invalid inside a ul.
        expect(scriptJs).toMatch(/function buildEmptyStateItem\(\)/);
        expect(scriptJs).toMatch(/stage\.appendChild\(buildEmptyStateItem\(\)\)/);
        expect(scriptJs).toMatch(/const empty = buildEmptyStateItem\(\)/);
        expect(scriptJs).not.toMatch(/stage\.appendChild\(buildEmptyState\(\)\)/);
    });
});

describe('the heading outline', () => {
    it('has one h1', () => {
        expect(indexHtml.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
    });

    // Three: one per view, plus the detail dialog, which needs a name of its
    // own and would otherwise put its card's h3 directly under the h1.
    it('gives each view and the dialog an h2, so cards do not jump from h1 to h3', () => {
        const h2s = indexHtml.match(/<h2[^>]*>/g) ?? [];
        expect(h2s).toHaveLength(3);
        for (const heading of h2s) {
            expect(heading).toMatch(/visually-hidden/);
        }
    });

    it('renders a card name as an h3 rather than a styled div', () => {
        const html = buildCardHTML({ name: 'Dark Magician', type: 'monster', rarity: 'ultra' });

        expect(html).toMatch(/<h3 class="card-name">Dark Magician<\/h3>/);
        expect(html).not.toMatch(/<div class="card-name"/);
    });

    it('still escapes a hostile name now that it sits in a heading', () => {
        const html = buildCardHTML({ name: '<img src=x onerror="alert(1)">', type: 'spell' });

        expect(html).toContain('&lt;img src=x');
        expect(html).not.toContain('<img src=x');
    });
});

describe('control labelling', () => {
    /** Every button in index.html, as its attribute string. */
    const buttons = [...indexHtml.matchAll(/<button([^>]*)>([^<]*)</g)].map((match) => ({
        attributes: match[1],
        text: match[2].trim()
    }));

    it('finds the buttons, so the assertions below are not vacuous', () => {
        expect(buttons.length).toBeGreaterThanOrEqual(4);
    });

    // A button whose only content is a glyph is announced by that glyph's
    // Unicode name — "single left-pointing angle quotation mark".
    it('gives every glyph-only button an accessible name', () => {
        const glyphOnly = buttons.filter(({ text }) => text !== '' && !/[a-z]/i.test(text));

        expect(glyphOnly.length).toBeGreaterThanOrEqual(4);
        for (const button of glyphOnly) {
            expect(button.attributes).toMatch(/aria-label="[^"]+"/);
        }
    });

    it('types every button, so none can submit something by accident', () => {
        for (const button of buttons) {
            expect(button.attributes).toMatch(/type="button"/);
        }
    });

    // The filter pills are gone: the facet buttons that replaced them are
    // built from the data at runtime, so index.html carries only the container
    // and the view toggle.
    it('gives every toggle in the served markup an initial aria-pressed', () => {
        const toggles = buttons.filter(({ attributes }) => /class="view-btn/.test(attributes));

        expect(toggles).toHaveLength(2);
        for (const toggle of toggles) {
            expect(toggle.attributes).toMatch(/aria-pressed="(true|false)"/);
        }
    });

    it('leaves an empty facet bar for the toolbar to be built into', () => {
        expect(indexHtml).toMatch(/<div class="facet-bar" id="facetBar"><\/div>/);
        expect(indexHtml).not.toMatch(/class="pill"/);
    });

    // The one toggle that starts engaged is the default view, and its markup
    // must agree with the class it also carries. The grid is that default now:
    // a collection is scanned, and the carousel is a showcase.
    it('starts with the grid toggle both active and pressed', () => {
        const grid = buttons.find(({ attributes }) => /data-view="grid"/.test(attributes));

        expect(grid.attributes).toMatch(/class="view-btn active"/);
        expect(grid.attributes).toMatch(/aria-pressed="true"/);
    });

    it('starts with the carousel toggle unpressed, so exactly one view is on', () => {
        const carousel = buttons.find(({ attributes }) => /data-view="carousel"/.test(attributes));

        expect(carousel.attributes).not.toMatch(/active/);
        expect(carousel.attributes).toMatch(/aria-pressed="false"/);
    });

    // Same exclusive-toggle contract as the view buttons, so the same rules
    // apply: an initial aria-pressed, and exactly one of them engaged.
    it('gives the density group a name and both its buttons an aria-pressed', () => {
        const density = buttons.filter(({ attributes }) => /class="density-btn/.test(attributes));

        expect(density).toHaveLength(2);
        expect(indexHtml).toMatch(/id="densityToggle" role="group" aria-label="[^"]+"/);
        for (const button of density) {
            expect(button.attributes).toMatch(/aria-pressed="(true|false)"/);
            expect(button.attributes).toMatch(/data-density="(comfortable|compact)"/);
        }

        const pressed = density.filter(({ attributes }) => /aria-pressed="true"/.test(attributes));
        expect(pressed).toHaveLength(1);
        expect(pressed[0].attributes).toMatch(/data-density="comfortable"/);
    });

    it('labels the sort menu rather than leaving a bare select', () => {
        expect(indexHtml).toMatch(/<label class="visually-hidden" for="sortSelect">[^<]+<\/label>/);
        expect(indexHtml).toMatch(/<select class="sort-select" id="sortSelect"><\/select>/);
    });

    it('labels the search field rather than relying on the placeholder', () => {
        expect(indexHtml).toMatch(/<label class="visually-hidden" for="searchInput">[^<]+<\/label>/);
    });

    it('announces the counts that change as the user filters', () => {
        expect(indexHtml).toMatch(/aria-live="polite"[^>]*>\s*<span id="visibleCardsCount"/);
        expect(indexHtml).toMatch(/class="page-info" aria-live="polite"/);
    });

    // Raised by the 2026-08-08 audit as an extension of this card: the banner
    // and the empty state are dynamic regions that shipped after the card was
    // written, and a screen reader was told nothing when the collection
    // finished loading, failed, or a filter emptied the results.
    it('announces the loading and failure banner', () => {
        expect(indexHtml).toMatch(/id="statusMessage" role="status"/);
    });

    it('marks the empty state as a status region too', () => {
        expect(scriptJs).toMatch(/wrapper\.setAttribute\('role', 'status'\)/);
    });

    // Sets both halves of the state in one call. Two call sites setting the
    // class and the attribute separately is how they drift apart.
    it('routes every state change through the toggle helper', () => {
        expect(scriptJs).toMatch(/import \{ setToggleState, setExclusiveToggle \}/);
        expect(scriptJs).not.toMatch(/classList\.(add|remove)\('active'\)/);
    });
});

/**
 * The card detail dialog.
 *
 * A native <dialog> opened with showModal() is what supplies the focus trap,
 * the Escape handling, the inert background and the return of focus to the
 * opener. Asserting the element and the call together is the only check
 * available here — there is no DOM environment to open it in — so what these
 * guard is that the native mechanism is the one being used, rather than a div
 * with a class that would have to reimplement all four.
 */
describe('the card detail dialog', () => {
    it('is a real dialog element with an accessible name', () => {
        expect(indexHtml).toMatch(/<dialog class="card-dialog" id="cardDialog" aria-labelledby="cardDialogTitle">/);
        expect(indexHtml).toMatch(/id="cardDialogTitle"/);
    });

    it('is opened modally, which is what traps focus and answers Escape', () => {
        expect(scriptJs).toMatch(/dialog\.showModal\(\)/);
        // show() is the non-modal form and does none of that; a served `open`
        // attribute would put the dialog on screen with no modality at all.
        expect(scriptJs).not.toMatch(/\.show\(\)/);
        expect(indexHtml).not.toMatch(/<dialog[^>]*\sopen[\s>]/);
    });

    it('carries a visible close control as well as Escape', () => {
        expect(indexHtml).toMatch(/<button class="dialog-close" type="button" id="cardDialogClose" aria-label="[^"]+"/);
        expect(scriptJs).toMatch(/getElementById\('cardDialogClose'\)\.addEventListener\('click'/);
    });

    it('hands focus back to whatever opened it', () => {
        expect(scriptJs).toMatch(/cardDialogOpener/);
        expect(scriptJs).toMatch(/opener\?\.isConnected\) opener\.focus\(\)/);
    });

    // Escape means "close the card" while it is up. Letting the page-wide
    // shortcut through as well would empty the user's whole selection behind
    // the card they just closed — both handlers have to stand down.
    it('stops the page-wide Escape shortcut from firing behind it', () => {
        expect(scriptJs).toMatch(/function isCardDialogOpen\(\)/);
        expect(scriptJs.match(/if \(isCardDialogOpen\(\)\) return;/g) ?? []).toHaveLength(2);
    });

    it('empties the body on close, so no stale card is held', () => {
        expect(scriptJs).toMatch(/getElementById\('cardDialogBody'\)\.replaceChildren\(\)/);
    });
});

/**
 * The search suggestions combobox.
 *
 * There is no DOM environment here to open the dropdown in, so what these
 * guard is that the ARIA combobox pattern is the one being used — the roles,
 * the ownership and the activedescendant that keep focus in the input. The
 * matching and the wrap-around are covered directly in suggest.test.js; this is
 * the part only a screen reader would otherwise notice going missing.
 */
describe('the search suggestions combobox', () => {
    const input = indexHtml.match(/<input[^>]*id="searchInput"[^>]*>/)?.[0] ?? '';

    it('finds the search field, so the assertions below are not vacuous', () => {
        expect(input).not.toBe('');
    });

    it('marks the field as a combobox owning the suggestion list', () => {
        expect(input).toMatch(/role="combobox"/);
        expect(input).toMatch(/aria-controls="searchSuggestions"/);
        expect(input).toMatch(/aria-autocomplete="list"/);
    });

    // Served closed, and served saying so: a combobox with no aria-expanded is
    // announced as a plain text field until the first keystroke.
    it('ships closed and says so', () => {
        expect(input).toMatch(/aria-expanded="false"/);
        expect(indexHtml).toMatch(/id="searchSuggestions"[^>]*hidden/);
    });

    // The browser's own history dropdown would otherwise open over this one.
    it('turns the browser autocomplete off', () => {
        expect(input).toMatch(/autocomplete="off"/);
    });

    it('is a named listbox, shipped empty for script.js to fill', () => {
        expect(indexHtml).toMatch(/<ul class="search-suggestions"[^>]*role="listbox"/);
        expect(indexHtml).toMatch(/aria-label="Search suggestions"/);
        expect(indexHtml).toMatch(/id="searchSuggestions"[^>]*><\/ul>/);
    });

    it('gives every rendered option a role and a selected state', () => {
        expect(scriptJs).toMatch(/option\.setAttribute\('role', 'option'\)/);
        expect(scriptJs).toMatch(/option\.setAttribute\('aria-selected'/);
    });

    // Focus stays in the field being typed in; the highlight is a pointer, not
    // a tab stop. Moving real focus into the list would take the caret out of
    // the query the user is still writing.
    it('points at the highlight rather than moving focus into the list', () => {
        expect(scriptJs).toMatch(/setAttribute\('aria-activedescendant'/);
        expect(scriptJs).toMatch(/removeAttribute\('aria-activedescendant'\)/);
        expect(scriptJs).not.toMatch(/option\.focus\(\)/);
    });

    it('is keyboard operable in both directions and answers Enter', () => {
        for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
            expect(scriptJs).toContain(`'${key}'`);
        }
        expect(scriptJs).toMatch(/nextSuggestionIndex\(/);
    });

    // Escape dismisses the dropdown; it must not fall through to the page-wide
    // shortcut that clears every filter, and it must not clear the typed text.
    it('closes on Escape without touching the query or the filters', () => {
        const handler = scriptJs.match(/if \(event\.key === 'Escape'[\s\S]*?\n    \}/)?.[0] ?? '';

        expect(handler).toContain('stopPropagation()');
        expect(handler).toContain('closeSuggestions()');
        expect(handler).not.toContain('clearAllFilters');
        expect(handler).not.toContain('input.value');
    });

    // One debounce for the dropdown and the results, so the two cannot describe
    // different queries for a few frames.
    it('reuses the one debounced search handler rather than adding a second', () => {
        expect(scriptJs).toMatch(/addEventListener\('input', debounce\(/);
        expect(scriptJs.match(/debounce\(/g) ?? []).toHaveLength(1);
    });
});

describe('visually-hidden', () => {
    it('keeps hidden text in the accessibility tree', () => {
        const rule = stylesCss.match(/\.visually-hidden\s*{([^}]*)}/);

        expect(rule).not.toBeNull();
        // display:none and visibility:hidden both remove the element from the
        // tree, which would silently undo every use of this class.
        expect(rule[1]).not.toMatch(/display:\s*none/);
        expect(rule[1]).not.toMatch(/visibility:\s*hidden/);
        expect(rule[1]).toMatch(/clip-path/);
    });
});
