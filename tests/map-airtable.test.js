import { describe, it, expect } from 'vitest';
import {
    mapRecord,
    mapRecords,
    missingRequiredFields,
    buildCardTypeLabel,
    buildStats,
    assertNoPrivateFields,
    PRIVATE_FIELDS
} from '../scripts/map-airtable.mjs';
import { RARITY_ORDER } from '../assets/js/filters.js';
import { RARITY_LABELS } from '../assets/js/render.js';
import { cardFrame } from '../assets/js/frames.js';

/** Mirrors a real record from the live base. */
const monsterRecord = {
    id: 'rec001',
    fields: {
        Name: 'Magician of Faith',
        Passcode: '31560081',
        Type: 'Monster',
        'Card Type': 'Spellcaster',
        'Card Sign': 'Light',
        'Summon Type': 'None',
        HasEffect: true,
        Rarity: 'Common',
        Serial: 'SDJ-017',
        Attack: 300,
        Defense: 400,
        Level: 1,
        Quantity: 1,
        Condition: 'Moderately Played'
    }
};

const spellRecord = {
    id: 'rec002',
    fields: {
        Name: 'Pot of Greed',
        Passcode: '55144522',
        Type: 'Spell',
        Rarity: 'Ultra Rare',
        Serial: 'LOB-119',
        Quantity: 3,
        Condition: 'Near Mint'
    }
};

describe('buildCardTypeLabel', () => {
    it('composes race, summon type and effect flag', () => {
        expect(buildCardTypeLabel({
            'Card Type': 'Spellcaster', 'Summon Type': 'Fusion', HasEffect: true, Type: 'Monster'
        })).toBe('Spellcaster / Fusion / Effect');
    });

    it('marks a non-effect monster as Normal', () => {
        expect(buildCardTypeLabel({
            'Card Type': 'Warrior', 'Summon Type': 'None', HasEffect: false, Type: 'Monster'
        })).toBe('Warrior / Normal');
    });

    it('omits a "None" summon type', () => {
        expect(buildCardTypeLabel(monsterRecord.fields)).toBe('Spellcaster / Effect');
    });

    it('labels spells and traps by their type', () => {
        expect(buildCardTypeLabel({ Type: 'Trap' })).toBe('Trap');
    });

    it('returns an empty string when nothing is known', () => {
        expect(buildCardTypeLabel({})).toBe('');
    });
});

describe('buildStats', () => {
    it('gives monsters combat stats', () => {
        expect(buildStats(monsterRecord.fields)).toEqual([
            { label: 'ATK', value: '300' },
            { label: 'DEF', value: '400' },
            { label: 'Level', value: '1' }
        ]);
    });

    it('substitutes a dash for missing monster numbers', () => {
        const stats = buildStats({ Type: 'Monster' });
        expect(stats.map(s => s.value)).toEqual(['—', '—', '—']);
    });

    it('keeps a zero attack rather than treating it as missing', () => {
        const stats = buildStats({ Type: 'Monster', Attack: 0, Defense: 0, Level: 4 });
        expect(stats[0].value).toBe('0');
        expect(stats[1].value).toBe('0');
    });

    it('gives spells and traps classification stats instead', () => {
        expect(buildStats(spellRecord.fields).map(s => s.label))
            .toEqual(['Type', 'Attribute', 'Serial']);
    });

    it('always returns exactly three entries', () => {
        [monsterRecord.fields, spellRecord.fields, {}].forEach(fields => {
            expect(buildStats(fields)).toHaveLength(3);
        });
    });
});

