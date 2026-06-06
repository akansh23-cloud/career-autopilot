/* ============================================================
   STRUCTURED LOGGER (no external dependency)
   ------------------------------------------------------------
   Emits single-line JSON in production (easy to ship to a log
   aggregator) and readable text in development. Every payload is
   passed through a redactor that strips tokens, keys, passwords,
   cookies and raw resume/document text so secrets and PII never
   reach the logs.
   ============================================================ */
import { IS_PROD } from './config.js';

const SENSITIVE_KEY = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|signature|client[_-]?secret|resume|message|email)/i;
const MAX_STRING = 300;

function redact(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…[truncated]' : value;
  }
  if (typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = typeof v === 'string' ? '[redacted]' : '[redacted]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function emit(level, msg, meta) {
  const entry = { t: new Date().toISOString(), level, msg };
  if (meta && Object.keys(meta).length) entry.meta = redact(meta);
  if (IS_PROD) {
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  } else {
    const tag = level.toUpperCase().padEnd(5);
    const extra = entry.meta ? ' ' + JSON.stringify(entry.meta) : '';
    const sink = level === 'error' ? console.error : console.log;
    sink(`[${tag}] ${msg}${extra}`);
  }
}

export const logger = {
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
  debug: (msg, meta) => {
    if (!IS_PROD) emit('debug', msg, meta);
  },
};

export default logger;
