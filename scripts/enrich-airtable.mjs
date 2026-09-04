#!/usr/bin/env node
/**
 * Write YGOPRODeck enrichment back to Airtable.
 *
 * For every row not yet marked IsProcessed, resolves its Serial against
 * YGOPRODeck, builds the machine-owned field payload, validates it against
 * the base's live single-select options, and PATCHes passing rows back in
 * batches of 10 (Airtable's per-request limit) with IsProcessed: true set so
 * a row is never enriched twice.
 *
 * A bad row (unknown serial, an unmapped select option) is logged and
 * skipped rather than aborting the run — one bad row must not block the
 * rest of the batch. The script still exits non-zero when that happens, so
 * CI surfaces the problem instead of it going unnoticed.
 *
 * Usage:
 *   node scripts/enrich-airtable.mjs --dry-run   # prints what would be sent, sends nothing
 *   node scripts/enrich-airtable.mjs             # LIVE WRITE — real PATCH requests to Airtable
 */

import { pathToFileURL } from 'node:url';
import { fetchAllRecords } from './sync-airtable.mjs';
import { writeReport, ENRICH_REPORT } from './pipeline-report.mjs';
import { resolveSerial } from './ygoprodeck-client.mjs';
import {
    buildEnrichedFields,
    assertNoHumanOwnedFields,
    validateSelectOptions,
    describeProblem,
    findMissingRequiredFields,
    describeMissingFields
} from './enrich-ygoprodeck.mjs';

/** Airtable's per-request limit for record PATCH/POST bodies. */
const PATCH_BATCH_SIZE = 10;

/**
 * Fallback base/table so this can be run locally against the owner's real
 * base without adding AIRTABLE_BASE_ID/AIRTABLE_TABLE_ID to .env — CI still
 * supplies its own via GitHub Secrets and those take priority.
 */
const DEFAULT_BASE_ID = 'appjNtbcGFFAu0FIn';
const DEFAULT_TABLE_ID = 'tblsz5RrZGC7BnesJ';

/**
 * Read an environment variable, falling back to a default when supplied.
 * Exits with a clear message when neither is available.
 *
 * @param {string} name - variable name
 * @param {string} [fallback] - value to use when the variable is unset
 * @returns {string} the resolved value
 */
function requireEnv(name, fallback) {
    const value = process.env[name] ?? fallback;
    if (!value) {
        console.error(`Missing required environment variable: ${name}`);
        process.exit(1);
    }
    return value;
}

/**
 * Whether a record still needs enrichment.
 *
 * IsProcessed is treated as a strict flag: anything other than literal
 * `true` (unset, false, or any other value) counts as unprocessed, so a
 * malformed value cannot silently hide a row from enrichment.
 *
 * @param {{fields: object}} record - an Airtable record
 * @returns {boolean} true when the row has not been enriched yet
 */
export function isUnprocessed(record) {
    return record?.fields?.IsProcessed !== true;
}

/**
 * Fetch the table's live single-select options from Airtable's metadata API.
 *
 * Options must come from the base rather than be hardcoded, since the owner
 * adds new options over time (e.g. a new Card Type race) and a hardcoded
 * list would silently drift out of date and reject valid values.
 *
 * @param {string} baseId - Airtable base id
 * @param {string} tableId - Airtable table id
 * @param {string} token - Airtable personal access token
 * @param {typeof fetch} [fetchImpl] - injectable fetch, used by tests
 * @returns {Promise<Record<string, string[]>>} field name to its allowed option names
 */
export async function fetchSelectOptions(baseId, tableId, token, fetchImpl = globalThis.fetch) {
    const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
            `Airtable metadata request failed: ${response.status} ${response.statusText}. ${body.slice(0, 200)}`
        );
    }

    const payload = await response.json();
    const table = (payload.tables ?? []).find(t => t.id === tableId);
    if (!table) {
        throw new Error(`Table ${tableId} not found in base ${baseId} metadata`);
    }

    const options = {};
    for (const field of table.fields ?? []) {
        if (field.type === 'singleSelect' && field.options?.choices) {
            options[field.name] = field.options.choices.map(choice => choice.name);
        }
    }
    return options;
}

