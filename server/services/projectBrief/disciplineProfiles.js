/* ============================================================
   Discipline profiles — deterministic.
   ------------------------------------------------------------
   The Guided Build Kit, the starter pack and convertToProject all
   assumed one shape of project: a MERN web app. Every generated
   plan therefore said "npm run dev", "frontend screens", "backend
   APIs", "database schema" — including for an agriculture sensor
   rig, a defence hardware idea, or a lab process.

   This module classifies a project into a DISCIPLINE and supplies
   the vocabulary that discipline actually uses: what a "module" is,
   what the build steps look like, what counts as proof, what the
   first week is, and what "run it" means. Everything downstream
   reads from here instead of hard-coding npm.

   Purely deterministic — same project in, same discipline out.
   No AI, no network. AI (see projectBriefService) only writes the
   PROSE on top of this skeleton.
   ============================================================ */

const lc = (s) => String(s || '').toLowerCase();

/* ---------------- discipline definitions ---------------- */

export const DISCIPLINES = {
  software: {
    id: 'software',
    label: 'Software / web application',
    buildUnit: 'module',
    workspaceTabs: ['Screens', 'APIs', 'Data model', 'Tests', 'Deployment'],
    toolchain: ['A code editor (VS Code)', 'Git + GitHub', 'Node.js or your language runtime', 'A free hosting tier'],
    runMeans: 'the app boots locally and you can click through the core flow in a browser',
    firstWeek: [
      'Get a skeleton running end-to-end with fake data — deploy it on day one, even empty',
      'Build the single most important screen and the one API it calls',
      'Store one real record and read it back',
      'Write the README problem statement before you write more features',
    ],
    proofArtifacts: ['Public GitHub repo with real commit history', 'Live deployed URL', 'Short screen-recorded walkthrough', 'README with architecture diagram and results'],
    validation: 'Automated tests plus a demo where someone who has never seen it completes the core task unaided.',
    costNote: 'Mostly free tiers; budget for a domain and possibly a small managed database.',
  },

  hardware: {
    id: 'hardware',
    label: 'Hardware / embedded / IoT',
    buildUnit: 'subsystem',
    workspaceTabs: ['Bill of materials', 'Circuit / wiring', 'Firmware', 'Enclosure', 'Bench tests'],
    toolchain: ['Breadboard + jumper set', 'Microcontroller dev board', 'Multimeter', 'Soldering iron', 'Firmware IDE (PlatformIO / Arduino / STM32Cube)'],
    runMeans: 'the rig powers up on the bench and produces a correct reading you can measure against a known reference',
    firstWeek: [
      'Write the bill of materials with real supplier links and prices before ordering anything',
      'Get ONE sensor reading onto a serial monitor — nothing else',
      'Log ten minutes of readings to a file and plot them',
      'Compare your readings against a trusted reference instrument and record the error',
    ],
    proofArtifacts: ['Bench photos and a video of the rig running', 'Logged sensor data with a reference comparison', 'Schematic / wiring diagram', 'Firmware repo', 'Calibration table'],
    validation: 'Repeatability: run the same measurement 10 times and report mean and spread against a reference instrument.',
    costNote: 'Component cost is real and non-refundable — price the BOM before committing, and buy two of anything fragile.',
  },

  data_ml: {
    id: 'data_ml',
    label: 'Data / machine learning',
    buildUnit: 'pipeline stage',
    workspaceTabs: ['Dataset', 'Features', 'Model', 'Evaluation', 'Serving'],
    toolchain: ['Python + notebooks', 'pandas / polars', 'scikit-learn or PyTorch', 'A versioned dataset store', 'An experiment log (even a spreadsheet)'],
    runMeans: 'the notebook reproduces your headline metric end-to-end from the raw dataset',
    firstWeek: [
      'Find and licence-check a real dataset before designing anything',
      'Establish a dumb baseline (majority class / linear model) and write down its score',
      'Build the train/validation split and freeze the test set — do not look at it again',
      'Get one honest metric on the validation set and record it',
    ],
    proofArtifacts: ['Reproducible notebook or training script', 'Dataset card with licence and provenance', 'Metric table vs baseline', 'Error analysis of the 20 worst predictions', 'Model card noting known failure modes'],
    validation: 'Beat a stated baseline on a held-out test set you touched exactly once, and report the confidence interval.',
    costNote: 'Compute is the cost line — a free Colab tier goes far; price GPU hours before promising a large model.',
  },

  mechanical: {
    id: 'mechanical',
    label: 'Mechanical / manufacturing',
    buildUnit: 'assembly',
    workspaceTabs: ['Requirements', 'CAD model', 'Analysis', 'Fabrication', 'Test rig'],
    toolchain: ['CAD (Fusion 360 / SolidWorks / FreeCAD)', 'FEA or a hand-calculation sheet', '3D printer or workshop access', 'Calipers and basic metrology'],
    runMeans: 'a physical prototype exists and survives the load or motion it was designed for',
    firstWeek: [
      'Write the requirement sheet: loads, tolerances, materials, operating range — numbers, not adjectives',
      'Sketch three concepts and pick one with a written justification',
      'Build the CAD model of the single critical part only',
      'Hand-calculate the governing stress or motion before trusting any simulation',
    ],
    proofArtifacts: ['CAD files and drawings with tolerances', 'Hand calculations plus FEA screenshots', 'Photos of the fabricated prototype', 'Test-rig results against the requirement sheet', 'Failure analysis if it broke'],
    validation: 'Physical test against the numbers in the requirement sheet — measured, not simulated.',
    costNote: 'Material and machining dominate; prototype in the cheapest material that still fails the same way.',
  },

  bio_chem: {
    id: 'bio_chem',
    label: 'Biotech / chemistry / lab process',
    buildUnit: 'protocol step',
    workspaceTabs: ['Hypothesis', 'Protocol', 'Controls', 'Results', 'Safety'],
    toolchain: ['Lab notebook (bound or electronic)', 'Institutional lab access and supervisor sign-off', 'Reagent and consumable list', 'A statistics tool for the analysis'],
    runMeans: 'the protocol runs to completion with its controls behaving as expected',
    firstWeek: [
      'Write the hypothesis as a testable statement with a measurable outcome',
      'Get supervisor and safety approval in writing before touching a reagent',
      'Write the full protocol including positive and negative controls',
      'Do one dry run with water or a blank to shake out procedural mistakes cheaply',
    ],
    proofArtifacts: ['Signed lab notebook pages', 'Protocol document with version history', 'Raw data plus the analysis script', 'Control results shown alongside experimental results', 'Safety / ethics approval reference'],
    validation: 'Replicate the result at least three times with controls, and report variance — a single run proves nothing.',
    costNote: 'Reagents and consumables are the budget; confirm institutional supply before designing around anything exotic.',
  },

  civil_infra: {
    id: 'civil_infra',
    label: 'Civil / infrastructure / built environment',
    buildUnit: 'work package',
    workspaceTabs: ['Site data', 'Design', 'Codes & compliance', 'Model / analysis', 'Validation'],
    toolchain: ['AutoCAD / Revit / QGIS', 'The relevant IS or local code books', 'Survey or open geospatial data', 'A structural or hydraulic analysis tool'],
    runMeans: 'the design is analysed against the governing code and the numbers clear the required factors of safety',
    firstWeek: [
      'Collect real site or survey data — a design on invented ground conditions proves nothing',
      'Identify the exact codes and clauses that govern this design and list them',
      'Produce the preliminary layout and the load or flow assumptions',
      'Run one governing check by hand before opening any analysis software',
    ],
    proofArtifacts: ['Drawings with dimensions and a title block', 'Code-compliance check sheet citing clauses', 'Analysis output with load cases', 'Quantity and cost estimate', 'Photos or GIS extract of the real site'],
    validation: 'Every governing check cites the code clause it satisfies, with the margin shown.',
    costNote: 'Software licences and survey data are the cost; student licences and open geospatial data cover most of it.',
  },

  business_ops: {
    id: 'business_ops',
    label: 'Business / operations / service design',
    buildUnit: 'workflow',
    workspaceTabs: ['Problem evidence', 'Current process', 'Redesign', 'Pilot', 'Measurement'],
    toolchain: ['Spreadsheet modelling', 'Process-mapping tool (draw.io / Miro)', 'A survey or interview script', 'A simple dashboard'],
    runMeans: 'a real pilot has run with real people and produced before/after numbers',
    firstWeek: [
      'Interview five people who actually have the problem and write up verbatim quotes',
      'Map the current process with real timings, not assumed ones',
      'Identify the single step that costs the most time or money',
      'Design the smallest intervention that could move that one number',
    ],
    proofArtifacts: ['Interview notes and quotes', 'Before/after process maps with timings', 'Pilot results with sample size', 'Cost model showing the saving', 'Signed feedback from a real user or organisation'],
    validation: 'A measured before/after on a real pilot with a stated sample size — not a projection.',
    costNote: 'Mostly your time; budget for participant incentives if you need real users.',
  },
};

