import { loadCards, cacheBustedUrl, formatUpdatedAt } from './assets/js/data.js';
import { buildCardHTML, buildCardDetailHTML } from './assets/js/render.js';
import {
    filterCards,
    matchesSearch,
    getCarouselSlots,
    wrapIndex,
    getTotalPages,
    getPageSlice,
    clampPage
} from './assets/js/filters.js';
import { FACETS, facetOptions, selectionChips, pruneSelection, shouldReopenFacet } from './assets/js/facets.js';
import { focusIndexAfterRemoval } from './assets/js/focus.js';
import { debounce } from './assets/js/debounce.js';
import { isTextEntryTarget } from './assets/js/keyboard.js';
import { setToggleState, setExclusiveToggle } from './assets/js/toggle.js';
import {
    VIEW_CAROUSEL,
    DENSITY_COMPACT,
    normaliseView,
    normaliseDensity,
    getViewVisibility
} from './assets/js/view.js';
import {
    SORT_COLLECTION,
    sortCards,
    sortOptions,
    sortValue,
    parseSortValue
} from './assets/js/sort.js';
import { parseUrlState, serialiseUrlState } from './assets/js/url-state.js';

/**
 * The state the page was opened with.
 *
 * Read before anything is rendered, so a shared or reloaded link never shows
 * the default view first and then snaps to what was asked for. Every value
 * here is already normalised — see assets/js/url-state.js — so nothing below
 * has to re-check what came out of the query string.
 */
const openingState = parseUrlState(window.location.search);

// Populated from data/cards.json once the fetch resolves.
let allCards = [];
let filteredCards = [];
let currentIndex = 0;
// Selected values keyed by facet. Facets AND against each other, values within
// a facet OR — see matchesSelection() in assets/js/facets.js. One object rather
// than a variable per group, so adding a facet needs no new state here.
let activeFacets = openingState.facets;
let currentView = openingState.view;
let currentDensity = openingState.density;
let sortField = openingState.sortField;
let sortDirection = openingState.sortDirection;
let currentPage = 1;

/**
 * Cards on one grid page.
 *
 * Raised from 18. The collection is past 200 cards, which 18 turned into
 * thirteen pages of a view whose whole job is scanning — a page button pressed
 * twelve times is not browsing. 48 lands it at five.
 *
 * Pagination is kept rather than replaced with infinite scroll, deliberately.
 * The page count is announced through an aria-live region and the pagination
 * is a named landmark; an infinite list has neither, gives a keyboard user no
 * way to reach anything below it, and would need its own history handling to
 * survive the back button. The art is `loading="lazy"` (render.js), so a larger
 * page costs no requests until the images are actually scrolled to.
 */
const cardsPerPage = 48;

// Views stay hidden until the fetch resolves, so the page never flashes empty
// controls over a blank stage. Held here because view visibility depends on it
// as much as it depends on which view is selected.
let isDataReady = false;

// Free-text search term, combined on top of the facet filters in applyFilters().
let searchQuery = openingState.query;

/**
 * The control that opened the detail dialog, so focus can be handed back.
 *
 * showModal() restores focus by itself, but only to an element still in the
 * document — and the grid is rebuilt by any filter change. Holding the
 * reference lets the close handler check that before trying.
 */
let cardDialogOpener = null;

/**
 * Write the current state into the address bar.
 *
 * `replaceState`, not `pushState`. Ticking a facet is an adjustment to the view
 * the user is already in, not a navigation away from it: pushing an entry per
 * checkbox would bury the page they arrived from under a dozen Back presses,
 * for a history stack whose entries all say "the same collection, slightly
 * differently filtered". replaceState still leaves a URL that reloads, shares
 * and bookmarks correctly, which is what the card actually asked for.
 *
 * Because nothing is ever pushed, there is no history entry to pop and so no
 * popstate handler here — Back leaves the page, which is what it did before.
 *
 * @returns {void}
 */
function writeUrlState() {
    const query = serialiseUrlState({
        view: currentView,
        density: currentDensity,
        sortField,
        sortDirection,
        query: searchQuery,
        facets: activeFacets
    });

    // An empty query string becomes the bare path rather than a dangling `?`.
    window.history.replaceState(null, '', query === '' ? window.location.pathname : `?${query}`);
}


/**
 * Build the block shown when no cards match the current filters.
 *
 * Carries its own clear action so the user can recover without hunting for
 * the toolbar button, which may be scrolled out of view on a phone.
 *
 * @returns {HTMLElement} the empty-state element
 */
