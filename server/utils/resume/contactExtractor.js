/* Detects contact signals from RAW resume text (case preserved for URLs). */
export function extractContact(rawText = '') {
  const raw = String(rawText || '');
  const detected = {
    email: /[\w.+-]+@[\w-]+\.[\w.-]+/.test(raw),
    phone: /(\+?\d[\d\s().-]{7,}\d)/.test(raw),
    linkedin: /linkedin\.com\/[\w/-]+/i.test(raw) || /\blinkedin\b/i.test(raw),
    githubOrPortfolio: /github\.com\/[\w-]+/i.test(raw) || /\b(portfolio|behance|dribbble|gitlab\.com|vercel\.app|netlify\.app)\b/i.test(raw),
    location: /\b(remote|bengaluru|bangalore|pune|mumbai|delhi|hyderabad|chennai|kolkata|noida|gurgaon|gurugram|nashik|maharashtra|india|usa|uk|[a-z]+,\s*[a-z]{2,})\b/i.test(raw),
  };
  return detected;
}

export default { extractContact };