export const DISCIPLINE_IDS = Object.keys(DISCIPLINES);
export const DEFAULT_DISCIPLINE = 'software';

/* ---------------- deterministic classification ----------------
   Weighted keyword scoring. Software is the fallback, but it must
   actually win on evidence — it no longer wins by default when a
   hardware or lab project simply mentions "data". */

const SIGNALS = {
  hardware: [
    ['sensor', 3], ['microcontroller', 4], ['arduino', 4], ['esp32', 4], ['raspberry pi', 3], ['stm32', 4],
    ['firmware', 4], ['pcb', 4], ['circuit', 3], ['actuator', 3], ['servo', 3], ['iot', 3], ['embedded', 3],
    ['drone', 3], ['robot', 3], ['wearable', 3], ['soldering', 3], ['gpio', 3], ['lora', 3], ['rfid', 2],
    ['battery', 2], ['voltage', 2], ['calibrat', 2], ['telemetry', 2], ['edge device', 3],
  ],
  data_ml: [
    ['dataset', 3], ['machine learning', 4], ['deep learning', 4], ['neural network', 4], ['training data', 3],
    ['classifier', 3], ['regression', 3], ['computer vision', 4], ['nlp', 3], ['llm', 3], ['inference', 2],
    ['feature engineering', 3], ['model accuracy', 3], ['precision and recall', 3], ['forecast', 2], ['anomaly detection', 3],
  ],
  mechanical: [
    ['cad', 4], ['solidworks', 4], ['fusion 360', 4], ['fea', 4], ['finite element', 4], ['tolerance', 3],
    ['gearbox', 4], ['chassis', 3], ['linkage', 3], ['3d print', 3], ['machining', 3], ['fatigue', 3],
    ['stress analysis', 4], ['torque', 3], ['thermal management', 2], ['fixture', 2], ['bearing', 3],
  ],
  bio_chem: [
    ['assay', 4], ['reagent', 4], ['in vitro', 4], ['cell culture', 4], ['pcr', 4], ['protein', 3],
    ['biomarker', 4], ['clinical trial', 3], ['petri', 3], ['catalyst', 3], ['titration', 4], ['chromatograph', 4],
    ['microbial', 3], ['enzyme', 3], ['assay protocol', 4], ['ethics approval', 3], ['toxicity', 3],
  ],
  civil_infra: [
    ['structural', 3], ['reinforced concrete', 4], ['soil', 3], ['geotechnical', 4], ['bridge', 3],
    ['stormwater', 4], ['drainage', 3], ['load bearing', 4], ['seismic', 4], ['surveying', 3], ['is code', 4],
    ['bim', 3], ['revit', 4], ['town planning', 3], ['pavement', 3], ['hydraulic', 3],
  ],
  business_ops: [
    ['supply chain', 3], ['inventory turnover', 3], ['process improvement', 3], ['sop', 2], ['workflow', 2],
    ['customer journey', 3], ['unit economics', 3], ['pricing model', 3], ['market research', 3],
    ['operations', 2], ['logistics route', 3], ['staffing', 2], ['procurement', 3],
  ],
  software: [
    ['api', 2], ['frontend', 3], ['backend', 3], ['database', 2], ['dashboard', 2], ['web app', 4],
    ['mobile app', 4], ['saas', 3], ['authentication', 2], ['react', 3], ['node', 2], ['rest', 2],
    ['crud', 3], ['deployment', 2], ['microservice', 3], ['browser', 2], ['user interface', 2],
  ],
};