function buildEmptyState() {
    const wrapper = document.createElement('div');
    wrapper.className = 'empty-state';
    // Belt and braces. This element is injected after the filter runs, and a
    // live region created at the same moment as its content is announced
    // inconsistently across screen readers — so the reliable announcement is
    // the visible-count region going to 0, which is already live and already
    // in the document. This helps where it does work and costs nothing where
    // it does not.
    wrapper.setAttribute('role', 'status');

    const title = document.createElement('p');
    title.className = 'empty-state-title';
    title.textContent = 'No cards match your filters';

    const hint = document.createElement('p');
    hint.className = 'empty-state-hint';
    hint.textContent = 'Try removing a filter or clearing the search.';

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'empty-state-action';
    action.textContent = 'Clear filters';
    action.addEventListener('click', clearAllFilters);

    wrapper.append(title, hint, action);
    return wrapper;
}

/**
 * Wrap the empty state in a list item.
 *
 * Both views render into a <ul> now, and only <li> is valid there. A bare
 * <div> child would put the block outside the list as far as assistive
 * technology is concerned, which is precisely the message that must not be
 * missed.
 *
 * @returns {HTMLElement} an li containing the empty-state block
 */
function buildEmptyStateItem() {
    const item = document.createElement('li');
    item.className = 'empty-state-item';
    item.appendChild(buildEmptyState());
    return item;
}

/**
 * Put the carousel counters and navigation into their empty state.
 *
 * Both renderers previously returned before touching their counters, leaving
 * stale numbers such as "Page 1 of 3" beside zero results.
 */
function resetCarouselControls() {
    document.getElementById('currentCard').textContent = '0';
    document.getElementById('totalCardsCarousel').textContent = '0';
    document.getElementById('prevBtn').disabled = true;
    document.getElementById('nextBtn').disabled = true;
}

/** Put the grid pagination into its empty state. */
function resetGridControls() {
    document.getElementById('currentPage').textContent = '0';
    document.getElementById('totalPages').textContent = '0';
    document.getElementById('prevPage').disabled = true;
    document.getElementById('nextPage').disabled = true;
}

/**
 * Build the control that brings a side card to the centre.
 *
 * A real `<button>`, so focus, Enter and Space all work without being
 * reimplemented. Before this the behaviour hung off an onclick on the card
 * element itself, which had no tabindex, no role and no key handler: the
 * affordance simply did not exist for anyone not using a pointer.
 *
 * It is an empty overlay stretched across the card rather than a wrapper
 * around the card's markup, because a button may only contain phrasing
 * content — wrapping would mean swallowing the `<h3>` card name and losing it
 * from the document outline, trading one accessibility problem for another.
 *
 * The card's own text is therefore not the button's name, so the name is set
 * explicitly. `setAttribute` rather than string interpolation: the card name
 * comes from Airtable and is not to be trusted into markup.
 *
 * @param {object} card - the card the button acts on
 * @param {number} index - its index in the filtered collection
 * @returns {HTMLElement} the button
 */
function buildCarouselCardAction(card, index) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'carousel-card-action';
    action.setAttribute('aria-label', `Show ${card?.name ?? 'card'}`);

    action.addEventListener('click', () => {
        currentIndex = index;
        updateCarousel();
        // The card just activated is now the centre one and has no button, so
        // focus would fall to <body>. Hand it to the control that governs the
        // carousel instead, which is where a keyboard user needs to be next.
        document.getElementById('nextBtn')?.focus();
    });

    return action;
}

function updateCarousel() {
    const stage = document.getElementById('carouselStage');
    stage.innerHTML = '';

    if (filteredCards.length === 0) {
        stage.appendChild(buildEmptyStateItem());
        resetCarouselControls();
        return;
    }

    document.getElementById('prevBtn').disabled = false;
    document.getElementById('nextBtn').disabled = false;

    // Slots narrow below 5 cards instead of wrapping, so no card index repeats.
    const slots = getCarouselSlots(filteredCards, currentIndex);

    slots.forEach(({ card, index, position, isCenter }) => {
        // li, not div: the stage is a <ul> now, so assistive technology can
        // announce how many cards are in the window rather than reading a
        // wall of unrelated groups.
        const cardEl = document.createElement('li');
        cardEl.className = `carousel-card ${position}`;
        cardEl.innerHTML = buildCardHTML(card);

        // Only a side card does anything when activated, so only a side card
        // gets a control. The centre card is already centred.
        if (!isCenter) {
            cardEl.appendChild(buildCarouselCardAction(card, index));
        }

        stage.appendChild(cardEl);
    });

    document.getElementById('currentCard').textContent = currentIndex + 1;
    document.getElementById('totalCardsCarousel').textContent = filteredCards.length;
}

