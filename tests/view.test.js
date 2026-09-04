import { describe, it, expect } from 'vitest';
import {
    VIEW_CAROUSEL,
    VIEW_GRID,
    VIEW_DEFAULT,
    VIEWS,
    DENSITY_COMFORTABLE,
    DENSITY_COMPACT,
    DENSITY_DEFAULT,
    DENSITIES,
    isValidView,
    normaliseView,
    isValidDensity,
    normaliseDensity,
    getViewVisibility
} from '../assets/js/view.js';

describe('isValidView', () => {
    it('accepts the two views the toolbar can select', () => {
        expect(isValidView(VIEW_CAROUSEL)).toBe(true);
        expect(isValidView(VIEW_GRID)).toBe(true);
    });

    it('rejects anything else, including near misses', () => {
        expect(isValidView('Carousel')).toBe(false);
        expect(isValidView('list')).toBe(false);
        expect(isValidView('')).toBe(false);
    });

    it('rejects a missing or malformed value without throwing', () => {
        expect(isValidView(null)).toBe(false);
        expect(isValidView(undefined)).toBe(false);
        expect(isValidView({})).toBe(false);
    });
});

describe('the default view', () => {
    // The grid is what a collection is scanned in. The carousel shows one card
    // at a time in a stage most of a viewport tall, which is a showcase.
    it('is the grid', () => {
        expect(VIEW_DEFAULT).toBe(VIEW_GRID);
    });

    it('is listed first, so the toolbar leads with it', () => {
        expect(VIEWS[0]).toBe(VIEW_DEFAULT);
    });

    it('still offers the carousel as a view in its own right', () => {
        expect(VIEWS).toContain(VIEW_CAROUSEL);
    });
});

describe('normaliseView', () => {
    it('leaves a known view alone', () => {
        expect(normaliseView(VIEW_CAROUSEL)).toBe(VIEW_CAROUSEL);
        expect(normaliseView(VIEW_GRID)).toBe(VIEW_GRID);
    });

    // The candidate now comes from a URL as well as from markup, so a shared
    // link with a typo in it has to land on a working page.
    it('falls back to the grid for an unknown view, so the page is never blank', () => {
        expect(normaliseView('list')).toBe(VIEW_GRID);
        expect(normaliseView('Carousel')).toBe(VIEW_GRID);
        expect(normaliseView(undefined)).toBe(VIEW_GRID);
        expect(normaliseView(null)).toBe(VIEW_GRID);
    });
});

describe('density', () => {
    it('declares exactly two, the default first', () => {
        expect(DENSITIES).toEqual([DENSITY_COMFORTABLE, DENSITY_COMPACT]);
        expect(DENSITY_DEFAULT).toBe(DENSITY_COMFORTABLE);
    });

    it('accepts the two it declares', () => {
        expect(isValidDensity(DENSITY_COMFORTABLE)).toBe(true);
        expect(isValidDensity(DENSITY_COMPACT)).toBe(true);
    });

    it('rejects anything else, including near misses', () => {
        expect(isValidDensity('Compact')).toBe(false);
        expect(isValidDensity('cosy')).toBe(false);
        expect(isValidDensity('')).toBe(false);
    });

    it('falls back to comfortable for anything unrecognised', () => {
        expect(normaliseDensity('cosy')).toBe(DENSITY_COMFORTABLE);
        expect(normaliseDensity(null)).toBe(DENSITY_COMFORTABLE);
        expect(normaliseDensity(undefined)).toBe(DENSITY_COMFORTABLE);
        expect(normaliseDensity({})).toBe(DENSITY_COMFORTABLE);
    });

    it('leaves a known density alone', () => {
        expect(normaliseDensity(DENSITY_COMPACT)).toBe(DENSITY_COMPACT);
    });
});

describe('getViewVisibility', () => {
    it('hides both views until the data has resolved', () => {
        expect(getViewVisibility(VIEW_CAROUSEL, false)).toEqual({ carousel: false, grid: false });
        expect(getViewVisibility(VIEW_GRID, false)).toEqual({ carousel: false, grid: false });
    });

    it('shows only the carousel when the carousel is selected', () => {
        expect(getViewVisibility(VIEW_CAROUSEL, true)).toEqual({ carousel: true, grid: false });
    });

    it('shows only the grid when the grid is selected', () => {
        expect(getViewVisibility(VIEW_GRID, true)).toEqual({ carousel: false, grid: true });
    });

    it('never shows both views at once', () => {
        for (const view of [...VIEWS, 'list', undefined]) {
            const visibility = getViewVisibility(view, true);
            expect(visibility.carousel && visibility.grid).toBe(false);
        }
    });

    it('shows exactly one view once ready, whatever the selection', () => {
        for (const view of [...VIEWS, 'list', undefined, null]) {
            const visibility = getViewVisibility(view, true);
            expect(visibility.carousel || visibility.grid).toBe(true);
        }
    });

    it('falls back to the grid for an unknown view rather than hiding everything', () => {
        expect(getViewVisibility('list', true)).toEqual({ carousel: false, grid: true });
    });

    it('treats a missing readiness flag as not ready', () => {
        expect(getViewVisibility(VIEW_CAROUSEL, undefined)).toEqual({ carousel: false, grid: false });
    });
});
