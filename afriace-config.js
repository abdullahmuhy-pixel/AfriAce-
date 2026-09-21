// afriace-config.js
// Single source of truth for per-country data across AfriAce.
// Every portal (public site, student, teacher, subject-teacher, school-admin, super-admin)
// reads from this file — never hardcode a country name, grade, exam, or subject in a portal page.

export const AFRIACE_LIVE_COUNTRIES = ['NG', 'GH', 'SL', 'GM']; // WAEC family — live now
export const AFRIACE_COMING_SOON = ['KE', 'ZM'];                 // Phase 2 — different exam systems

export const AFRIACE_COUNTRIES = {
  NG: {
    code: 'NG',
    name: 'Nigeria',
    flag: '🇳🇬',
    badge: 'WAEC / JAMB',
    examBody: 'WAEC',
    systemName: 'WASSCE / NECO / UTME',
    adminUnitLabel: 'State / FCT',
    grades: ['JSS 1', 'JSS 2', 'JSS 3', 'SSS 1', 'SSS 2', 'SSS 3'],
    exams: ['WASSCE', 'NECO SSCE', 'UTME (JAMB)', 'Post-UTME'],
    adminUnits: ['Lagos', 'Abuja FCT', 'Kano', 'Rivers', 'Oyo', 'Kaduna', 'Enugu', 'Delta', 'Ogun', 'Anambra'],
    defaultSubjects: ['General Mathematics', 'English Language', 'Physics', 'Chemistry', 'Biology', 'Financial Accounting', 'Commerce', 'Economics', 'Government', 'Civic Education'],
    currency: 'NGN',
    currencySymbol: '₦',
    examPrepMinGradeIndex: 3, // SSS 1
    passMarkPercent: 40, // placeholder internal gradebook threshold — confirm against real school convention
    nationalAverages: null, // populate once real WAEC/exam-board benchmark data is sourced
    status: 'live'
  },
  GH: {
    code: 'GH',
    name: 'Ghana',
    flag: '🇬🇭',
    badge: 'WASSCE / BECE',
    examBody: 'WAEC',
    systemName: 'WASSCE / BECE System',
    adminUnitLabel: 'Region',
    grades: ['JHS 1', 'JHS 2', 'JHS 3', 'SHS 1', 'SHS 2', 'SHS 3'],
    exams: ['WASSCE', 'BECE', 'Mid-Term Mocks'],
    adminUnits: ['Greater Accra', 'Ashanti', 'Western', 'Eastern', 'Central', 'Northern', 'Volta', 'Upper East', 'Bono'],
    defaultSubjects: ['Core Mathematics', 'Integrated Science', 'Social Studies', 'English Language', 'Elective Mathematics', 'Biology', 'Chemistry', 'Physics', 'Financial Accounting', 'Economics'],
    currency: 'GHS',
    currencySymbol: 'GH₵',
    examPrepMinGradeIndex: 3, // SHS 1
    passMarkPercent: 40,
    nationalAverages: null,
    status: 'live'
  },
  SL: {
    code: 'SL',
    name: 'Sierra Leone',
    flag: '🇸🇱',
    badge: 'WASSCE / BECE',
    examBody: 'WAEC',
    systemName: 'WASSCE / BECE / NPSE System',
    adminUnitLabel: 'District',
    grades: ['JSS 1', 'JSS 2', 'JSS 3', 'SSS 1', 'SSS 2', 'SSS 3'],
    exams: ['WASSCE', 'BECE', 'NPSE'],
    adminUnits: ['Western Area Urban', 'Western Area Rural', 'Bo', 'Kenema', 'Makeni', 'Port Loko', 'Kono', 'Bombali'],
    defaultSubjects: ['Core Mathematics', 'English Language', 'Integrated Science', 'Social Studies', 'Physics', 'Chemistry', 'Biology', 'Economics', 'Financial Accounting', 'Government'],
    currency: 'SLE',
    currencySymbol: 'Le',
    examPrepMinGradeIndex: 3, // SSS 1
    passMarkPercent: 40,
    nationalAverages: null,
    status: 'live'
  },
  GM: {
    code: 'GM',
    name: 'Gambia',
    flag: '🇬🇲',
    badge: 'WASSCE / GABECE',
    examBody: 'WAEC',
    systemName: 'WASSCE / GABECE System',
    adminUnitLabel: 'Region',
    grades: ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
    exams: ['WASSCE', 'GABECE'],
    adminUnits: ['Banjul', 'Kanifing', 'West Coast', 'North Bank', 'Lower River', 'Central River', 'Upper River'],
    defaultSubjects: ['Mathematics', 'English Language', 'Integrated Science', 'Social & Environmental Studies', 'Biology', 'Chemistry', 'Physics', 'Economics', 'Financial Accounting', 'Government & Civic Education'],
    currency: 'GMD',
    currencySymbol: 'D',
    examPrepMinGradeIndex: 3, // Grade 10
    passMarkPercent: 40,
    nationalAverages: null,
    status: 'live'
  },

  // --- Phase 2: not yet enrolling schools, kept here so the data model never needs to change shape ---
  KE: {
    code: 'KE',
    name: 'Kenya',
    flag: '🇰🇪',
    badge: 'KCSE / CBC',
    examBody: 'KNEC',
    systemName: 'CBC / 8-4-4 / KCSE System',
    adminUnitLabel: 'County',
    grades: ['Grade 7', 'Grade 8', 'Grade 9', 'Form 1', 'Form 2', 'Form 3', 'Form 4'],
    exams: ['KCSE', 'CATs', 'Joint Mocks'],
    adminUnits: ['Nairobi', 'Mombasa', 'Kiambu', 'Nakuru', 'Machakos', 'Uasin Gishu', 'Kisumu', 'Nyeri', 'Kilifi'],
    defaultSubjects: ['Mathematics', 'English', 'Kiswahili', 'Biology', 'Chemistry', 'Physics', 'History & Government', 'Geography', 'CRE', 'Business Studies'],
    currency: 'KES',
    currencySymbol: 'KSh',
    examPrepMinGradeIndex: 3, // Form 1
    passMarkPercent: 40,
    nationalAverages: null,
    status: 'coming_soon'
  },
  ZM: {
    code: 'ZM',
    name: 'Zambia',
    flag: '🇿🇲',
    badge: 'ECZ Grade 9/12',
    examBody: 'ECZ',
    systemName: 'ECZ System',
    adminUnitLabel: 'Province',
    grades: ['Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
    exams: ['ECZ Grade 9 Exam', 'ECZ Grade 12 Certificate', 'Provincial Mocks'],
    adminUnits: ['Lusaka', 'Copperbelt', 'Central', 'Southern', 'Eastern', 'Western', 'Northern', 'Luapula', 'Muchinga', 'North-Western'],
    defaultSubjects: ['Mathematics', 'English Language', 'Integrated Science', 'Biology', 'Chemistry', 'Physics', 'Commerce', 'Principles of Accounts', 'Civic Education', 'Geography'],
    currency: 'ZMW',
    currencySymbol: 'ZK',
    examPrepMinGradeIndex: 2, // Grade 10
    passMarkPercent: 40,
    nationalAverages: null,
    status: 'coming_soon'
  }
};

// Helpers every portal page should use instead of hardcoding logic
export function getCountry(code) {
  return AFRIACE_COUNTRIES[code] || null;
}

export function getLiveCountries() {
  return AFRIACE_LIVE_COUNTRIES.map(c => AFRIACE_COUNTRIES[c]);
}

export function getComingSoonCountries() {
  return AFRIACE_COMING_SOON.map(c => AFRIACE_COUNTRIES[c]);
}

export function getStoredCountry() {
  const code = localStorage.getItem('afriace_country');
  return code ? getCountry(code) : null;
}

export function setStoredCountry(code) {
  if (!AFRIACE_COUNTRIES[code]) return false;
  localStorage.setItem('afriace_country', code);
  document.documentElement.setAttribute('data-country', code);
  return true;
}