/**
 * Resolve, build and validate the enriched payload for every unprocessed
 * record, without sending anything to Airtable.
 *
 * Kept separate from the network send so it is fully unit testable: inject a
 * fake resolveSerialImpl to avoid hitting YGOPRODeck, and pass a plain
 * selectOptions object to avoid hitting Airtable's metadata endpoint.
 *
 * @param {{id: string, fields: object}[]} records - all Airtable records
 * @param {object} deps
 * @param {(serial: string) => Promise<object>} deps.resolveSerialImpl - resolves one serial
 * @param {Record<string, string[]>} deps.selectOptions - live single-select options
 * @returns {Promise<{
 *   rows: {id: string, fields: object}[],
 *   skipped: {serial: string, reason: string}[],
 *   blocked: {serial: string, problems: object[]}[]
 * }>}
 */
/**
 * Clean a Serial value read from Airtable.
 *
 * The field is multilineText, so a pasted value can carry a trailing newline
 * or stray spaces that look invisible in the Airtable UI but break the lookup.
 *
 * @param {unknown} serial - the raw Serial field value
 * @returns {string} the trimmed serial, or an empty string when absent
 */
export function normaliseSerial(serial) {
    if (serial === null || serial === undefined) return '';
    return String(serial).trim();
}

/**
 * Whether a record has a real Name typed, ignoring whitespace-only values.
 *
 * @param {object} [fields] - raw Airtable fields
 * @returns {boolean} true when Name is a non-blank string
 */
function hasName(fields) {
    return typeof fields?.Name === 'string' && fields.Name.trim() !== '';
}

export async function collectEnrichedRows(records, { resolveSerialImpl, selectOptions }) {
    const rows = [];
    const skipped = [];
    const blocked = [];

    for (const record of records.filter(isUnprocessed)) {
        // Serial is a multilineText field in Airtable, so it happily keeps a
        // trailing newline from a paste. Untrimmed, that gets URL-encoded as
        // %0A and the lookup fails on a serial that looks correct in the UI.
        const serial = normaliseSerial(record.fields?.Serial);

        if (serial === '') {
            // A fully blank row (no Serial AND no Name) is the stray row
            // Airtable's UI creates whenever "+" is clicked without typing
            // anything. There is nothing to look up and nothing to report —
            // it is not a row at all, so it must not fail the run. A row
            // with a Name but no Serial yet is a real "needs attention"
            // case and stays fatal.
            if (!hasName(record.fields)) {
                console.log(`Ignoring blank row ${record.id}: no Serial and no Name typed.`);
                continue;
            }
            skipped.push({ id: record.id, serial: '', reason: 'Row has no Serial, so there is nothing to look up' });
            continue;
        }

        const resolved = await resolveSerialImpl(serial);
        if (!resolved.ok) {
            skipped.push({ serial, reason: resolved.reason });
            continue;
        }

        const fields = buildEnrichedFields(resolved.setInfo, resolved.cardInfo);

        // Hard safety invariant, not a per-row skip: buildEnrichedFields must
        // never emit a human-owned field. A throw here means something is
        // structurally wrong and the whole run should stop, not just this row.
        assertNoHumanOwnedFields(fields);

        // A card type deriveType cannot map (e.g. an unreleased "Skill Card")
        // leaves Type undefined rather than guessed. That must block the row,
        // not write it half-empty — a half-empty row still gets IsProcessed:
        // true and is then silently dropped by sync-airtable.mjs's own
        // "missing Name, Type or Rarity" filter, so the real card never
        // reaches the site and the run reports success.
        const missingFields = findMissingRequiredFields(fields);
        if (missingFields.length > 0) {
            const rawType = resolved.cardInfo?.type;
            console.log(describeMissingFields(serial, missingFields, rawType));
            blocked.push({
                serial,
                problems: missingFields.map(field => ({ field, value: fields[field] ?? null, rawType }))
            });
            continue;
        }

        const validation = validateSelectOptions(fields, selectOptions);
        if (!validation.ok) {
            for (const problem of validation.problems) {
                console.log(describeProblem(serial, problem));
            }
            blocked.push({ serial, problems: validation.problems });
            continue;
        }

        rows.push({ id: record.id, fields: { ...fields, IsProcessed: true } });
    }

    return { rows, skipped, blocked };
}

/**
 * Chunk passing rows into Airtable PATCH batches.
 *
 * Airtable rejects a PATCH body with more than 10 records, so a larger write
 * must be split into sequential requests.
 *
 * @param {{id: string, fields: object}[]} rows - rows ready to write
 * @param {number} [batchSize] - records per batch, default Airtable's limit of 10
 * @returns {{id: string, fields: object}[][]} rows chunked into batches
 */