/**
 * Build the control that opens a card's detail view.
 *
 * Same shape and same reasoning as buildCarouselCardAction: an empty button
 * stretched over the card rather than a wrapper around it, because a button
 * may only contain phrasing content and wrapping would swallow the card's
 * <h3> and take the name out of the document outline.
 *
 * This is what makes the grid card's pointer cursor honest — before it, the
 * grid had a hover response and nothing behind it. The affordance and the
 * keyboard-reachable control arrive together, which is the pairing
 * tests/affordance.test.js exists to hold.
 *
 * The name is set with setAttribute rather than interpolated: the card name is
 * Airtable's, and is not to be trusted into markup.
 *
 * @param {object} card - the card the button opens
 * @returns {HTMLElement} the button
 */
function buildGridCardAction(card) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'grid-card-action';
    action.setAttribute('aria-label', `Show details for ${card?.name ?? 'card'}`);

    action.addEventListener('click', () => openCardDialog(card, action));

    return action;
}

/**
 * Open the detail dialog on one card.
 *
 * showModal() rather than an `open` attribute or a div with a class: only the
 * modal form puts the dialog in the top layer, makes everything behind it
 * inert, traps focus inside it and answers Escape — all four for free, and all
 * four are things a hand-rolled overlay has to reimplement.
 *
 * @param {object} card - the card to show
 * @param {HTMLElement} opener - the control that asked for it
 * @returns {void}
 */
function openCardDialog(card, opener) {
    const dialog = document.getElementById('cardDialog');
    // Escaped in render.js, exactly as for the card in the grid behind it.
    document.getElementById('cardDialogBody').innerHTML = buildCardDetailHTML(card);

    cardDialogOpener = opener;
    dialog.showModal();
}

/**
 * Whether the detail dialog is currently open.
 *
 * The page's global Escape shortcut clears every filter, which must not happen
 * when Escape was meant for the dialog — closing a card would otherwise empty
 * the user's whole selection behind it.
 *
 * @returns {boolean} true while the dialog is showing
 */
function isCardDialogOpen() {
    return document.getElementById('cardDialog').open === true;
}

document.getElementById('cardDialogClose').addEventListener('click', () => {
    document.getElementById('cardDialog').close();
});

