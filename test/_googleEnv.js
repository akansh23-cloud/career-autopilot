// Imported FIRST (before ./helpers.js) so these env vars are set before
// server.js reads them at module-load time. Lets us assert that /auth/me
// reports Google as enabled when the OAuth env is present.
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:3000/auth/google/callback';