export function buildPatchBatches(rows, batchSize = PATCH_BATCH_SIZE) {
    const batches = [];
    for (let i = 0; i < rows.length; i += batchSize) {
        batches.push(rows.slice(i, i + batchSize));
    }
    return batches;
}

/**
 * Send one PATCH batch to Airtable.
 *
 * The only function in this file that performs a live write. Never called
 * when --dry-run is set.
 *
 * @param {string} baseId - Airtable base id
 * @param {string} tableId - Airtable table id
 * @param {string} token - Airtable personal access token
 * @param {{id: string, fields: object}[]} batch - up to 10 records to write
 * @param {typeof fetch} fetchImpl - fetch implementation
 * @returns {Promise<void>}
 */
async function sendBatch(baseId, tableId, token, batch, fetchImpl) {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}`;
    const response = await fetchImpl(url, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records: batch })
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
            `Airtable PATCH failed: ${response.status} ${response.statusText}. ${body.slice(0, 200)}`
        );
    }
}

/**
 * Read `--limit N` from the command line.
 *
 * Enriching a small subset first is the safe way to try a change against real
 * data: the untouched rows stay unprocessed and get picked up on the next run.
 *
 * @param {string[]} argv - process.argv
 * @returns {number|null} the limit, or null for "no limit"
 */
export function parseLimit(argv) {
    const index = argv.indexOf('--limit');
    if (index === -1) return null;

    const value = Number.parseInt(argv[index + 1], 10);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error('--limit needs a positive whole number, e.g. --limit 3');
    }

    return value;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const limit = parseLimit(process.argv);

    const token = requireEnv('AIRTABLE_TOKEN');
    const baseId = requireEnv('AIRTABLE_BASE_ID', DEFAULT_BASE_ID);
    const tableId = requireEnv('AIRTABLE_TABLE_ID', DEFAULT_TABLE_ID);

    console.log(`Fetching records from base ${baseId}, table ${tableId}…`);
    const allRecords = await fetchAllRecords(baseId, tableId, token);
    const unprocessedCount = allRecords.filter(isUnprocessed).length;
    console.log(`Fetched ${allRecords.length} record(s), ${unprocessedCount} unprocessed.`);

    // Trim to the first N unprocessed rows, keeping table order so "the first
    // three" means the same thing here as it does in the Airtable view.
    let records = allRecords;
    if (limit !== null) {
        const selected = allRecords.filter(isUnprocessed).slice(0, limit);
        records = selected;
        console.log(`--limit ${limit}: processing ${selected.length} row(s), leaving the rest unprocessed.`);
    }

    console.log('Fetching live single-select options…');
    const selectOptions = await fetchSelectOptions(baseId, tableId, token);

    const { rows, skipped, blocked } = await collectEnrichedRows(records, {
        resolveSerialImpl: serial => resolveSerial(serial),
        selectOptions
    });

    for (const { serial, reason } of skipped) {
        console.log(`Skipped ${serial}: ${reason}`);
    }

    const batches = buildPatchBatches(rows);

    if (dryRun) {
        console.log(
            `--dry-run: would send ${batches.length} batch(es) covering ${rows.length} row(s). Sending nothing.`
        );
        batches.forEach((batch, i) => {
            console.log(`Batch ${i + 1}/${batches.length}:`);
            console.log(JSON.stringify({ records: batch }, null, 2));
        });
    } else {
        for (const [i, batch] of batches.entries()) {
            console.log(`Sending batch ${i + 1}/${batches.length} (${batch.length} record(s))…`);
            await sendBatch(baseId, tableId, token, batch, globalThis.fetch);
        }
    }

    console.log(`Summary: enriched ${rows.length}, skipped ${skipped.length}, blocked ${blocked.length}.`);

    // The log above is for a human reading the step; this is for the reporting
    // step, which has to tell a blocked row from a skipped one and name the
    // serials involved. Parsing the log text back out would be guesswork.
    writeReport(ENRICH_REPORT, { enriched: rows.length, skipped, blocked });

    // Non-zero on any skip or block, even in --dry-run, so CI (or the owner)
    // sees that the run was not fully clean.
    if (skipped.length > 0 || blocked.length > 0) {
        process.exitCode = 1;
    }
}

// Only run when executed directly (`node scripts/enrich-airtable.mjs`), never
// on import — same guard as sync-airtable.mjs, using pathToFileURL so
// Windows drive letters and slash direction resolve correctly.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
    main().catch(error => {
        console.error(`Enrichment failed: ${error.message}`);
        process.exit(1);
    });
}