// A click on the backdrop. The dialog's own children fill it edge to edge —
// its padding is 0 — so the element itself is only ever the target out here.
document.getElementById('cardDialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});

/*
 * One close handler for every way it can close: the button, Escape, and the
 * backdrop all fire `close`.
 *
 * The body is emptied so a closed dialog holds no stale card, and focus goes
 * back to the control that opened it. showModal() already restores focus, but
 * only while that element is still in the document, so the check is what makes
 * the promise unconditional.
 */
document.getElementById('cardDialog').addEventListener('close', () => {
    document.getElementById('cardDialogBody').replaceChildren();

    const opener = cardDialogOpener;
    cardDialogOpener = null;

    if (opener?.isConnected) opener.focus();
});

function updateGrid() {
    const grid = document.getElementById('cardGrid');
    grid.innerHTML = '';

    if (filteredCards.length === 0) {
        const empty = buildEmptyStateItem();
        // The grid is a CSS grid; span the full row so the block centres.
        empty.style.gridColumn = '1 / -1';
        grid.appendChild(empty);
        resetGridControls();
        return;
    }

    // getTotalPages and getPageSlice clamp an out-of-range page rather than
    // returning nothing, so a filter that shrinks the set cannot strand the
    // user on a blank page.
    const totalPages = getTotalPages(filteredCards.length, cardsPerPage);
    currentPage = clampPage(currentPage, totalPages);
    const pageCards = getPageSlice(filteredCards, currentPage, cardsPerPage);

    pageCards.forEach(card => {
        const cardEl = document.createElement('li');
        cardEl.className = 'grid-card';
        cardEl.innerHTML = buildCardHTML(card);
        // The li itself stays a plain list item — no tabindex, no role, no
        // handler. The tab stop and the click both belong to the button.
        cardEl.appendChild(buildGridCardAction(card));
        grid.appendChild(cardEl);
    });

    document.getElementById('currentPage').textContent = currentPage;
    document.getElementById('totalPages').textContent = totalPages;
    document.getElementById('prevPage').disabled = currentPage === 1;
    document.getElementById('nextPage').disabled = currentPage === totalPages;
}

/**
 * Re-run the filter/search pipeline and re-render both views' controls.
 *
 * @param {object} [options]
 * @param {boolean} [options.preservePosition] - keep the current card/page
 *   rather than snapping back to the first. Every caller except a refresh
 *   changed the filter criteria themselves, so starting over at card one is
 *   the right call for them; a refresh changed only the data behind an
 *   unchanged selection, and the card for this feature is explicit that the
 *   user's context — filters, search term and view — must survive it.
 * @returns {void}
 */
function applyFilters({ preservePosition = false } = {}) {
    // Facets AND against each other; values inside a facet OR. The search term
    // ANDs on top of all of them, all handled inside filterCards().
    //
    // Sorting runs over the result rather than over allCards: an order decides
    // which of the matching cards you meet first, and can neither widen nor
    // narrow what matched. The facet counts are unaffected — facetOptions
    // counts a set, and a set has no order.
    filteredCards = sortCards(
        filterCards(allCards, {
            facets: activeFacets,
            query: searchQuery
        }),
        sortField,
        sortDirection
    );

    if (preservePosition) {
        // Clamped rather than trusted outright: the refreshed collection can
        // be shorter than the one being browsed, and both helpers already
        // handle zero cards without a caller-side special case.
        currentIndex = wrapIndex(currentIndex, filteredCards.length);
        currentPage = clampPage(currentPage, getTotalPages(filteredCards.length, cardsPerPage));
    } else {
        currentIndex = 0;
        currentPage = 1;
    }

    // After filtering, not before: every count in every menu is stated against
    // the filters that are actually applied now.
    renderFilterControls();

    document.getElementById('visibleCardsCount').textContent = filteredCards.length;
    document.getElementById('totalCardsCount').textContent = allCards.length;

    // Every path into this function changed something the URL carries — a
    // facet, the search term, the sort, or the collection behind them — so the
    // address bar is brought back into step here rather than at each caller.
    writeUrlState();

    if (currentView === VIEW_CAROUSEL) {
        updateCarousel();
    } else {
        updateGrid();
    }
}

/**
 * Toggle one value of one facet, then re-render.
 *
 * @param {string} facetKey - a key from FACETS
 * @param {string} value - the value being ticked or unticked
 * @returns {void}
 */
function toggleFacetValue(facetKey, value) {
    const selected = activeFacets[facetKey] ?? [];

    activeFacets[facetKey] = selected.includes(value)
        ? selected.filter(existing => existing !== value)
        : [...selected, value];

    // An empty array and an absent key mean the same thing to matchesSelection,
    // but only the absent key keeps the selection object readable in a debugger
    // and keeps countSelected honest.
    if (activeFacets[facetKey].length === 0) delete activeFacets[facetKey];

    applyFilters();
}

/**
 * Close every open facet panel.
 *
 * @param {HTMLElement} [except] - a panel to leave open
 * @returns {void}
 */
function closeFacetPanels(except = null) {
    for (const panel of document.querySelectorAll('.facet-panel')) {
        if (panel === except) continue;
        panel.hidden = true;
        document.getElementById(panel.dataset.buttonId)?.setAttribute('aria-expanded', 'false');
    }
}

/**
 * Build one facet's button and panel.
 *
 * Built with DOM calls rather than innerHTML: every value here comes from
 * Airtable by way of data/cards.json, and textContent cannot be talked into
 * executing anything, whereas an escaping mistake in a template string can.
 *
 * @param {object} facet - an entry from FACETS
 * @returns {HTMLElement} the facet's wrapper element
 */
function buildFacet(facet) {
    const wrapper = document.createElement('div');
    wrapper.className = 'facet';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'facet-btn';
    button.id = `facet-btn-${facet.key}`;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `facet-panel-${facet.key}`);

    const label = document.createElement('span');
    label.textContent = facet.label;

    // Shows how many values are ticked, so a collapsed panel still says
    // whether it is doing anything.
    const badge = document.createElement('span');
    badge.className = 'facet-btn-count';
    badge.hidden = true;

    button.append(label, badge);

    const panel = document.createElement('div');
    panel.className = 'facet-panel';
    panel.id = `facet-panel-${facet.key}`;
    panel.dataset.buttonId = button.id;
    panel.dataset.facetKey = facet.key;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-labelledby', button.id);
    panel.hidden = true;

    button.addEventListener('click', () => {
        const willOpen = panel.hidden;
        closeFacetPanels(panel);
        panel.hidden = !willOpen;
        button.setAttribute('aria-expanded', String(willOpen));
    });

    wrapper.append(button, panel);
    return wrapper;
}