/**
 * detectDiscipline(project) → { id, label, confidence, scores, signalsMatched }
 * Never throws. Falls back to 'software' with low confidence when nothing matches.
 */
export function detectDiscipline(project = {}) {
  const text = lc([
    project.title, project.projectTitle, project.domain, project.problem, project.painPoint,
    project.problemStatement, project.proposedSolution, project.technicalMechanism, project.summary,
    project.noveltyAngle, project.marketUseCase, project.useCase,
    Array.isArray(project.tags) ? project.tags.join(' ') : project.tags,
    Array.isArray(project.techStack) ? project.techStack.join(' ') : project.techStack,
    Array.isArray(project.requiredSkills) ? project.requiredSkills.join(' ') : project.requiredSkills,
    Array.isArray(project.mvpScope) ? project.mvpScope.join(' ') : project.mvpScope,
  ].filter(Boolean).join(' '));

  const scores = {};
  const signalsMatched = {};
  for (const [id, pairs] of Object.entries(SIGNALS)) {
    let total = 0;
    const hits = [];
    for (const [needle, weight] of pairs) {
      if (text.includes(needle)) { total += weight; hits.push(needle); }
    }
    scores[id] = total;
    if (hits.length) signalsMatched[id] = hits;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = ranked[0] || [DEFAULT_DISCIPLINE, 0];
  const secondScore = ranked[1]?.[1] || 0;

  // An explicit override always wins (the custom-project form can set it).
  const forced = String(project.discipline || '').trim();
  if (DISCIPLINES[forced]) {
    return { ...DISCIPLINES[forced], confidence: 'high', scores, signalsMatched, source: 'explicit' };
  }

  if (topScore === 0) {
    return { ...DISCIPLINES[DEFAULT_DISCIPLINE], confidence: 'low', scores, signalsMatched, source: 'default' };
  }
  const clear = topScore >= 6 && topScore - secondScore >= 3;
  return {
    ...DISCIPLINES[topId],
    confidence: clear ? 'high' : topScore >= 4 ? 'medium' : 'low',
    scores,
    signalsMatched,
    source: 'detected',
  };
}

/** True when a project is at least partly software, so software guidance still applies. */
export function hasSoftwareComponent(discipline, project = {}) {
  if (discipline?.id === 'software' || discipline?.id === 'data_ml') return true;
  const text = lc([project.proposedSolution, project.technicalMechanism, project.summary].filter(Boolean).join(' '));
  return /\b(app|dashboard|api|web|mobile|portal|software|interface)\b/.test(text);
}

export default { DISCIPLINES, DISCIPLINE_IDS, DEFAULT_DISCIPLINE, detectDiscipline, hasSoftwareComponent };