describe('mapRecord', () => {
    it('maps a monster record completely', () => {
        const card = mapRecord(monsterRecord);

        expect(card).toMatchObject({
            id: 'rec001',
            name: 'Magician of Faith',
            type: 'monster',
            rarity: 'common',
            passcode: '31560081',
            serial: 'SDJ-017',
            cardType: 'Spellcaster / Effect',
            attribute: 'Light',
            atk: 300,
            def: 400,
            level: 1,
            summonType: null
        });
    });

    it('lowercases the type and rarity for the filters', () => {
        expect(mapRecord(spellRecord)).toMatchObject({ type: 'spell', rarity: 'ultra' });
    });

    it('keeps the passcode as a string so leading zeros survive', () => {
        const card = mapRecord({ id: 'r', fields: { ...monsterRecord.fields, Passcode: '00123456' } });
        expect(card.passcode).toBe('00123456');
    });

    it('points the card at its mirrored art', () => {
        expect(mapRecord(monsterRecord).image).toBe('assets/cards/31560081.jpg');
    });

    // A null image is what makes the renderer fall back to the placeholder,
    // so it must survive rather than becoming a broken path.
    it('leaves the image null when the passcode is missing or malformed', () => {
        const noPasscode = mapRecord({ id: 'r', fields: { ...monsterRecord.fields, Passcode: undefined } });
        const badPasscode = mapRecord({ id: 'r', fields: { ...monsterRecord.fields, Passcode: 'not-a-code' } });

        expect(noPasscode.image).toBeNull();
        expect(badPasscode.image).toBeNull();
    });

    it('no longer emits a placeholder emoji', () => {
        expect(mapRecord(monsterRecord)).not.toHaveProperty('emoji');
    });

    // Owner-typed and deliberately published: edition describes the printing a
    // visitor is looking at, not what the owner paid or how many they hold, so
    // it is not inventory data and does not belong in PRIVATE_FIELDS.
    describe('isFirstEdition', () => {
        it('publishes true for a ticked checkbox', () => {
            const card = mapRecord({
                id: 'r',
                fields: { ...monsterRecord.fields, IsFirstEdition: true }
            });

            expect(card.isFirstEdition).toBe(true);
        });

        // Airtable omits an unticked checkbox entirely rather than sending
        // false, so this is the common case, not an edge case.
        it('publishes false when the field is absent', () => {
            expect(mapRecord(monsterRecord).isFirstEdition).toBe(false);
        });

        it('publishes false for an explicit false', () => {
            const card = mapRecord({
                id: 'r',
                fields: { ...monsterRecord.fields, IsFirstEdition: false }
            });

            expect(card.isFirstEdition).toBe(false);
        });

        // A truthy non-boolean must not be published as true — the field is a
        // claim about a physical card, so only a real tick counts.
        it('publishes false for a truthy value that is not literally true', () => {
            for (const value of ['true', 1, 'yes', {}]) {
                const card = mapRecord({
                    id: 'r',
                    fields: { ...monsterRecord.fields, IsFirstEdition: value }
                });

                expect(card.isFirstEdition).toBe(false);
            }
        });

        it('is always a boolean, never undefined', () => {
            expect(typeof mapRecord(monsterRecord).isFirstEdition).toBe('boolean');
            expect(typeof mapRecord(spellRecord).isFirstEdition).toBe('boolean');
        });

        it('is not required, so a row without it is never dropped', () => {
            expect(missingRequiredFields(monsterRecord)).toEqual([]);
            expect(mapRecord(monsterRecord)).not.toBeNull();
        });

        it('is not a private field', () => {
            expect(PRIVATE_FIELDS.map(f => f.toLowerCase())).not.toContain('isfirstedition');
        });
    });

    /*
     * Effect vs Normal, published as its own field.
     *
     * It was already in the data — enrich-ygoprodeck.mjs writes HasEffect — but
     * only ever reached the site folded into the cardType display string, where
     * nothing can filter on it.
     *
     * Only monsters have the concept, so the interesting case is what a spell
     * publishes. null, the same "does not apply" summonType uses, rather than
     * false: a trap that "has no effect" is a claim about the card, and it is
     * not one this field is making.
     */
    describe('hasEffect', () => {
        it('publishes true for an effect monster', () => {
            expect(mapRecord(monsterRecord).hasEffect).toBe(true);
        });

        it('publishes false for a normal monster', () => {
            const card = mapRecord({
                id: 'r',
                fields: { ...monsterRecord.fields, HasEffect: false }
            });

            expect(card.hasEffect).toBe(false);
        });

        // Airtable omits an unticked checkbox rather than sending false, so a
        // monster row that predates the field maps to a Normal monster — which
        // is what buildCardTypeLabel has always called it.
        it('publishes false for a monster whose checkbox is absent', () => {
            const fields = { ...monsterRecord.fields };
            delete fields.HasEffect;

            expect(mapRecord({ id: 'r', fields }).hasEffect).toBe(false);
            expect(buildCardTypeLabel(fields)).toContain('Normal');
        });

        // Same strictness as isFirstEdition: the field is a claim about the
        // card, so only a real boolean true counts.
        it('publishes false for a truthy value that is not literally true', () => {
            for (const value of ['true', 1, 'yes', {}]) {
                const card = mapRecord({
                    id: 'r',
                    fields: { ...monsterRecord.fields, HasEffect: value }
                });

                expect(card.hasEffect).toBe(false);
            }
        });

        it('publishes null for a spell, which has no such concept', () => {
            expect(mapRecord(spellRecord).hasEffect).toBeNull();
        });

        // Not just falsy: a stray HasEffect on a spell row must not publish as
        // true, or the facet would offer "Effect" for a card that has no
        // Effect/Normal distinction at all.
        it('publishes null for a spell even when HasEffect is set', () => {
            const card = mapRecord({
                id: 'r',
                fields: { ...spellRecord.fields, HasEffect: true }
            });

            expect(card.hasEffect).toBeNull();
        });

        it('is always present, so the key never goes missing from the JSON', () => {
            expect(mapRecord(monsterRecord)).toHaveProperty('hasEffect');
            expect(mapRecord(spellRecord)).toHaveProperty('hasEffect');
        });

        it('is not required, so a row without it is never dropped', () => {
            const fields = { ...monsterRecord.fields };
            delete fields.HasEffect;

            expect(missingRequiredFields({ id: 'r', fields })).toEqual([]);
            expect(mapRecord({ id: 'r', fields })).not.toBeNull();
        });

        it('is not a private field', () => {
            expect(PRIVATE_FIELDS.map(f => f.toLowerCase())).not.toContain('haseffect');
        });
    });

    it('never carries a private field through', () => {
        const card = mapRecord(monsterRecord);
        PRIVATE_FIELDS.forEach(field => {
            expect(Object.keys(card).map(k => k.toLowerCase()))
                .not.toContain(field.toLowerCase());
        });
    });

    it('returns null when a required field is missing', () => {
        expect(mapRecord({ id: 'r', fields: { Type: 'Monster', Rarity: 'Common' } })).toBeNull();
        expect(mapRecord({ id: 'r', fields: { Name: 'X', Rarity: 'Common' } })).toBeNull();
        expect(mapRecord({ id: 'r', fields: { Name: 'X', Type: 'Monster' } })).toBeNull();
    });

    it('returns null for an unrecognised type or rarity', () => {
        // "Skill Card" mirrors deriveType's own unmapped-type example in
        // enrich-ygoprodeck.mjs — Token is now a recognised Type (see below),
        // so it must not be used here as the "unmapped" example any more.
        expect(mapRecord({ id: 'r', fields: { Name: 'X', Type: 'Skill Card', Rarity: 'Common' } })).toBeNull();
        expect(mapRecord({ id: 'r', fields: { Name: 'X', Type: 'Monster', Rarity: 'Promo' } })).toBeNull();
    });

    // The owner added Token as a fourth Airtable Type option after
    // SDSA-EN047/048 (real Tokens) exposed deriveType not recognising it.
    // TYPE_MAP must stay in step with that option, or a Token row that
    // enrich-airtable.mjs now happily writes (Type: 'Token' present, so it
    // clears the required-fields guard) gets silently dropped right back out
    // here, at sync time, with no serial reported — the same "reports success,
    // card never reaches the site" failure the required-fields guard exists
    // to prevent, just moved one stage later.
    it('maps a Token record, keeping Card Type but with no combat stats', () => {
        const tokenRecord = {
            id: 'rec004',
            fields: {
                Name: 'Phantasmal Martyr Token',
                Passcode: '93224849',
                Type: 'Token',
                'Card Type': 'Fiend',
                Rarity: 'Common',
                Serial: 'SDSA-EN047'
            }
        };

        const card = mapRecord(tokenRecord);

        expect(card).toMatchObject({
            type: 'token',
            rarity: 'common',
            cardType: 'Fiend / Token',
            attribute: null,
            atk: null,
            def: null,
            level: null,
            summonType: null
        });
    });

    it('returns null for a malformed record', () => {
        [null, undefined, {}, { id: 'r' }].forEach(input => {
            expect(mapRecord(input)).toBeNull();
        });
    });

    // Colour is derived at render time from the card's own type, so publishing
    // one would be a second source of truth that could disagree with the first.
    it('publishes no colour of any kind', () => {
        ['Monster', 'Spell', 'Trap', 'Token'].forEach(type => {
            const card = mapRecord({ id: 'r', fields: { Name: 'X', Type: type, Rarity: 'Common' } });

            expect(card).not.toHaveProperty('gradient');
            expect(JSON.stringify(card)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        });
    });

    it('maps every published type to a frame the renderer can colour', () => {
        ['Monster', 'Spell', 'Trap', 'Token'].forEach(type => {
            const card = mapRecord({ id: 'r', fields: { Name: 'X', Type: type, Rarity: 'Common' } });
            expect(cardFrame(card)).not.toBeNull();
        });
    });
});

describe('mapRecords', () => {
    it('maps a set and counts the skipped records', () => {
        const result = mapRecords([monsterRecord, { id: 'bad', fields: { Name: 'X' } }, spellRecord]);
        expect(result.cards).toHaveLength(2);
        expect(result.skipped).toBe(1);
    });

    // The collection is keyed by printing, not by card. Two rows sharing a
    // passcode with different serials are two things the owner physically has.
    it('keeps both printings of the same card rather than deduplicating', () => {
        const second = { ...monsterRecord, id: 'rec003', fields: { ...monsterRecord.fields, Serial: 'SD6-EN005' } };
        const result = mapRecords([monsterRecord, second]);

        expect(result.cards).toHaveLength(2);
        expect(result.cards.map(c => c.serial)).toEqual(['SDJ-017', 'SD6-EN005']);
        expect(new Set(result.cards.map(c => c.passcode)).size).toBe(1);
    });

    it('throws when given something other than an array', () => {
        expect(() => mapRecords(null)).toThrow(/must be an array/);
    });

    // A count alone says a card vanished from the site without saying which,
    // which is what made a failed pipeline run read as "the pipeline missed a
    // row". The dropped list is what the failure message names.
    it('reports which rows were dropped and why', () => {
        const unresolved = { id: 'rec404', fields: { Serial: 'DBJ-EN056 ' } };
        const result = mapRecords([monsterRecord, unresolved]);

        expect(result.skipped).toBe(1);
        expect(result.dropped).toEqual([
            { id: 'rec404', serial: 'DBJ-EN056', missing: ['Name', 'Type', 'Rarity'] }
        ]);
    });

    it('names only the fields a dropped row is actually missing', () => {
        const noRarity = {
            id: 'rec005',
            fields: { ...monsterRecord.fields, Rarity: 'Not A Rarity' }
        };

        expect(mapRecords([noRarity]).dropped[0].missing).toEqual(['Rarity']);
    });

    it('reports an empty dropped list when every row maps', () => {
        expect(mapRecords([monsterRecord, spellRecord]).dropped).toEqual([]);
    });

    it('handles a record with no fields at all', () => {
        const result = mapRecords([{ id: 'recEmpty' }]);

        expect(result.cards).toEqual([]);
        expect(result.dropped).toEqual([
            { id: 'recEmpty', serial: '', missing: ['Name', 'Type', 'Rarity'] }
        ]);
    });

    // Airtable's UI creates a stray record with an empty fields object
    // whenever "+" is clicked without typing anything. It is not a real
    // card missing required fields, so it must not appear in dropped.
    it('excludes a fully blank row (no Serial, no Name) from dropped', () => {
        const blank = { id: 'recBlank', fields: {} };
        const result = mapRecords([monsterRecord, blank]);

        expect(result.cards).toHaveLength(1);
        expect(result.dropped).toEqual([]);
    });

    // A blank Serial with a Name already typed is a row someone started
    // filling in, not a stray blank one — must still be reported as dropped.
    it('still drops a row with a real Name but blank Serial', () => {
        const partial = { id: 'recPartial', fields: { Name: 'Dark Magician' } };
        const result = mapRecords([partial]);

        expect(result.dropped).toEqual([
            { id: 'recPartial', serial: '', missing: ['Type', 'Rarity'] }
        ]);
    });

    // Regression: a row with real data that fails required-field validation
    // for an unrelated reason (bad Rarity) must still be reported.
    it('still drops a row with a real Serial that fails required-field validation', () => {
        const badRarity = {
            id: 'recBadRarity',
            fields: { ...monsterRecord.fields, Rarity: 'Not A Rarity' }
        };
        const result = mapRecords([badRarity]);

        expect(result.dropped).toEqual([
            { id: 'recBadRarity', serial: 'SDJ-017', missing: ['Rarity'] }
        ]);
    });

    // Whitespace-only Serial and Name must count as blank too.
    it('treats a whitespace-only Serial and Name as a blank row', () => {
        const whitespace = { id: 'recWhitespace', fields: { Serial: '   ', Name: '  ' } };
        const result = mapRecords([whitespace]);

        expect(result.dropped).toEqual([]);
    });
});

describe('missingRequiredFields', () => {
    it('returns nothing for a mappable record', () => {
        expect(missingRequiredFields(monsterRecord)).toEqual([]);
    });

    it('is the single definition mapRecord drops on', () => {
        // If these two ever disagree, the pipeline reports a cause for a row
        // it did in fact publish, or publishes a row it reported as missing.
        const records = [
            monsterRecord,
            spellRecord,
            { id: 'bad', fields: { Name: 'X' } },
            { id: 'empty' }
        ];

        for (const record of records) {
            expect(mapRecord(record) === null).toBe(missingRequiredFields(record).length > 0);
        }
    });
});

describe('assertNoPrivateFields', () => {
    it('passes for correctly mapped cards', () => {
        expect(() => assertNoPrivateFields([mapRecord(monsterRecord)])).not.toThrow();
    });

    it('throws if an inventory field ever leaks into the output', () => {
        expect(() => assertNoPrivateFields([{ name: 'X', Quantity: 3 }]))
            .toThrow(/must not be published/);
        expect(() => assertNoPrivateFields([{ name: 'X', condition: 'Near Mint' }]))
            .toThrow(/must not be published/);
    });
});

describe('rarity vocabulary stays in step', () => {
    // Three places define rarity: the Airtable options, RARITY_ORDER, and
    // RARITY_LABELS. Drift between them makes cards vanish under a filter.
    const airtableRarities = [
        'common', 'short_print', 'super_short_print', 'rare', 'super', 'ultra',
        'secret', 'ultimate', 'collector', 'ghost', 'prismatic', 'starlight',
        'quarter_century'
    ];

    it('RARITY_ORDER covers every rarity the sync can emit', () => {
        airtableRarities.forEach(rarity => {
            expect(RARITY_ORDER).toContain(rarity);
        });
    });

    it('every ordered rarity has a display label', () => {
        RARITY_ORDER.forEach(rarity => {
            expect(RARITY_LABELS[rarity]).toBeTruthy();
        });
    });

    it('keeps common and short print below "rare or better"', () => {
        expect(RARITY_ORDER[0]).toBe('common');
        expect(RARITY_ORDER.indexOf('short_print')).toBeLessThan(RARITY_ORDER.indexOf('rare'));
        expect(RARITY_ORDER.indexOf('super_short_print')).toBeLessThan(RARITY_ORDER.indexOf('rare'));
    });

    // Regression: an Airtable select option added after the fact (a new
    // Rarity value that passes enrich-airtable.mjs's live-options check) must
    // still map here, or the row silently vanishes from data/cards.json even
    // though enrich reported it clean. Caught 2026-09-04 when "Quarter Century
    // Secret Rare" and "Super Short Print" were added in Airtable but not to
    // this file's own RARITY_MAP.
    it('maps every current Airtable Rarity option to a card, not null', () => {
        const rarityDisplayValues = [
            'Common', 'Short Print', 'Super Short Print', 'Rare', 'Super Rare',
            'Ultra Rare', 'Secret Rare', 'Ultimate Rare', "Collector's Rare",
            'Ghost Rare', 'Prismatic Secret Rare', 'Starlight Rare',
            'Quarter Century Secret Rare'
        ];

        for (const Rarity of rarityDisplayValues) {
            const card = mapRecord({ id: 'r', fields: { Name: 'X', Type: 'Monster', Rarity } });
            expect(card, `Rarity "${Rarity}" was dropped instead of mapped`).not.toBeNull();
            expect(RARITY_ORDER).toContain(card.rarity);
        }
    });
});
