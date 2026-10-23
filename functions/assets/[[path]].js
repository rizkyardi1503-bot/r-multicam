import { serveWithRanges } from '../_range.js';
// GET only: HEAD keeps the default static handling.
export const onRequestGet = serveWithRanges;
