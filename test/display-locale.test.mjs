import assert from 'node:assert/strict';
import {formatDisplayDate,displayDateFormatter} from '../src/lib/displayLocale.js';
assert.equal(formatDisplayDate(new Date('2026-09-25T12:30:00Z'),{timeZone:'UTC'}),'25-09-2026');
assert.equal(displayDateFormatter({dateStyle:'short',timeStyle:'short',timeZone:'UTC'}).format(new Date('2026-09-25T12:30:00Z')),'25-09-2026, 12:30');
assert.equal(formatDisplayDate(new Date('2026-09-25T12:30:00Z'),{weekday:'long',timeZone:'UTC'}),'venerdì');
assert.equal(formatDisplayDate('invalid'),'—');
assert.equal((1234.56).toLocaleString('it-IT',{useGrouping:"always",minimumFractionDigits:2,maximumFractionDigits:2}),'1.234,56');
console.log('Italian date and number display: PASS');