/**
 * Rebuild a facet panel's checkboxes and counts.
 *
 * Counts move as other filters change, so the contents are rewritten rather
 * than built once. The checkbox state is read back from activeFacets, which
 * stays the single source of truth.
 *
 * @param {HTMLElement} panel - the panel element
 * @returns {void}
 */
function renderFacetPanel(panel) {
    const facetKey = panel.dataset.facetKey;
    const options = facetOptions(allCards, facetKey, {
        selection: activeFacets,
        matchesQuery: card => matchesSearch(card, searchQuery)
    });

    // Ticking a box calls this function to redraw the counts, which throws
    // away and recreates the very checkbox that is mid-`change` event. A
    // focused element removed from the document loses focus to <body>, so
    // without remembering which value held it, every tick in an open panel
    // would strand a keyboard or screen-reader user — see focus.js.
    const focusedValue = panel.contains(document.activeElement)
        ? document.activeElement.value
        : null;

    panel.replaceChildren();

    let focusTarget = null;

    for (const option of options) {
        const selected = (activeFacets[facetKey] ?? []).includes(option.value);

        const row = document.createElement('label');
        row.className = 'facet-option';
        // A value that would return nothing is dimmed rather than removed, so
        // the menu does not reshuffle under the cursor as boxes are ticked.
        row.classList.toggle('is-empty', option.count === 0 && !selected);

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = selected;
        box.value = option.value;
        box.addEventListener('change', () => toggleFacetValue(facetKey, option.value));

        if (focusedValue !== null && option.value === focusedValue) {
            focusTarget = box;
        }

        const text = document.createElement('span');
        text.className = 'facet-option-label';
        text.textContent = option.label;

        const count = document.createElement('span');
        count.className = 'facet-option-count';
        count.textContent = String(option.count);

        row.append(box, text, count);
        panel.appendChild(row);
    }

    // The toggled value always survives the rebuild — facetOptions keeps
    // every value the collection has ever shown, even one whose live count is
    // now 0 — so this is a real restore, not a best-effort one.
    focusTarget?.focus();
}

/**
 * Rebuild the chip tray from the current selection.
 *
 * @returns {void}
 */
function renderChipTray() {
    const tray = document.getElementById('chipTray');
    const chips = selectionChips(activeFacets);

    // Removing a chip rebuilds the whole tray, including the chip that was
    // just clicked. Capture its position before it is gone, so focus can land
    // on whichever chip now occupies that slot instead of falling to <body>
    // — see focus.js for the index math.
    const focusedIndex = [...tray.children].indexOf(document.activeElement);

    tray.replaceChildren();
    tray.hidden = chips.length === 0;
    document.getElementById('clearFilters').hidden = chips.length === 0 && searchQuery === '';

    const rendered = [];

    for (const chip of chips) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chip';
        // The visible text is just the value; the accessible name says which
        // facet it came from and what pressing it does, because "Earth" alone
        // means nothing announced out of context.
        button.setAttribute('aria-label', `Remove filter ${chip.facetLabel}: ${chip.label}`);
        button.addEventListener('click', () => toggleFacetValue(chip.facetKey, chip.value));

        const text = document.createElement('span');
        text.textContent = chip.label;

        const cross = document.createElement('span');
        cross.className = 'chip-remove';
        cross.setAttribute('aria-hidden', 'true');
        cross.textContent = '×';

        button.append(text, cross);
        tray.appendChild(button);
        rendered.push(button);
    }

    if (focusedIndex === -1) return;

    const nextIndex = focusIndexAfterRemoval(focusedIndex, rendered.length);
    if (nextIndex !== -1) {
        rendered[nextIndex].focus();
        return;
    }

    // The tray is now empty. Land on whatever is next in the toolbar instead
    // of letting focus fall out to <body> — the clear button when it is still
    // visible (a search term can keep it shown after the last chip goes),
    // the search box otherwise.
    const clearButton = document.getElementById('clearFilters');
    if (clearButton && !clearButton.hidden) {
        clearButton.focus();
    } else {
        document.getElementById('searchInput')?.focus();
    }
}

/**
 * Refresh every part of the filter UI that depends on the current selection.
 *
 * @returns {void}
 */
function renderFilterControls() {
    for (const panel of document.querySelectorAll('.facet-panel')) {
        renderFacetPanel(panel);

        const selectedCount = (activeFacets[panel.dataset.facetKey] ?? []).length;
        const badge = document.querySelector(`#${panel.dataset.buttonId} .facet-btn-count`);
        badge.textContent = String(selectedCount);
        badge.hidden = selectedCount === 0;
        document.getElementById(panel.dataset.buttonId)
            .classList.toggle('is-active', selectedCount > 0);
    }

    renderChipTray();
}

