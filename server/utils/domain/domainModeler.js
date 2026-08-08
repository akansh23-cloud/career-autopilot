/* ============================================================
   Domain Modeler — deterministic domain inference (NO AI).
   ------------------------------------------------------------
   WHY THIS EXISTS
   The old engine reduced every project to one generic entity
   ("Record") with title/description/status. A student building a
   clinic follow-up system got `/api/records` and had to invent the
   entire real schema themselves — which is exactly where builds
   died. This module derives the REAL domain: entity names, real
   fields with types, enums, relations and realistic seed rows.

   Everything downstream (models, validators, services, forms,
   tables, seeds, tests, guides) is generated from this one object,
   so the whole pack speaks the student's domain language.

   Deterministic: same project in -> byte-identical domain out.
   ============================================================ */
import { arr, str, obj, pascal, camel, slug } from '../workspace/planUtils.js';

/* ---------- field helpers ---------------------------------- */
const F = {
  text: (name, o = {}) => ({ name, type: 'string', ui: 'text', ...o }),
  long: (name, o = {}) => ({ name, type: 'string', ui: 'textarea', ...o }),
  num: (name, o = {}) => ({ name, type: 'number', ui: 'number', ...o }),
  date: (name, o = {}) => ({ name, type: 'date', ui: 'date', ...o }),
  bool: (name, o = {}) => ({ name, type: 'boolean', ui: 'checkbox', ...o }),
  enum: (name, values, o = {}) => ({ name, type: 'enum', ui: 'select', enumValues: values, default: values[0], ...o }),
  email: (name, o = {}) => ({ name, type: 'email', ui: 'email', ...o }),
  phone: (name, o = {}) => ({ name, type: 'phone', ui: 'tel', ...o }),
  url: (name, o = {}) => ({ name, type: 'url', ui: 'url', ...o }),
  ref: (name, to, o = {}) => ({ name, type: 'ref', ui: 'text', ref: to, ...o }),
};
const req = { required: true };

/* ============================================================
   DOMAIN PACKS
   Each pack: a matcher, the primary entity (the noun the student
   actually talks about), an optional secondary entity, and three
   seed rows so the app is never empty on first run.
   Order matters — the first match wins, so put specific before
   generic.
   ============================================================ */
