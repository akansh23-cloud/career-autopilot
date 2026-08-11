/* ============================================================
   REAL DOCX WRITER — Resume OS V4
   ------------------------------------------------------------
   Generates a genuine .docx (OOXML / WordprocessingML) package
   from a canonical ResumeDocument — not HTML with a .doc label.
   Structure produced:
     [Content_Types].xml, _rels/.rels,
     word/document.xml, word/styles.xml, word/numbering.xml,
     word/_rels/document.xml.rels
   Output opens and edits cleanly in Word / LibreOffice / Google
   Docs. Deterministic: same document + template → same bytes
   (jszip with fixed date). Section order, enabled flags and
   variant overrides are honored via toRendererStructured.
   ============================================================ */
import JSZip from 'jszip';
import { normalizeResumeDocument, toRendererStructured } from './resume/resumeDocument.js';

export const DOCX_WRITER_VERSION = 'docx-writer-v1';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // strip control chars that make OOXML invalid
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/* twips helpers: 1pt = 20 twips */
const pt = (n) => Math.round(n * 2); // half-points for w:sz
const HEX = (c, fallback) => {
  const m = String(c || '').match(/^#?([0-9a-f]{6})$/i);
  return m ? m[1].toUpperCase() : fallback;
};

function run(text, { bold = false, italic = false, color = '', size = 21, caps = false } = {}) {
  return `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${caps ? '<w:caps/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(runs, { style = '', spacingAfter = 60, spacingBefore = 0, numId = 0, border = false, borderColor = '444444' } = {}) {
  const pPr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` : '',
    border ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${borderColor}"/></w:pBdr>` : '',
    `<w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="264" w:lineRule="auto"/>`,
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;
}

function headingPara(text, accent) {
  return para(run(text, { bold: true, caps: true, color: accent, size: pt(10.5) }), { spacingBefore: 160, spacingAfter: 70, border: true, borderColor: accent });
}

export function buildResumeDocxParts(doc, template = null) {
  const d = normalizeResumeDocument(doc);
  const s = toRendererStructured(d);
  const accent = HEX(template?.theme?.accent, '1F2937');
  const body = [];

  /* ---- header ---- */
  if (s.personalInfo.name) body.push(para(run(s.personalInfo.name, { bold: true, size: pt(17) }), { spacingAfter: 20 }));
  if (s.personalInfo.title) body.push(para(run(s.personalInfo.title, { color: accent, size: pt(10.5) }), { spacingAfter: 40 }));
  const contactBits = [s.personalInfo.email, s.personalInfo.phone, s.personalInfo.location, s.personalInfo.linkedin, s.personalInfo.github, s.personalInfo.portfolio].filter(Boolean);
  if (contactBits.length) body.push(para(run(contactBits.join('  |  '), { size: pt(9), color: '555555' }), { spacingAfter: 120 }));

  const sectionOrder = d.sectionOrder && d.sectionOrder.length ? d.sectionOrder : ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'];
  const label = (k) => (template?.theme?.sectionTitles?.[k]) || ({
    summary: 'Summary', skills: 'Skills', experience: template?.theme?.experienceTitle || 'Experience',
    projects: 'Projects', education: 'Education', certifications: 'Certifications', achievements: 'Achievements',
  }[k] || k);

  for (const key of sectionOrder) {
    if (key === 'summary' && s.summary) {
      body.push(headingPara(label('summary'), accent));
      body.push(para(run(s.summary, { size: pt(10) }), { spacingAfter: 80 }));
    }
    if (key === 'skills' && s.skills?.length) {
      body.push(headingPara(label('skills'), accent));
      const groups = new Map();
      for (const g of s.skills) groups.set(g.group || 'Other', g.items || []);
      for (const [g, items] of groups) {
        if (!items.length) continue;
        body.push(para(run(`${g}: `, { bold: true, size: pt(9.5) }) + run(items.join(', '), { size: pt(9.5) }), { spacingAfter: 30 }));
      }
    }
    if (key === 'experience' && s.experience?.length) {
      body.push(headingPara(label('experience'), accent));
      for (const e of s.experience) {
        body.push(para(
          run(e.role || '', { bold: true, size: pt(10.5) }) + run(e.company ? `  —  ${e.company}` : '', { size: pt(10.5) }) + run(e.dates ? `   ${e.dates}` : '', { size: pt(9), color: '555555' }),
          { spacingBefore: 60, spacingAfter: 30 },
        ));
        for (const b of e.bullets || []) body.push(para(run(b, { size: pt(10) }), { numId: 1, spacingAfter: 20 }));
      }
    }
    if (key === 'projects' && s.projects?.length) {
      body.push(headingPara(label('projects'), accent));
      for (const p of s.projects) {
        body.push(para(
          run(p.name || '', { bold: true, size: pt(10.5) }) + run(p.tech ? `   ${p.tech}` : '', { size: pt(9), color: '555555' }) + run(p.link ? `   ${p.link}` : '', { size: pt(9), color: accent }),
          { spacingBefore: 50, spacingAfter: 30 },
        ));
        for (const b of p.bullets || []) body.push(para(run(b, { size: pt(10) }), { numId: 1, spacingAfter: 20 }));
      }
    }
    if (key === 'education' && s.education?.length) {
      body.push(headingPara(label('education'), accent));
      for (const e of s.education) {
        body.push(para(
          run(e.school || '', { bold: true, size: pt(10) }) + run(e.degree ? `  —  ${e.degree}` : '', { size: pt(10) }) + run(e.dates ? `   ${e.dates}` : '', { size: pt(9), color: '555555' }),
          { spacingAfter: 30 },
        ));
      }
    }
    if (key === 'certifications' && s.certifications?.length) {
      body.push(headingPara(label('certifications'), accent));
      for (const c of s.certifications) body.push(para(run(c, { size: pt(10) }), { numId: 1, spacingAfter: 20 }));
    }
    if (key === 'achievements' && s.achievements?.length) {
      body.push(headingPara(label('achievements'), accent));
      for (const a of s.achievements) body.push(para(run(a, { size: pt(10) }), { numId: 1, spacingAfter: 20 }));
    }
  }

  const pageSize = d.pageSize === 'letter'
    ? '<w:pgSz w:w="12240" w:h="15840"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join('')}
<w:sectPr>${pageSize}<w:pgMar w:top="720" w:right="820" w:bottom="720" w:left="820" w:header="360" w:footer="360"/></w:sectPr>
</w:body></w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
<w:pPr><w:ind w:left="340" w:hanging="180"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

  return { documentXml, stylesXml, numberingXml, contentTypes, rootRels, docRels };
}

export async function renderResumeDocx(doc, template = null) {
  const parts = buildResumeDocxParts(doc, template);
  const zip = new JSZip();
  const FIXED = new Date('2026-01-01T00:00:00Z'); // deterministic archive
  const add = (path, content) => zip.file(path, content, { date: FIXED });
  add('[Content_Types].xml', parts.contentTypes);
  add('_rels/.rels', parts.rootRels);
  add('word/document.xml', parts.documentXml);
  add('word/styles.xml', parts.stylesXml);
  add('word/numbering.xml', parts.numberingXml);
  add('word/_rels/document.xml.rels', parts.docRels);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export default { DOCX_WRITER_VERSION, renderResumeDocx, buildResumeDocxParts };