/**
 * Build the facet toolbar once the collection is known.
 *
 * Called again by refreshCollection() once the toolbar already has live
 * panels in it — possibly one open, possibly with focus inside it, since
 * neither the panels nor the search box are disabled while a refresh is in
 * flight. `replaceChildren()` below throws all of that away unconditionally,
 * which would otherwise silently close whatever the user had open and drop
 * their focus to `<body>` out from under them. The open panel is captured
 * before the rebuild and reopened after, so a refresh cannot do that.
 *
 * @returns {void}
 */
function buildFacetBar() {
    const bar = document.getElementById('facetBar');

    const openPanel = bar.querySelector('.facet-panel:not([hidden])');
    const reopenFacetKey = openPanel?.dataset.facetKey ?? null;
    // Only meaningful if focus was actually inside the open panel — an open
    // panel with focus elsewhere on the page has nothing worth restoring.
    const reopenValue = openPanel?.contains(document.activeElement)
        ? (document.activeElement.value ?? null)
        : null;

    bar.replaceChildren();

    const availableFacetKeys = [];
    for (const facet of FACETS) {
        // A facet no card has a value for would render an empty menu, so it
        // is skipped entirely. Every facet in FACETS has at least one value
        // today, but Summon Type — Fusion / Synchro / XYZ / Ritual / Link /
        // None, per CLAUDE.md §3 — is exactly this case should it ever be
        // added: every card in the collection currently leaves it null.
        if (facetOptions(allCards, facet.key).length === 0) continue;
        bar.appendChild(buildFacet(facet));
        availableFacetKeys.push(facet.key);
    }

    renderFilterControls();

    if (shouldReopenFacet(reopenFacetKey, availableFacetKeys)) {
        const panel = document.getElementById(`facet-panel-${reopenFacetKey}`);
        const button = document.getElementById(`facet-btn-${reopenFacetKey}`);
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');

        // The value itself might be the very thing the refresh pruned away —
        // shouldReopenFacet only promises the facet still exists, not that
        // every value in it does — so the button is a real fallback, not a
        // formality.
        const target = reopenValue !== null
            ? [...panel.querySelectorAll('input[type="checkbox"]')].find(box => box.value === reopenValue)
            : null;
        (target ?? button).focus();
    }
}

// A click anywhere else closes the open panel. Escape does the same but also
// returns focus to the button that opened it, which a click does not need to.
document.addEventListener('click', (event) => {
    if (!event.target.closest('.facet')) closeFacetPanels();
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // The dialog answers Escape itself, and a facet panel cannot be open
    // behind it anyway — everything back there is inert while it is showing.
    if (isCardDialogOpen()) return;

    const openPanel = [...document.querySelectorAll('.facet-panel')].find(panel => !panel.hidden);
    if (!openPanel) return;

    closeFacetPanels();
    document.getElementById(openPanel.dataset.buttonId)?.focus();
});

/**
 * Reset every filter and the search term, then re-render.
 *
 * Shared by the toolbar button and the empty state's own action, so both
 * always clear exactly the same state.
 */
function clearAllFilters() {
    activeFacets = {};
    searchQuery = '';
    document.getElementById('searchInput').value = '';
    applyFilters();
}

document.getElementById('clearFilters').addEventListener('click', clearAllFilters);

// A search term carried in on the URL has to show in the box it came from,
// or the results look filtered by nothing.
document.getElementById('searchInput').value = searchQuery;

// Live search: debounced so filtering/re-render doesn't run on every keystroke.
document.getElementById('searchInput').addEventListener('input', debounce((e) => {
    searchQuery = e.target.value;
    applyFilters();
}, 150));

// View toggle
document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // The view buttons are mutually exclusive, so the whole group is set
        // at once rather than clearing and then re-adding.
        setExclusiveToggle(document.querySelectorAll('.view-btn'), btn);
        currentView = normaliseView(btn.dataset.view);

        applyViewVisibility();
        writeUrlState();

        if (currentView === VIEW_CAROUSEL) {
            updateCarousel();
        } else {
            updateGrid();
        }
    });
});

/**
 * Push the current density onto the grid.
 *
 * A class toggle reading two custom properties in styles.css, not inline
 * styles: the sizes belong in the stylesheet with the breakpoints that adjust
 * them, and an inline style would outrank every one of those.
 *
 * @returns {void}
 */
