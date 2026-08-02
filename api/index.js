/* Vercel serverless entrypoint.
 *
 * WHY THIS FILE EXISTS
 * vercel.json previously used the legacy `builds` array. That format works, but
 * it is mutually exclusive with the `functions` property — so there was no way
 * to raise `maxDuration` above the platform default. Proof verification makes
 * several outbound calls per run and was liable to be killed mid-flight, which
 * the student would see as an unexplained failure.
 *
 * The modern config needs the function to live under /api, so this module just
 * re-exports the Express app. All the real code stays in server.js, which still
 * runs standalone via `npm start` for local dev and any long-running host.
 */
export { default } from '../server.js';