export const DOMAIN_PACKS = [
  {
    id: 'clinic',
    match: /clinic|patient|doctor|hospital|medical|appointment reminder|follow-?up|prescription|diagnos/,
    label: 'Clinic / patient care',
    primary: {
      name: 'Patient',
      fields: [
        F.text('fullName', { ...req, label: 'Full name' }),
        F.phone('phone', { ...req, label: 'Phone' }),
        F.num('age', { label: 'Age', min: 0, max: 120 }),
        F.text('condition', { label: 'Reason for visit' }),
        F.date('lastVisitAt', { label: 'Last visit' }),
        F.date('followUpAt', { label: 'Follow-up due' }),
        F.enum('followUpStatus', ['pending', 'reminded', 'confirmed', 'missed'], { label: 'Follow-up status' }),
        F.long('notes', { label: 'Notes' }),
      ],
      seed: [
        { fullName: 'Ramesh Patil', phone: '+919812345671', age: 54, condition: 'BP review', lastVisitAt: '2026-07-02', followUpAt: '2026-08-02', followUpStatus: 'pending', notes: 'Bring previous reports.' },
        { fullName: 'Sneha Kulkarni', phone: '+919812345672', age: 31, condition: 'Post-surgery check', lastVisitAt: '2026-07-18', followUpAt: '2026-08-15', followUpStatus: 'reminded', notes: 'Stitches removed.' },
        { fullName: 'Imran Shaikh', phone: '+919812345673', age: 45, condition: 'Diabetes monitoring', lastVisitAt: '2026-06-28', followUpAt: '2026-07-28', followUpStatus: 'missed', notes: 'Missed two reminders.' },
      ],
    },
    secondary: {
      name: 'Reminder',
      fields: [
        F.ref('patientId', 'Patient', { ...req, label: 'Patient' }),
        F.enum('channel', ['sms', 'whatsapp', 'call'], { label: 'Channel' }),
        F.date('sendAt', { ...req, label: 'Send at' }),
        F.enum('status', ['queued', 'sent', 'failed'], { label: 'Status' }),
        F.text('message', { label: 'Message' }),
      ],
      seed: [
        { channel: 'whatsapp', sendAt: '2026-08-01', status: 'sent', message: 'Reminder: follow-up tomorrow at 11:00.' },
        { channel: 'sms', sendAt: '2026-08-14', status: 'queued', message: 'Your check-up is due this week.' },
        { channel: 'call', sendAt: '2026-07-27', status: 'failed', message: 'No answer — retry.' },
      ],
    },
  },
  {
    id: 'attendance',
    match: /attendance|coaching|classroom|student engagement|roll call|batch|tuition/,
    label: 'Classroom / attendance',
    primary: {
      name: 'Student',
      fields: [
        F.text('fullName', { ...req, label: 'Full name' }),
        F.text('rollNo', { ...req, label: 'Roll number' }),
        F.text('batch', { label: 'Batch' }),
        F.phone('guardianPhone', { label: 'Guardian phone' }),
        F.num('attendancePercent', { label: 'Attendance %', min: 0, max: 100 }),
        F.enum('riskLevel', ['low', 'watch', 'high'], { label: 'Drop-off risk' }),
        F.date('lastPresentAt', { label: 'Last present' }),
      ],
      seed: [
        { fullName: 'Aarti Deshmukh', rollNo: 'B21-014', batch: 'JEE-Morning', guardianPhone: '+919800000011', attendancePercent: 92, riskLevel: 'low', lastPresentAt: '2026-08-06' },
        { fullName: 'Kunal Jadhav', rollNo: 'B21-027', batch: 'JEE-Morning', guardianPhone: '+919800000012', attendancePercent: 61, riskLevel: 'watch', lastPresentAt: '2026-08-01' },
        { fullName: 'Fatima Sayyed', rollNo: 'B21-031', batch: 'NEET-Evening', guardianPhone: '+919800000013', attendancePercent: 38, riskLevel: 'high', lastPresentAt: '2026-07-21' },
      ],
    },
    secondary: {
      name: 'Session',
      fields: [
        F.text('subject', { ...req, label: 'Subject' }),
        F.date('heldAt', { ...req, label: 'Held on' }),
        F.num('presentCount', { label: 'Present' }),
        F.num('totalCount', { label: 'Total' }),
      ],
      seed: [
        { subject: 'Physics', heldAt: '2026-08-05', presentCount: 24, totalCount: 30 },
        { subject: 'Chemistry', heldAt: '2026-08-06', presentCount: 27, totalCount: 30 },
        { subject: 'Maths', heldAt: '2026-08-07', presentCount: 19, totalCount: 30 },
      ],
    },
  },
  {
    id: 'delivery',
    match: /deliver|route|logistic|courier|shipment|dispatch|last-?mile|fleet/,
    label: 'Delivery / logistics',
    primary: {
      name: 'Delivery',
      fields: [
        F.text('customerName', { ...req, label: 'Customer' }),
        F.text('address', { ...req, label: 'Drop address' }),
        F.phone('phone', { label: 'Phone' }),
        F.num('distanceKm', { label: 'Distance (km)' }),
        F.enum('status', ['pending', 'assigned', 'out_for_delivery', 'delivered', 'failed'], { label: 'Status' }),
        F.date('scheduledFor', { label: 'Scheduled for' }),
        F.text('assignedTo', { label: 'Rider' }),
      ],
      seed: [
        { customerName: 'Nikita Rao', address: 'Flat 302, Sai Residency, Nashik', phone: '+919820000021', distanceKm: 3.4, status: 'pending', scheduledFor: '2026-08-09', assignedTo: '' },
        { customerName: 'Vikram Singh', address: 'Shop 7, MG Road, Nashik', phone: '+919820000022', distanceKm: 6.1, status: 'out_for_delivery', scheduledFor: '2026-08-08', assignedTo: 'Rider-2' },
        { customerName: 'Meera Joshi', address: 'Plot 14, Gangapur Road, Nashik', phone: '+919820000023', distanceKm: 1.8, status: 'delivered', scheduledFor: '2026-08-07', assignedTo: 'Rider-1' },
      ],
    },
    secondary: {
      name: 'Route',
      fields: [
        F.text('name', { ...req, label: 'Route name' }),
        F.date('runsOn', { label: 'Runs on' }),
        F.num('stopCount', { label: 'Stops' }),
        F.num('totalKm', { label: 'Total km' }),
      ],
      seed: [
        { name: 'Morning — Gangapur', runsOn: '2026-08-08', stopCount: 9, totalKm: 22.5 },
        { name: 'Afternoon — College Road', runsOn: '2026-08-08', stopCount: 6, totalKm: 14 },
        { name: 'Evening — Nashik Road', runsOn: '2026-08-08', stopCount: 11, totalKm: 31.2 },
      ],
    },
  },
  {
    id: 'expense',
    match: /expense|invoice|budget|freelanc|billing|accounting|ledger|gst|payout/,
    label: 'Money / invoicing',
    primary: {
      name: 'Invoice',
      fields: [
        F.text('clientName', { ...req, label: 'Client' }),
        F.text('number', { ...req, label: 'Invoice no.' }),
        F.num('amount', { ...req, label: 'Amount' }),
        F.enum('currency', ['INR', 'USD', 'EUR'], { label: 'Currency' }),
        F.date('issuedOn', { label: 'Issued on' }),
        F.date('dueOn', { label: 'Due on' }),
        F.enum('status', ['draft', 'sent', 'paid', 'overdue'], { label: 'Status' }),
        F.long('lineItems', { label: 'Line items' }),
      ],
      seed: [
        { clientName: 'Acme Studio', number: 'INV-2026-001', amount: 45000, currency: 'INR', issuedOn: '2026-07-01', dueOn: '2026-07-15', status: 'paid', lineItems: 'Landing page design x1' },
        { clientName: 'Bluepeak Labs', number: 'INV-2026-002', amount: 82000, currency: 'INR', issuedOn: '2026-07-20', dueOn: '2026-08-04', status: 'overdue', lineItems: 'API integration, 40h' },
        { clientName: 'Northwind', number: 'INV-2026-003', amount: 1200, currency: 'USD', issuedOn: '2026-08-01', dueOn: '2026-08-31', status: 'sent', lineItems: 'Monthly retainer' },
      ],
    },
    secondary: {
      name: 'Expense',
      fields: [
        F.text('category', { ...req, label: 'Category' }),
        F.num('amount', { ...req, label: 'Amount' }),
        F.date('spentOn', { label: 'Spent on' }),
        F.text('vendor', { label: 'Vendor' }),
        F.bool('reimbursable', { label: 'Reimbursable' }),
      ],
      seed: [
        { category: 'Software', amount: 1499, spentOn: '2026-07-03', vendor: 'Figma', reimbursable: false },
        { category: 'Travel', amount: 3200, spentOn: '2026-07-12', vendor: 'IRCTC', reimbursable: true },
        { category: 'Hardware', amount: 8600, spentOn: '2026-07-29', vendor: 'Croma', reimbursable: false },
      ],
    },
  },
  {
    id: 'booking',
    match: /booking|appointment|reservation|slot|schedul|calendar|event manage|venue/,
    label: 'Booking / scheduling',
    primary: {
      name: 'Booking',
      fields: [
        F.text('customerName', { ...req, label: 'Customer' }),
        F.phone('phone', { label: 'Phone' }),
        F.text('service', { ...req, label: 'Service' }),
        F.date('startsAt', { ...req, label: 'Starts at' }),
        F.num('durationMinutes', { label: 'Duration (min)', default: 30 }),
        F.enum('status', ['requested', 'confirmed', 'completed', 'cancelled'], { label: 'Status' }),
        F.long('notes', { label: 'Notes' }),
      ],
      seed: [
        { customerName: 'Priya Nair', phone: '+919833000031', service: 'Consultation', startsAt: '2026-08-09', durationMinutes: 30, status: 'confirmed', notes: 'First visit' },
        { customerName: 'Rohit Gupta', phone: '+919833000032', service: 'Follow-up', startsAt: '2026-08-10', durationMinutes: 15, status: 'requested', notes: '' },
        { customerName: 'Anjali Menon', phone: '+919833000033', service: 'Full session', startsAt: '2026-08-11', durationMinutes: 60, status: 'completed', notes: 'Paid in cash' },
      ],
    },
    secondary: {
      name: 'Slot',
      fields: [
        F.date('date', { ...req, label: 'Date' }),
        F.text('startTime', { ...req, label: 'Start time' }),
        F.num('capacity', { label: 'Capacity', default: 1 }),
        F.bool('isOpen', { label: 'Open', default: true }),
      ],
      seed: [
        { date: '2026-08-09', startTime: '10:00', capacity: 1, isOpen: false },
        { date: '2026-08-09', startTime: '11:00', capacity: 1, isOpen: true },
        { date: '2026-08-10', startTime: '16:30', capacity: 2, isOpen: true },
      ],
    },
  },
  {
    id: 'ticket',
    match: /ticket|helpdesk|support desk|complaint|grievance|issue track|service request/,
    label: 'Support / tickets',
    primary: {
      name: 'Ticket',
      fields: [
        F.text('subject', { ...req, label: 'Subject' }),
        F.long('body', { label: 'Description' }),
        F.text('raisedBy', { label: 'Raised by' }),
        F.enum('priority', ['low', 'normal', 'high', 'urgent'], { label: 'Priority' }),
        F.enum('status', ['open', 'in_progress', 'resolved', 'closed'], { label: 'Status' }),
        F.text('assignedTo', { label: 'Assigned to' }),
        F.date('dueAt', { label: 'Due' }),
      ],
      seed: [
        { subject: 'Water leakage in Block B', body: 'Ceiling leak near stairs.', raisedBy: 'hostel-201', priority: 'high', status: 'open', assignedTo: '', dueAt: '2026-08-10' },
        { subject: 'Wi-Fi down in library', body: 'No connection since morning.', raisedBy: 'lib-desk', priority: 'urgent', status: 'in_progress', assignedTo: 'network-team', dueAt: '2026-08-08' },
        { subject: 'Projector bulb replacement', body: 'Room 304 projector dim.', raisedBy: 'faculty-cs', priority: 'normal', status: 'resolved', assignedTo: 'maintenance', dueAt: '2026-08-05' },
      ],
    },
  },
  {
    id: 'inventory',
    match: /inventory|stock|warehouse|pharmac|kirana|retail store|sku|reorder/,
    label: 'Inventory / stock',
    primary: {
      name: 'Product',
      fields: [
        F.text('name', { ...req, label: 'Product name' }),
        F.text('sku', { ...req, label: 'SKU' }),
        F.num('quantity', { ...req, label: 'Quantity in stock', default: 0 }),
        F.num('reorderLevel', { label: 'Reorder level', default: 5 }),
        F.num('unitPrice', { label: 'Unit price' }),
        F.date('expiresOn', { label: 'Expiry' }),
        F.text('supplier', { label: 'Supplier' }),
      ],
      seed: [
        { name: 'Paracetamol 500mg', sku: 'MED-PARA-500', quantity: 120, reorderLevel: 40, unitPrice: 18.5, expiresOn: '2027-03-01', supplier: 'Medlife Distributors' },
        { name: 'Digital thermometer', sku: 'DEV-THERMO-01', quantity: 6, reorderLevel: 10, unitPrice: 240, expiresOn: '', supplier: 'CareTech' },
        { name: 'ORS sachet', sku: 'MED-ORS-20', quantity: 0, reorderLevel: 25, unitPrice: 12, expiresOn: '2026-11-15', supplier: 'Medlife Distributors' },
      ],
    },
    secondary: {
      name: 'StockMovement',
      fields: [
        F.text('sku', { ...req, label: 'SKU' }),
        F.enum('kind', ['in', 'out', 'adjust'], { label: 'Movement' }),
        F.num('quantity', { ...req, label: 'Quantity' }),
        F.date('movedAt', { label: 'Date' }),
        F.text('reason', { label: 'Reason' }),
      ],
      seed: [
        { sku: 'MED-PARA-500', kind: 'in', quantity: 100, movedAt: '2026-08-01', reason: 'Purchase order #221' },
        { sku: 'MED-ORS-20', kind: 'out', quantity: 25, movedAt: '2026-08-04', reason: 'Counter sale' },
        { sku: 'DEV-THERMO-01', kind: 'adjust', quantity: -1, movedAt: '2026-08-06', reason: 'Damaged unit' },
      ],
    },
  },
  {
    id: 'jobs',
    match: /job board|recruit|hiring|applicant|candidate|placement|resume screen|ats/,
    label: 'Hiring / candidates',
    primary: {
      name: 'Candidate',
      fields: [
        F.text('fullName', { ...req, label: 'Full name' }),
        F.email('email', { ...req, label: 'Email' }),
        F.text('role', { label: 'Applying for' }),
        F.num('experienceYears', { label: 'Experience (years)' }),
        F.text('skills', { label: 'Skills (comma separated)' }),
        F.enum('stage', ['applied', 'screened', 'interview', 'offer', 'rejected'], { label: 'Stage' }),
        F.num('matchScore', { label: 'Match score', min: 0, max: 100 }),
      ],
      seed: [
        { fullName: 'Sahil Verma', email: 'sahil.verma@example.com', role: 'Backend Intern', experienceYears: 0, skills: 'Node.js, MongoDB, Git', stage: 'applied', matchScore: 62 },
        { fullName: 'Divya Prasad', email: 'divya.prasad@example.com', role: 'Frontend Intern', experienceYears: 1, skills: 'React, CSS, TypeScript', stage: 'interview', matchScore: 81 },
        { fullName: 'Arjun Rane', email: 'arjun.rane@example.com', role: 'Data Intern', experienceYears: 0, skills: 'Python, SQL, Pandas', stage: 'screened', matchScore: 70 },
      ],
    },
    secondary: {
      name: 'JobPost',
      fields: [
        F.text('title', { ...req, label: 'Job title' }),
        F.text('company', { label: 'Company' }),
        F.text('location', { label: 'Location' }),
        F.long('requirements', { label: 'Requirements' }),
        F.bool('isOpen', { label: 'Open', default: true }),
      ],
      seed: [
        { title: 'Backend Intern', company: 'Nimbus Tech', location: 'Pune', requirements: 'Node.js, REST, Git', isOpen: true },
        { title: 'Frontend Intern', company: 'Nimbus Tech', location: 'Remote', requirements: 'React, CSS', isOpen: true },
        { title: 'Data Intern', company: 'Vector Analytics', location: 'Nashik', requirements: 'Python, SQL', isOpen: false },
      ],
    },
  },
  {
    id: 'ecommerce',
    match: /e-?commerce|shop|cart|checkout|storefront|order manage|marketplace seller/,
    label: 'Commerce / orders',
    primary: {
      name: 'Order',
      fields: [
        F.text('orderNo', { ...req, label: 'Order no.' }),
        F.text('customerName', { ...req, label: 'Customer' }),
        F.num('total', { ...req, label: 'Total' }),
        F.enum('status', ['placed', 'packed', 'shipped', 'delivered', 'cancelled'], { label: 'Status' }),
        F.date('placedAt', { label: 'Placed on' }),
        F.text('items', { label: 'Items summary' }),
        F.text('address', { label: 'Shipping address' }),
      ],
      seed: [
        { orderNo: 'ORD-1041', customerName: 'Tanvi Shah', total: 1299, status: 'placed', placedAt: '2026-08-06', items: 'T-shirt x2', address: 'Pune 411045' },
        { orderNo: 'ORD-1042', customerName: 'Aman Kapoor', total: 4499, status: 'shipped', placedAt: '2026-08-04', items: 'Headphones x1', address: 'Nashik 422009' },
        { orderNo: 'ORD-1043', customerName: 'Ritika Bose', total: 799, status: 'cancelled', placedAt: '2026-08-02', items: 'Notebook x3', address: 'Mumbai 400001' },
      ],
    },
  },
  {
    id: 'civic',
    match: /civic|municipal|pothole|garbage|citizen report|public grievance|ward/,
    label: 'Civic reporting',
    primary: {
      name: 'Issue',
      fields: [
        F.text('title', { ...req, label: 'Issue' }),
        F.enum('category', ['road', 'water', 'garbage', 'streetlight', 'other'], { label: 'Category' }),
        F.text('locality', { ...req, label: 'Locality' }),
        F.num('latitude', { label: 'Latitude' }),
        F.num('longitude', { label: 'Longitude' }),
        F.enum('status', ['reported', 'acknowledged', 'resolved'], { label: 'Status' }),
        F.num('upvotes', { label: 'Upvotes', default: 0 }),
        F.long('description', { label: 'Description' }),
      ],
      seed: [
        { title: 'Large pothole near bus stop', category: 'road', locality: 'College Road', latitude: 19.9975, longitude: 73.7898, status: 'reported', upvotes: 14, description: 'Two-wheelers skidding daily.' },
        { title: 'Streetlight not working', category: 'streetlight', locality: 'Gangapur Road', latitude: 20.0059, longitude: 73.7623, status: 'acknowledged', upvotes: 6, description: 'Dark stretch for 200m.' },
        { title: 'Garbage not collected', category: 'garbage', locality: 'Panchavati', latitude: 20.0100, longitude: 73.7920, status: 'resolved', upvotes: 22, description: 'Pickup missed for 4 days.' },
      ],
    },
  },
  {
    id: 'fitness',
    match: /fitness|workout|gym|nutrition|calorie|habit track|wellness/,
    label: 'Fitness / habits',
    primary: {
      name: 'Workout',
      fields: [
        F.text('name', { ...req, label: 'Workout' }),
        F.date('performedOn', { ...req, label: 'Date' }),
        F.num('durationMinutes', { label: 'Duration (min)' }),
        F.num('calories', { label: 'Calories' }),
        F.enum('intensity', ['light', 'moderate', 'hard'], { label: 'Intensity' }),
        F.long('notes', { label: 'Notes' }),
      ],
      seed: [
        { name: 'Morning run', performedOn: '2026-08-06', durationMinutes: 32, calories: 310, intensity: 'moderate', notes: '4.5 km' },
        { name: 'Push day', performedOn: '2026-08-07', durationMinutes: 55, calories: 420, intensity: 'hard', notes: 'Bench 4x8' },
        { name: 'Yoga', performedOn: '2026-08-08', durationMinutes: 25, calories: 120, intensity: 'light', notes: 'Mobility focus' },
      ],
    },
  },
  {
    id: 'library',
    match: /library|book|borrow|lending|catalog/,
    label: 'Library / lending',
    primary: {
      name: 'Book',
      fields: [
        F.text('title', { ...req, label: 'Title' }),
        F.text('author', { ...req, label: 'Author' }),
        F.text('isbn', { label: 'ISBN' }),
        F.num('copies', { label: 'Copies', default: 1 }),
        F.enum('status', ['available', 'issued', 'lost'], { label: 'Status' }),
        F.text('issuedTo', { label: 'Issued to' }),
        F.date('dueOn', { label: 'Due on' }),
      ],
      seed: [
        { title: 'Clean Code', author: 'Robert C. Martin', isbn: '9780132350884', copies: 3, status: 'available', issuedTo: '', dueOn: '' },
        { title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', isbn: '9781449373320', copies: 1, status: 'issued', issuedTo: 'B21-014', dueOn: '2026-08-20' },
        { title: 'The Pragmatic Programmer', author: 'Hunt & Thomas', isbn: '9780201616224', copies: 2, status: 'available', issuedTo: '', dueOn: '' },
      ],
    },
  },
  {
    id: 'crm',
    match: /crm|lead|sales pipeline|prospect|deal|follow up sales/,
    label: 'CRM / leads',
    primary: {
      name: 'Lead',
      fields: [
        F.text('companyName', { ...req, label: 'Company' }),
        F.text('contactName', { label: 'Contact' }),
        F.email('email', { label: 'Email' }),
        F.phone('phone', { label: 'Phone' }),
        F.enum('stage', ['new', 'contacted', 'demo', 'won', 'lost'], { label: 'Stage' }),
        F.num('dealValue', { label: 'Deal value' }),
        F.date('nextFollowUpAt', { label: 'Next follow-up' }),
      ],
      seed: [
        { companyName: 'Sunrise Coaching', contactName: 'Mr. Deshpande', email: 'admin@sunrise.example', phone: '+919845000041', stage: 'demo', dealValue: 60000, nextFollowUpAt: '2026-08-12' },
        { companyName: 'Greenfield School', contactName: 'Ms. Iyer', email: 'principal@greenfield.example', phone: '+919845000042', stage: 'contacted', dealValue: 120000, nextFollowUpAt: '2026-08-09' },
        { companyName: 'Metro Clinic', contactName: 'Dr. Bhosale', email: 'front@metroclinic.example', phone: '+919845000043', stage: 'new', dealValue: 35000, nextFollowUpAt: '2026-08-15' },
      ],
    },
  },
  {
    id: 'restaurant',
    match: /restaurant|cafe|menu|kitchen|food order|dine|canteen/,
    label: 'Restaurant / menu',
    primary: {
      name: 'MenuItem',
      fields: [
        F.text('name', { ...req, label: 'Item' }),
        F.enum('category', ['starter', 'main', 'dessert', 'beverage'], { label: 'Category' }),
        F.num('price', { ...req, label: 'Price' }),
        F.bool('isVeg', { label: 'Vegetarian', default: true }),
        F.bool('available', { label: 'Available today', default: true }),
        F.long('description', { label: 'Description' }),
      ],
      seed: [
        { name: 'Misal Pav', category: 'main', price: 90, isVeg: true, available: true, description: 'Nashik style, extra tarri.' },
        { name: 'Chicken Biryani', category: 'main', price: 220, isVeg: false, available: true, description: 'Serves one.' },
        { name: 'Filter Coffee', category: 'beverage', price: 45, isVeg: true, available: false, description: 'Machine under repair.' },
      ],
    },
  },
  {
    id: 'realestate',
    match: /real estate|property|rent|tenant|flat|landlord|broker/,
    label: 'Property / rentals',
    primary: {
      name: 'Property',
      fields: [
        F.text('title', { ...req, label: 'Listing title' }),
        F.text('locality', { ...req, label: 'Locality' }),
        F.num('rent', { label: 'Monthly rent' }),
        F.num('bedrooms', { label: 'Bedrooms' }),
        F.enum('furnishing', ['unfurnished', 'semi', 'full'], { label: 'Furnishing' }),
        F.enum('status', ['available', 'reserved', 'rented'], { label: 'Status' }),
        F.date('availableFrom', { label: 'Available from' }),
      ],
      seed: [
        { title: '2BHK near college', locality: 'College Road', rent: 18000, bedrooms: 2, furnishing: 'semi', status: 'available', availableFrom: '2026-09-01' },
        { title: '1RK for students', locality: 'Panchavati', rent: 7500, bedrooms: 1, furnishing: 'unfurnished', status: 'reserved', availableFrom: '2026-08-20' },
        { title: '3BHK family flat', locality: 'Gangapur Road', rent: 32000, bedrooms: 3, furnishing: 'full', status: 'rented', availableFrom: '2026-10-01' },
      ],
    },
  },
  {
    id: 'learning',
    match: /course|lesson|quiz|flashcard|e-?learning|lms|study plan|mock test/,
    label: 'Learning / courses',
    primary: {
      name: 'Course',
      fields: [
        F.text('title', { ...req, label: 'Course title' }),
        F.text('instructor', { label: 'Instructor' }),
        F.num('durationHours', { label: 'Duration (hours)' }),
        F.enum('level', ['beginner', 'intermediate', 'advanced'], { label: 'Level' }),
        F.num('enrolledCount', { label: 'Enrolled', default: 0 }),
        F.bool('published', { label: 'Published', default: false }),
        F.long('outline', { label: 'Outline' }),
      ],
      seed: [
        { title: 'DSA in 30 days', instructor: 'Prof. Kulkarni', durationHours: 40, level: 'intermediate', enrolledCount: 128, published: true, outline: 'Arrays → Trees → DP' },
        { title: 'Intro to Databases', instructor: 'Prof. Nair', durationHours: 18, level: 'beginner', enrolledCount: 64, published: true, outline: 'ER → SQL → Indexing' },
        { title: 'System Design Basics', instructor: 'Ms. Bhatt', durationHours: 25, level: 'advanced', enrolledCount: 12, published: false, outline: 'Scaling → Caching → Queues' },
      ],
    },
  },
  {
    id: 'content',
    match: /blog|post|article|newsletter|cms|social feed|content calendar/,
    label: 'Content / publishing',
    primary: {
      name: 'Post',
      fields: [
        F.text('title', { ...req, label: 'Title' }),
        F.text('author', { label: 'Author' }),
        F.long('body', { label: 'Body' }),
        F.text('tags', { label: 'Tags (comma separated)' }),
        F.enum('status', ['draft', 'scheduled', 'published'], { label: 'Status' }),
        F.date('publishAt', { label: 'Publish at' }),
        F.num('views', { label: 'Views', default: 0 }),
      ],
      seed: [
        { title: 'How we cut deploy time by half', author: 'akansh', body: 'We started by measuring…', tags: 'devops,ci', status: 'published', publishAt: '2026-07-30', views: 412 },
        { title: 'Notes on Mongo indexes', author: 'akansh', body: 'An index is a sorted structure…', tags: 'database', status: 'draft', publishAt: '', views: 0 },
        { title: 'Weekly digest #12', author: 'editor', body: 'This week in the community…', tags: 'newsletter', status: 'scheduled', publishAt: '2026-08-12', views: 0 },
      ],
    },
  },
];

/* Generic fallback pack — still domain-flavoured via field inference. */
const GENERIC_FIELDS = [
  F.text('title', { ...req, label: 'Title' }),
  F.long('description', { label: 'Description' }),
  F.enum('status', ['draft', 'active', 'archived'], { label: 'Status' }),
  F.date('dueAt', { label: 'Due date' }),
];

/* Extra fields inferred from the wording of the project + features. */
const FIELD_HINTS = [
  [/\bprice|amount|cost|fee|payment|rupee|₹|budget\b/, F.num('amount', { label: 'Amount' })],
  [/\bphone|sms|whatsapp|call\b/, F.phone('phone', { label: 'Phone' })],
  [/\bemail|mail\b/, F.email('email', { label: 'Email' })],
  [/\bdate|schedule|deadline|due|remind|calendar\b/, F.date('scheduledFor', { label: 'Scheduled for' })],
  [/\blocation|address|map|geo|route|nearby\b/, F.text('location', { label: 'Location' })],
  [/\brating|score|rank|grade\b/, F.num('score', { label: 'Score', min: 0, max: 100 })],
  [/\bphoto|image|picture|thumbnail\b/, F.url('imageUrl', { label: 'Image URL' })],
  [/\bquantity|stock|count|units\b/, F.num('quantity', { label: 'Quantity', default: 0 })],
  [/\bcategory|type|tag|label\b/, F.text('category', { label: 'Category' })],
  [/\bpriority|urgent\b/, F.enum('priority', ['low', 'normal', 'high'], { label: 'Priority' })],
];

/* Words that must never become an entity name. */
const STOP_NOUNS = new Set([
  'app', 'application', 'system', 'platform', 'tool', 'portal', 'dashboard', 'website', 'site',
  'service', 'project', 'software', 'solution', 'manager', 'management', 'tracker', 'tracking',
  'analytics', 'ai', 'ml', 'smart', 'online', 'digital', 'web', 'mobile', 'full', 'stack',
  'based', 'using', 'with', 'for', 'the', 'and', 'a', 'an', 'of', 'my', 'your', 'new', 'simple',
  'mini', 'micro', 'auto', 'automated', 'automation',
]);

/* ---------- public API ------------------------------------- */

/** Corpus used for every match. Stable ordering keeps this deterministic. */
function corpusOf(project = {}) {
  const p = obj(project);
  return [p.title, p.category, p.type, p.problemStatement, p.useCase, p.summary, p.targetUsers,
    arr(p.mvpFeatures).join(' '), arr(p.advancedFeatures).join(' ')]
    .map((s) => str(s).toLowerCase()).join(' ');
}

/** Pick the matching pack (or null for the generic path). */
export function detectDomainPack(project = {}) {
  const hay = corpusOf(project);
  return DOMAIN_PACKS.find((pk) => pk.match.test(hay)) || null;
}

/** Extract a plausible entity noun from the title when no pack matches. */
/* Words that qualify the real noun rather than being it. "Campus Skill
   Exchange" is about Skills, not Campuses; "Local Delivery Tracker" is about
   Deliveries, not Locals. Only skipped when a later word is available. */
const QUALIFIERS = new Set([
  'campus', 'college', 'school', 'city', 'local', 'national', 'global', 'regional',
  'personal', 'team', 'community', 'virtual', 'remote', 'daily', 'weekly', 'monthly',
  'quick', 'easy', 'modern', 'realtime', 'live', 'open', 'free', 'rural', 'urban',
]);

export function inferEntityName(project = {}) {
  const title = str(obj(project).title);
  const words = title.split(/[\s\-_/]+/).map((w) => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
  const usable = words.filter((w) => w.length > 2 && !STOP_NOUNS.has(w.toLowerCase()));
  const candidate = usable.find((w, i) => !(QUALIFIERS.has(w.toLowerCase()) && i < usable.length - 1))
    || usable[0];
  if (candidate) return pascal(singularize(candidate));
  const feat = arr(obj(project).mvpFeatures)[0];
  if (feat) {
    const fw = str(feat).split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean)
      .find((w) => w.length > 2 && !STOP_NOUNS.has(w.toLowerCase()));
    if (fw) return pascal(singularize(fw));
  }
  return 'Item';
}

export function singularize(word = '') {
  const w = str(word);
  if (/ies$/i.test(w)) return w.replace(/ies$/i, 'y');
  if (/(ses|xes|zes|ches|shes)$/i.test(w)) return w.replace(/es$/i, '');
  /* Words that merely END in s are not plurals: campus, status, analysis,
     news, chaos, kudos. Stripping the s produced "Campu" and "Statu". */
  if (/(ss|us|is|os|as|ys)$/i.test(w)) return w;
  if (w.length <= 3) return w;
  if (/s$/i.test(w)) return w.replace(/s$/i, '');
  return w;
}

export function pluralize(word = '') {
  const w = str(word);
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ies');
  return `${w}s`;
}

/** Normalize a raw pack field into the full field descriptor. */
function normalizeField(f, index) {
  const name = camel(str(f.name));
  return {
    name,
    label: f.label || humanize(name),
    type: f.type || 'string',
    ui: f.ui || 'text',
    required: !!f.required,
    enumValues: arr(f.enumValues),
    ref: f.ref || null,
    default: f.default !== undefined ? f.default : defaultFor(f),
    min: f.min !== undefined ? f.min : null,
    max: f.max !== undefined ? f.max : null,
    index: !!f.index || !!f.ref,
    order: index + 1,
  };
}

function defaultFor(f) {
  switch (f.type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'enum': return arr(f.enumValues)[0] || '';
    default: return '';
  }
}

export function humanize(name = '') {
  return str(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\bId\b/g, 'ID')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** Build one entity descriptor from a pack entity definition. */
function buildEntity(def, { role, ownerField }) {
  const name = pascal(def.name);
  const fields = arr(def.fields).map(normalizeField);
  if (ownerField && !fields.some((f) => f.name === 'userId')) {
    fields.unshift(normalizeField({ ...F.ref('userId', 'User', { required: true, label: 'Owner' }) }, -1));
  }
  return {
    name,
    plural: pluralize(name),
    slug: slug(name),
    slugPlural: slug(pluralize(name)),
    camel: camel(name),
    camelPlural: camel(pluralize(name)),
    label: humanize(name),
    role,
    fields,
    displayField: pickDisplayField(fields),
    seed: arr(def.seed).slice(0, 3),
  };
}

function pickDisplayField(fields) {
  const preferred = ['title', 'name', 'fullName', 'subject', 'orderNo', 'number', 'companyName', 'customerName'];
  for (const p of preferred) {
    const hit = fields.find((f) => f.name === p);
    if (hit) return hit.name;
  }
  const firstString = fields.find((f) => (f.type === 'string' || f.type === 'email') && f.ui !== 'textarea');
  return firstString ? firstString.name : (fields[0]?.name || 'title');
}

/** Extra inferred fields for the generic path. */
function inferredFields(project) {
  const hay = corpusOf(project);
  const out = [];
  for (const [re, field] of FIELD_HINTS) {
    if (re.test(hay) && !out.some((f) => f.name === field.name)) out.push(field);
  }
  return out.slice(0, 4);
}

/** Deterministic sample values used to seed the generic entity. */
function genericSeed(fields) {
  const rows = [1, 2, 3].map((n) => {
    const row = {};
    for (const f of fields) {
      if (f.name === 'userId') continue;
      row[f.name] = sampleValue(f, n);
    }
    return row;
  });
  return rows;
}

export function sampleValue(field, n = 1) {
  const label = field.label || humanize(field.name);
  switch (field.type) {
    case 'number': return [12, 34, 56][n - 1] ?? 10 * n;
    case 'boolean': return n !== 2;
    case 'date': return ['2026-08-09', '2026-08-16', '2026-08-23'][n - 1] || '2026-08-30';
    case 'enum': return field.enumValues[(n - 1) % Math.max(1, field.enumValues.length)] || '';
    case 'email': return `person${n}@example.com`;
    case 'phone': return `+91981000000${n}`;
    case 'url': return `https://example.com/${slug(field.name)}-${n}`;
    case 'ref': return '';
    default:
      return field.ui === 'textarea'
        ? `Sample ${label.toLowerCase()} for row ${n}. Replace with real data.`
        : `${label} ${n}`;
  }
}

/**
 * modelDomain(project, { features }) -> domain
 *
 * The single source of truth for everything domain-shaped in the
 * generated project.
 */
export function modelDomain(project = {}, { auth = true } = {}) {
  const pack = detectDomainPack(project);
  const entities = [];

  if (pack) {
    entities.push(buildEntity(pack.primary, { role: 'primary', ownerField: auth }));
    if (pack.secondary) entities.push(buildEntity(pack.secondary, { role: 'secondary', ownerField: auth }));
  } else {
    const name = inferEntityName(project);
    const fields = [...GENERIC_FIELDS, ...inferredFields(project)];
    const def = { name, fields, seed: [] };
    const entity = buildEntity(def, { role: 'primary', ownerField: auth });
    entity.seed = genericSeed(entity.fields);
    entities.push(entity);
  }

  // Seed rows for pack entities that shipped fewer than 3 rows.
  for (const e of entities) {
    if (e.seed.length < 3) e.seed = genericSeed(e.fields);
    e.seed = e.seed.map((row) => normalizeSeedRow(row, e.fields));
  }

  const primary = entities[0];
  return {
    version: 2,
    packId: pack ? pack.id : 'generic',
    packLabel: pack ? pack.label : 'General web app',
    confidence: pack ? 'high' : 'inferred',
    primary,
    secondary: entities[1] || null,
    entities,
    vocabulary: {
      entity: primary.name,
      entities: primary.plural,
      entityLower: primary.camel,
      entitiesLower: primary.camelPlural,
      displayField: primary.displayField,
    },
  };
}

/** Fill every field so seed rows always match the schema shape. */
function normalizeSeedRow(row, fields) {
  const out = {};
  for (const f of fields) {
    if (f.name === 'userId') continue;
    const v = row[f.name];
    out[f.name] = v === undefined || v === '' ? (f.type === 'date' ? '' : f.default) : v;
  }
  return out;
}

/* Backwards-compatible helper: the legacy engine only wanted a name. */
export function primaryEntityName(project = {}) {
  return modelDomain(project).primary.name;
}