function applyDensity() {
    document.getElementById('cardGrid')
        .classList.toggle('is-compact', currentDensity === DENSITY_COMPACT);
}

// Density toggle. Same exclusive-group handling as the view buttons, so the
// visible state and the announced aria-pressed cannot drift apart.
document.querySelectorAll('.density-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setExclusiveToggle(document.querySelectorAll('.density-btn'), btn);
        currentDensity = normaliseDensity(btn.dataset.density);

        applyDensity();
        writeUrlState();
    });
});

/**
 * Mark the sort control as active when it is doing something.
 *
 * Collection order is the absence of a sort, so it is the one choice that
 * takes no accent — the same statement an unticked facet makes.
 *
 * @returns {void}
 */
function syncSortState() {
    document.getElementById('sortSelect')
        .classList.toggle('is-active', sortField !== SORT_COLLECTION);
}

/**
 * Fill the sort menu and wire it up.
 *
 * The options come from sortOptions() rather than from index.html, so the menu
 * cannot offer a field the comparison rules do not implement, or miss one they
 * do. Built with createElement and textContent: the labels are this app's own
 * strings today, but the menu is one edit away from being data-driven and an
 * escaping mistake there is not worth the saving.
 *
 * @returns {void}
 */
function buildSortMenu() {
    const select = document.getElementById('sortSelect');

    for (const option of sortOptions()) {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        select.appendChild(el);
    }

    // Whatever the URL asked for, already normalised.
    select.value = sortValue(sortField, sortDirection);

    select.addEventListener('change', () => {
        const next = parseSortValue(select.value);
        sortField = next.field;
        sortDirection = next.direction;

        syncSortState();
        // Not preservePosition: reordering makes "card 4" a different card, so
        // holding the index would move the user somewhere they did not ask for.
        applyFilters();
    });

    syncSortState();
}

buildSortMenu();

/**
 * Bring the toolbar's toggles into line with the state the page opened in.
 *
 * index.html ships the defaults marked active, which is right for a bare
 * visit and wrong for a link carrying a view or a density. Both values are
 * normalised before they get here, so the selectors below can only ever match
 * a button that exists.
 *
 * @returns {void}
 */
function syncToolbarToggles() {
    setExclusiveToggle(
        document.querySelectorAll('.view-btn'),
        document.querySelector(`.view-btn[data-view="${currentView}"]`)
    );
    setExclusiveToggle(
        document.querySelectorAll('.density-btn'),
        document.querySelector(`.density-btn[data-density="${currentDensity}"]`)
    );
}

syncToolbarToggles();
applyDensity();

// Carousel navigation
document.getElementById('prevBtn').addEventListener('click', () => {
    currentIndex = wrapIndex(currentIndex - 1, filteredCards.length);
    updateCarousel();
});

document.getElementById('nextBtn').addEventListener('click', () => {
    currentIndex = wrapIndex(currentIndex + 1, filteredCards.length);
    updateCarousel();
});

// Grid pagination
document.getElementById('prevPage').addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        updateGrid();
    }
});

document.getElementById('nextPage').addEventListener('click', () => {
    // Reuse getTotalPages rather than a second hand-rolled Math.ceil, so the
    // two page-count computations in this file cannot drift apart.
    const totalPages = getTotalPages(filteredCards.length, cardsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        updateGrid();
    }
});

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    // Stand down while the user is typing, or Left and Right would move the
    // text cursor and the carousel at the same time. The sort menu is a
    // <select>, which isTextEntryTarget already covers — its own arrow keys
    // change the selected option.
    if (isTextEntryTarget(e.target)) return;

    // Stand down while the detail dialog is up. Escape belongs to the dialog
    // there, and clearing every filter behind a card the user just closed
    // would be the most destructive thing this page can do by accident.
    if (isCardDialogOpen()) return;

    // Escape clears filters from anywhere, including the grid view.
    if (e.key === 'Escape') {
        e.preventDefault();
        clearAllFilters();
        return;
    }

    if (currentView !== VIEW_CAROUSEL || filteredCards.length === 0) return;

    switch (e.key) {
        case 'ArrowLeft':
            currentIndex = wrapIndex(currentIndex - 1, filteredCards.length);
            break;
        case 'ArrowRight':
            currentIndex = wrapIndex(currentIndex + 1, filteredCards.length);
            break;
        case 'Home':
            currentIndex = 0;
            break;
        case 'End':
            currentIndex = filteredCards.length - 1;
            break;
        default:
            return;
    }

    // Only reached for a handled key, so the page never scrolls underneath.
    e.preventDefault();
    updateCarousel();
});

// Bootstrap

