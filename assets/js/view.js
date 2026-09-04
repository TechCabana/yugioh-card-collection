/**
 * Which card view belongs on screen, and how densely it packs.
 *
 * Visibility has two independent inputs: the view the user picked, and whether
 * the collection has finished loading. Those used to be expressed in three
 * different ways at once (a `.hidden` class on the carousel, an `.active` class
 * on the grid, and the `hidden` attribute on both during load), so the answer
 * depended on which mechanism ran last. Deciding it here, in one pure function,
 * gives the DOM code a single source of truth and makes the rules testable
 * without a browser.
 */

/** The showcase view identifier, as used by the toolbar's `data-view`. */
export const VIEW_CAROUSEL = 'carousel';

/** The grid view identifier, as used by the toolbar's `data-view`. */
export const VIEW_GRID = 'grid';

/**
 * Every view the toolbar can select, the default first.
 *
 * The grid leads because a collection is a thing you scan. The carousel shows
 * one card at a time in a stage most of a viewport tall, which is a showcase:
 * worth having, and worth having to ask for.
 */
export const VIEWS = [VIEW_GRID, VIEW_CAROUSEL];

/** The view the page opens on when nothing says otherwise. */
export const VIEW_DEFAULT = VIEW_GRID;

/** Roomy grid: the card art has space around it. */
export const DENSITY_COMFORTABLE = 'comfortable';

/** Tight grid: more cards per screen, for scanning rather than admiring. */
export const DENSITY_COMPACT = 'compact';

/** Every density the toolbar can select, the default first. */
export const DENSITIES = [DENSITY_COMFORTABLE, DENSITY_COMPACT];

/** The density the grid opens at when nothing says otherwise. */
export const DENSITY_DEFAULT = DENSITY_COMFORTABLE;

/**
 * Whether a value names a view this app knows how to render.
 *
 * @param {unknown} view - candidate view identifier
 * @returns {boolean} true when the value is a known view
 */
export function isValidView(view) {
    return VIEWS.includes(view);
}

/**
 * Coerce any value to a usable view identifier.
 *
 * The candidate comes from markup (`data-view`) or from a URL query string, so
 * a typo, a missing attribute or a hand-edited link must not be able to blank
 * the page. Anything unrecognised falls back to the grid, which is the view
 * the app opens on.
 *
 * @param {unknown} view - candidate view identifier
 * @returns {string} a known view identifier
 */
export function normaliseView(view) {
    return isValidView(view) ? view : VIEW_DEFAULT;
}

/**
 * Whether a value names a grid density this app knows how to render.
 *
 * @param {unknown} density - candidate density identifier
 * @returns {boolean} true when the value is a known density
 */
export function isValidDensity(density) {
    return DENSITIES.includes(density);
}

/**
 * Coerce any value to a usable grid density.
 *
 * Same contract as normaliseView, and for the same reason: the value arrives
 * from `data-density` or from a URL, neither of which is this app's to trust.
 *
 * @param {unknown} density - candidate density identifier
 * @returns {string} a known density identifier
 */
export function normaliseDensity(density) {
    return isValidDensity(density) ? density : DENSITY_DEFAULT;
}

/**
 * Work out which views should be visible.
 *
 * Exactly one view is ever shown, and only once the data has resolved. While
 * loading or after a failure both are hidden, so the page never flashes empty
 * controls over a blank stage.
 *
 * The caller uses the grid flag for one more thing: the density toggle only
 * changes the grid, so it is offered exactly when the grid is on screen.
 *
 * @param {unknown} view - the currently selected view identifier
 * @param {boolean} isDataReady - whether the collection has loaded
 * @returns {{carousel: boolean, grid: boolean}} visibility per view
 */
export function getViewVisibility(view, isDataReady) {
    if (!isDataReady) {
        return { carousel: false, grid: false };
    }

    const active = normaliseView(view);
    return {
        carousel: active === VIEW_CAROUSEL,
        grid: active === VIEW_GRID
    };
}
