// =============================================================
// AfriAce shared client — afriace-client.js
// =============================================================
// Included by every portal (student-portal.html, teacher.html,
// subject-teacher.html, school-admin.html, super-admin.html) via:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="afriace-client.js"></script>
//
// Fixes the MatricAce audit finding that 4 of 5 dashboards called
// Supabase REST directly with the anon key as the bearer token
// (no real user session). Every portal now goes through ONE
// supabase-js client with a genuine authenticated session, which is
// what the RLS policies in 005_rls_policies.sql actually check
// against (auth.uid()) — bypass this file and RLS has nothing to key
// off, so no portal should hand-roll its own fetch() calls anymore.
// =============================================================

const AFRIACE_CONFIG = {
  supabaseUrl: 'https://zeygwqoxlbwwopzbugde.supabase.co',
  // Anon key is safe to ship client-side by design — it identifies the
  // project, not a user. Replace with the real key from
  // Project Settings > API before deploying. Never put the service_role
  // key here or in any frontend file.
  supabaseAnonKey: 'REPLACE_WITH_AFRIACE_ANON_KEY',
};

let sb = null;
let AFRIACE_LOAD_ERROR = null;

try {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase library failed to load (check your internet connection or ad-blocker).');
  }
  sb = window.supabase.createClient(
    AFRIACE_CONFIG.supabaseUrl,
    AFRIACE_CONFIG.supabaseAnonKey,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );
} catch (err) {
  AFRIACE_LOAD_ERROR = err;
  console.error('AfriAce client failed to initialize:', err);
}

function assertReady() {
  if (!sb) throw AFRIACE_LOAD_ERROR || new Error('AfriAce client is not ready.');
}

// ---------- SESSION / AUTH ----------
// Matches MatricAce's actual login UI: email/username + password, with a
// separate "forgot password" reset flow — not an OTP-code login screen.
// (OTP infrastructure in the MatricAce audit is used for password-reset
// verification, not primary sign-in — corrected here after comparing
// against the real production login screen.)

const AfriAceAuth = {
  async signIn(email, password) {
    assertReady();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  },

  /** Sends a password-reset email (Supabase Auth's built-in flow). */
  async requestPasswordReset(email) {
    assertReady();
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) throw error;
  },

  async signOut() {
    assertReady();
    await sb.auth.signOut();
  },

  /** Returns the current Supabase Auth session, or null if signed out. */
  async getSession() {
    assertReady();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  /** Fires cb(session) on sign-in, sign-out, and token refresh. */
  onAuthChange(cb) {
    assertReady();
    sb.auth.onAuthStateChange((_event, session) => cb(session));
  },
};

// ---------- CURRENT USER / ROLE ----------
// Mirrors the RLS helper functions (app_current_role, app_current_school_id)
// so the frontend's notion of "who am I" always matches what the database
// will actually enforce — no separate, driftable source of truth.

const AfriAceUser = {
  _cache: null,

  /** Row from `users` for the signed-in auth user. Cached per session. */
  async getProfile(force = false) {
    assertReady();
    if (this._cache && !force) return this._cache;
    const { data: auth } = await sb.auth.getUser();
    if (!auth?.user) return null;
    const { data, error } = await sb
      .from('users')
      .select('*')
      .eq('id', auth.user.id)
      .single();
    if (error) throw error;
    this._cache = data;
    return data;
  },

  async getRole() {
    const profile = await this.getProfile();
    return profile?.role ?? null;
  },

  async getSchoolId() {
    const profile = await this.getProfile();
    return profile?.school_id ?? null;
  },

  /**
   * Call at the top of each portal's init to enforce the expected role,
   * e.g. requireRole(['teacher']) on teacher.html. Redirects home if the
   * signed-in user's role doesn't match — a UX guard, NOT the security
   * boundary (RLS is). Never rely on this alone.
   */
  async requireRole(allowedRoles, redirectTo = 'index.html') {
    const role = await this.getRole();
    if (!role || !allowedRoles.includes(role)) {
      window.location.href = redirectTo;
      return false;
    }
    return true;
  },
};

// ---------- ACADEMIC CONTEXT ----------
// Replaces MatricAce's hardcoded `SUBJECTS` object. Every academic query
// now resolves through the school's or student's actual configured
// country -> examination -> syllabus_version chain, so a Nigerian/WASSCE
// student and a Ghanaian/WASSCE student naturally see different content
// even though they're on the same exam code, per the brief's
// "school does not equal country" principle.

const AfriAceAcademic = {
  /** A school's pinned country/exam/curriculum config (may be more than one row if the school runs multiple exams, e.g. WASSCE + NECO). */
  async getSchoolAcademicConfig(schoolId) {
    assertReady();
    const { data, error } = await sb
      .from('school_academic_config')
      .select('*, countries(*), education_systems(*), examinations(*), curricula(*)')
      .eq('school_id', schoolId);
    if (error) throw error;
    return data;
  },

  /** A student's own academic profile (country/exam/syllabus_version/level/subjects). */
  async getStudentProfile(userId) {
    const { data, error } = await sb
      .from('student_academic_profile')
      .select('*, countries(*), examinations(*), syllabus_versions(*), levels(*)')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Subjects available under a given syllabus_version (replaces the hardcoded subject list scattered across MatricAce's files). */
  async getSubjects(syllabusVersionId) {
    const { data, error } = await sb
      .from('subjects')
      .select('*')
      .eq('syllabus_version_id', syllabusVersionId)
      .order('name');
    if (error) throw error;
    return data;
  },

  /** Topics for a subject, optionally filtered to one level. */
  async getTopics(subjectId, levelId = null) {
    let query = sb.from('topics').select('*').eq('subject_id', subjectId).order('sort_order');
    if (levelId) query = query.eq('level_id', levelId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  /** The subject_notes row for a topic — the AI-authored (or later, teacher-verified) study content. */
  async getSubjectNotes(topicId) {
    const { data, error } = await sb
      .from('subject_notes')
      .select('*')
      .eq('topic_id', topicId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Practice questions for a subject, correctly scoped so a student never
   * gets another country's questions for the "same" exam code (the brief's
   * explicit Nigeria/WASSCE-vs-Kenya/KCSE concern, generalized to
   * Nigeria/WASSCE-vs-Ghana/WASSCE too).
   */
  async getQuestions(subjectId, { topicId = null, difficulty = null, limit = 20 } = {}) {
    let query = sb.from('questions').select('*').eq('subject_id', subjectId);
    if (topicId) query = query.eq('topic_id', topicId);
    if (difficulty) query = query.eq('difficulty', difficulty);
    const { data, error } = await query.limit(limit);
    if (error) throw error;
    return data;
  },
};

// ---------- AI PROXY ----------
// Same pattern as MatricAce: never call Anthropic directly from the
// client. Route through a Supabase Edge Function that holds the real
// API key server-side.

const AfriAceAI = {
  async ask(tool, payload) {
    assertReady();
    const session = await AfriAceAuth.getSession();
    const res = await fetch(`${AFRIACE_CONFIG.supabaseUrl}/functions/v1/anthropic-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ tool, ...payload }),
    });
    if (!res.ok) throw new Error(`AI proxy error: ${res.status}`);
    return res.json();
  },
};

window.sb = sb;
window.AFRIACE_LOAD_ERROR = AFRIACE_LOAD_ERROR;
window.AfriAceAuth = AfriAceAuth;
window.AfriAceUser = AfriAceUser;
window.AfriAceAcademic = AfriAceAcademic;
window.AfriAceAI = AfriAceAI;