/**
 * Show or hide the loading / error banner.
 *
 * @param {string|null} message - text to show, or null to hide the banner
 * @param {boolean} [isError] - style the banner as a failure
 */
function setStatus(message, isError = false) {
    const el = document.getElementById('statusMessage');
    if (!el) return;

    el.textContent = message ?? '';
    el.classList.toggle('is-error', isError);
    el.hidden = message === null;
}

/**
 * Push the current visibility decision onto the two view containers.
 *
 * The decision itself lives in assets/js/view.js. Visibility is expressed with
 * the `hidden` attribute alone: it is the one mechanism assistive technology
 * reads, and a single convention cannot contradict itself the way the old
 * class pair could.
 */
function applyViewVisibility() {
    const visibility = getViewVisibility(currentView, isDataReady);
    document.getElementById('carouselView').hidden = !visibility.carousel;
    document.getElementById('gridView').hidden = !visibility.grid;
    // Density changes the grid and nothing else, so the control is offered
    // exactly when the grid is on screen. Two buttons that do nothing while
    // the showcase is up would be the same lie the grid card's old pointer
    // cursor told.
    document.getElementById('densityToggle').hidden = !visibility.grid;
}

/**
 * Record whether the collection has resolved, then refresh what is on screen.
 *
 * @param {boolean} ready - whether the collection has loaded
 */
function setDataReady(ready) {
    isDataReady = ready;
    applyViewVisibility();
}

/**
 * Re-fetch the deployed collection without reloading the page.
 *
 * What it shows is the last data the pipeline deployed, not Airtable live —
 * a static page has nowhere safe to keep a token, which is the same reason
 * client-side Airtable was rejected outright (CLAUDE.md §3).
 *
 * The user's context survives on purpose: the filters, the search term, the
 * view and the scroll position are all left alone. Only a selected value that
 * no longer exists anywhere in the new data is dropped, because that one would
 * filter the page down to nothing with no way for the user to know why.
 *
 * A failure keeps the collection already on screen. Replacing a working page
 * with an error because a refresh failed would lose the user more than the
 * stale data cost them.
 *
 * @returns {Promise<void>}
 */
async function refreshCollection() {
    const button = document.getElementById('refreshBtn');
    if (button.disabled) return;

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    try {
        const { cards, skipped } = await loadCards(cacheBustedUrl());

        if (skipped > 0) {
            console.warn(`Skipped ${skipped} card record(s) missing required fields.`);
        }

        // An empty payload is treated as a failed refresh rather than an empty
        // collection: the pipeline refuses to publish zero cards, so this can
        // only be a bad deploy or a truncated response.
        if (cards.length === 0) {
            throw new Error('The refreshed collection came back empty. Keeping the cards already loaded.');
        }

        allCards = cards;
        activeFacets = pruneSelection(activeFacets, allCards);

        // Values and counts both come from the collection, so the toolbar is
        // rebuilt rather than left describing the previous data. The filter
        // criteria did not change, only the data behind them, so the card the
        // user was looking at is kept rather than snapped back to the first —
        // see applyFilters()'s preservePosition.
        buildFacetBar();
        applyFilters({ preservePosition: true });

        setStatus(null);
        document.getElementById('refreshStamp').textContent = formatUpdatedAt(new Date());
    } catch (error) {
        console.error(error);
        setStatus(error.message, true);
    } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
    }
}

document.getElementById('refreshBtn').addEventListener('click', refreshCollection);

/**
 * Load the collection, then render it.
 *
 * A failure leaves a readable message on screen rather than a blank page.
 */
async function init() {
    setDataReady(false);
    setStatus('Loading collection…');

    try {
        const { cards, skipped } = await loadCards();
        allCards = cards;

        if (skipped > 0) {
            console.warn(`Skipped ${skipped} card record(s) missing required fields.`);
        }

        if (allCards.length === 0) {
            setStatus('No cards found in the collection.');
            return;
        }

        setStatus(null);
        setDataReady(true);
        // Any facet value the URL carried is checked against the collection
        // before a single card is drawn. A link naming a set that is no longer
        // held — or a value invented by hand — would otherwise filter the page
        // down to nothing with no way for the reader to see why.
        activeFacets = pruneSelection(activeFacets, allCards);
        // The facets and their values are read off the collection, so the
        // toolbar cannot be built until the data is in.
        buildFacetBar();
        applyFilters();
        document.getElementById('refreshStamp').textContent = formatUpdatedAt(new Date());
    } catch (error) {
        console.error(error);
        setStatus(error.message, true);
    }
}

init();
