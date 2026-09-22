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
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpleWd3cW94bGJ3d29wemJ1Z2RlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NjYwODQsImV4cCI6MjEwNTI0MjA4NH0.qguw1tk-F7B-3A8kt3TQUX_Aeh9afyO5ovTP_ZeW1Jw',
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

  /** Which portal file this signed-in user belongs on (e.g. 'teacher.html'). Falls back to student-portal.html if the role is unrecognized. */
  async getPortalFile() {
    const role = await this.getRole();
    return AFRIACE_PORTAL_FILES[role] || AFRIACE_PORTAL_FILES.student;
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

  /** Topics for a subject, optionally filtered to one level, ordered for term/unit grouping. */
  async getTopics(subjectId, levelId = null) {
    let query = sb.from('topics').select('*').eq('subject_id', subjectId)
      .order('unit_sort_order', { ascending: true, nullsFirst: true })
      .order('sort_order', { ascending: true, nullsFirst: true });
    if (levelId) query = query.eq('level_id', levelId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  /** Saves the onboarding wizard's picks to student_academic_profile. Upserts so it works whether the row already exists. The country/education-system/examination/syllabus-version are inherited from the school (per "school does not equal country" — students don't pick these themselves); level/subjects/goal are the student's own choice. */
  async saveStudentOnboarding(userId, { countryId, educationSystemId, examinationId, syllabusVersionId, levelId, subjectIds, dailyGoalQuestions }) {
    assertReady();
    const { data, error } = await sb
      .from('student_academic_profile')
      .upsert({
        user_id: userId,
        country_id: countryId,
        education_system_id: educationSystemId,
        examination_id: examinationId,
        syllabus_version_id: syllabusVersionId,
        level_id: levelId,
        subject_ids: subjectIds,
        daily_goal_questions: dailyGoalQuestions,
      }, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** A school may pin an exact syllabus_version, or leave it to "whichever is current" for that exam's curriculum — this resolves either case to one syllabus_version row. */
  async resolveDefaultSyllabusVersion(examConfig) {
    assertReady();
    if (examConfig.syllabus_version_id) {
      const { data, error } = await sb.from('syllabus_versions').select('*').eq('id', examConfig.syllabus_version_id).single();
      if (error) throw error;
      return data;
    }
    const { data: syllabuses, error: sylErr } = await sb.from('syllabuses').select('id').eq('curriculum_id', examConfig.curriculum_id);
    if (sylErr) throw sylErr;
    if (!syllabuses.length) return null;
    const { data, error } = await sb
      .from('syllabus_versions')
      .select('*')
      .in('syllabus_id', syllabuses.map(s => s.id))
      .eq('is_current', true)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Levels for an education system (e.g. SS1/SS2/SS3), for the onboarding wizard's grade picker. */
  async getLevels(educationSystemId) {
    assertReady();
    const { data, error } = await sb
      .from('levels')
      .select('*')
      .eq('education_system_id', educationSystemId)
      .order('sort_order');
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

  /** Cross-subject search for the Topic Question Bank tool — scoped to the student's own picked subjects, never the whole global bank across countries. */
  async searchQuestions(subjectIds, { search = '', limit = 30 } = {}) {
    assertReady();
    if (!subjectIds?.length) return [];
    let query = sb.from('questions').select('*, subjects(name), topics(title)').in('subject_id', subjectIds).limit(limit);
    if (search) query = query.ilike('question_text', `%${search}%`);
    const { data, error } = await query;
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

// ---------- GAMIFICATION / SOCIAL / LIBRARY / REMINDERS ----------
// Covers Home's stats row + Recent Activity, Progress's leaderboard,
// Library, and Profile's notification toggles — all real MatricAce
// features that Phase 1 stubbed out.

const AfriAceData = {
  async getStreak(userId) {
    assertReady();
    const { data, error } = await sb.from('user_streaks').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async getXp(userId) {
    assertReady();
    const { data, error } = await sb.from('student_xp').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Total questions answered + overall average score %, from sessions. Powers Home's stats row. */
  async getStudentStatsSummary(userId) {
    assertReady();
    const { data, error } = await sb.from('sessions').select('score, total').eq('user_id', userId);
    if (error) throw error;
    const questionsDone = (data || []).reduce((sum, s) => sum + (s.total || 0), 0);
    const scoreSum = (data || []).reduce((sum, s) => sum + (s.score || 0), 0);
    const avgScorePct = questionsDone > 0 ? Math.round((scoreSum / questionsDone) * 100) : null;
    return { questionsDone, avgScorePct };
  },

  /** How many questions this student has answered today, against their daily goal. */
  async getTodayQuestionCount(userId) {
    assertReady();
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const { data, error } = await sb.from('sessions').select('total').eq('user_id', userId).gte('started_at', startOfDay.toISOString());
    if (error) throw error;
    return (data || []).reduce((sum, s) => sum + (s.total || 0), 0);
  },

  /** Average mastery_pct per subject, from the progress table (one row per topic) — powers Home's subject mastery bars. */
  async getSubjectMastery(userId, subjectIds) {
    assertReady();
    if (!subjectIds?.length) return {};
    const { data, error } = await sb.from('progress').select('subject_id, mastery_pct').eq('user_id', userId).in('subject_id', subjectIds);
    if (error) throw error;
    const bySubject = {};
    for (const row of data || []) {
      if (!bySubject[row.subject_id]) bySubject[row.subject_id] = [];
      bySubject[row.subject_id].push(row.mastery_pct || 0);
    }
    const result = {};
    for (const id of subjectIds) {
      const vals = bySubject[id];
      result[id] = vals?.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : 0;
    }
    return result;
  },

  async submitWellnessCheckin(userId, mood, note = null) {
    assertReady();
    const { data, error } = await sb.from('wellness_checkins').insert({ student_id: userId, mood, note }).select().single();
    if (error) throw error;
    return data;
  },

  async getContinuousAssessmentMarks(userId) {
    assertReady();
    const { data, error } = await sb.from('continuous_assessment_marks').select('*, subjects(name)').eq('student_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async addContinuousAssessmentMark(userId, schoolId, { subjectId, term, component, score, maxScore }) {
    assertReady();
    const { data, error } = await sb.from('continuous_assessment_marks').insert({
      student_id: userId, school_id: schoolId, subject_id: subjectId, term, component, score, max_score: maxScore,
      source: 'self_reported',
    }).select().single();
    if (error) throw error;
    return data;
  },

  async getExamTimetables(schoolId) {
    assertReady();
    const { data, error } = await sb.from('exam_timetables').select('*').eq('school_id', schoolId).order('updated_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getNotes(userId) {
    assertReady();
    const { data, error } = await sb.from('student_notes').select('*, subjects(name)').eq('user_id', userId).order('updated_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async saveNote(userId, { id = null, subjectId = null, title, body }) {
    assertReady();
    const row = { user_id: userId, subject_id: subjectId, title, body, updated_at: new Date().toISOString() };
    if (id) {
      const { data, error } = await sb.from('student_notes').update(row).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await sb.from('student_notes').insert(row).select().single();
    if (error) throw error;
    return data;
  },

  async deleteNote(id) {
    assertReady();
    const { error } = await sb.from('student_notes').delete().eq('id', id);
    if (error) throw error;
  },

  async getApplications(userId) {
    assertReady();
    const { data, error } = await sb.from('applications').select('*').eq('student_id', userId).order('deadline', { ascending: true });
    if (error) throw error;
    return data;
  },

  async addApplication(userId, { institution, programme, deadline, financialAidNote }) {
    assertReady();
    const { data, error } = await sb.from('applications').insert({
      student_id: userId, institution, programme, deadline, notes: financialAidNote, status: 'draft',
    }).select().single();
    if (error) throw error;
    return data;
  },

  /** Goes through the join-class edge function — never a direct client insert (see that function's comments for why). */
  async joinClassByCode(classCode) {
    assertReady();
    const session = await AfriAceAuth.getSession();
    const res = await fetch(`${AFRIACE_CONFIG.supabaseUrl}/functions/v1/join-class`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ classCode }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error || `join-class failed (${res.status})`);
    return body;
  },

  async getMyClassId(userId) {
    assertReady();
    const { data, error } = await sb.from('school_students').select('class_id').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data?.class_id ?? null;
  },

  async getClassStream(classId) {
    assertReady();
    const { data, error } = await sb.from('class_stream').select('*, users:posted_by(full_name)').eq('class_id', classId).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getLiveSessions(classId) {
    assertReady();
    const { data, error } = await sb.from('live_sessions').select('*').eq('class_id', classId).order('starts_at', { ascending: false }).limit(5);
    if (error) throw error;
    return data;
  },

  async getMyStudyGroups(userId) {
    assertReady();
    const { data, error } = await sb.from('study_group_members').select('group_id, study_groups(*)').eq('user_id', userId);
    if (error) throw error;
    return (data || []).map(r => r.study_groups).filter(Boolean);
  },

  async discoverStudyGroups(subjectId = null) {
    assertReady();
    let query = sb.from('study_groups').select('*').order('created_at', { ascending: false }).limit(20);
    if (subjectId) query = query.eq('subject_id', subjectId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async createStudyGroup(userId, name, subjectId) {
    assertReady();
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data, error } = await sb.from('study_groups').insert({ name, subject_id: subjectId, created_by: userId, group_code: code }).select().single();
    if (error) throw error;
    await sb.from('study_group_members').insert({ group_id: data.id, user_id: userId });
    return data;
  },

  async joinStudyGroupByCode(userId, code) {
    assertReady();
    const { data: group, error } = await sb.from('study_groups').select('*').eq('group_code', code.toUpperCase()).maybeSingle();
    if (error) throw error;
    if (!group) throw new Error('No group found with that code.');
    const { error: joinErr } = await sb.from('study_group_members').insert({ group_id: group.id, user_id: userId });
    if (joinErr) throw joinErr;
    return group;
  },

  async getGroupMemberCount(groupId) {
    assertReady();
    const { count, error } = await sb.from('study_group_members').select('*', { count: 'exact', head: true }).eq('group_id', groupId);
    if (error) throw error;
    return count ?? 0;
  },

  // ---------- FLASHCARDS (spaced repetition over existing questions) ----------
  async getDueFlashcards(userId, subjectIds, limit = 20) {
    assertReady();
    // Questions due: either never reviewed (no flashcard_reviews row) or next_review_date <= today.
    const { data: reviews, error: revErr } = await sb.from('flashcard_reviews').select('*').eq('user_id', userId);
    if (revErr) throw revErr;
    const reviewMap = Object.fromEntries((reviews || []).map(r => [r.question_id, r]));
    const today = new Date().toISOString().slice(0, 10);

    const { data: questions, error } = await sb.from('questions').select('*, subjects(name)').in('subject_id', subjectIds).limit(200);
    if (error) throw error;

    const due = questions.filter(q => {
      const r = reviewMap[q.id];
      return !r || r.next_review_date <= today;
    }).slice(0, limit);
    return due.map(q => ({ ...q, review: reviewMap[q.id] || null }));
  },

  async recordFlashcardResult(userId, questionId, gotIt) {
    assertReady();
    const { data: existing } = await sb.from('flashcard_reviews').select('*').eq('user_id', userId).eq('question_id', questionId).maybeSingle();
    const streak = gotIt ? (existing?.streak ?? 0) + 1 : 0;
    const intervalDays = gotIt ? Math.min((existing?.interval_days ?? 1) * 2, 60) : 1;
    const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + intervalDays);
    const { error } = await sb.from('flashcard_reviews').upsert({
      user_id: userId, question_id: questionId, streak, interval_days: intervalDays,
      next_review_date: nextDate.toISOString().slice(0, 10),
    }, { onConflict: 'user_id,question_id' });
    if (error) throw error;
  },

  async getFlashcardStats(userId, subjectIds) {
    assertReady();
    const due = await this.getDueFlashcards(userId, subjectIds, 500);
    const { data: mastered, error } = await sb.from('flashcard_reviews').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('streak', 3);
    if (error) throw error;
    return { dueToday: due.length, mastered: mastered?.length ?? 0 };
  },

  // ---------- FORMULA SHEET (aggregated from subject_notes, not a separate content table) ----------
  async getSubjectFormulas(subjectId) {
    assertReady();
    const { data: topics, error: tErr } = await sb.from('topics').select('id, title').eq('subject_id', subjectId);
    if (tErr) throw tErr;
    if (!topics.length) return [];
    const { data: notes, error } = await sb.from('subject_notes').select('topic_id, formulas').in('topic_id', topics.map(t => t.id));
    if (error) throw error;
    const topicTitle = Object.fromEntries(topics.map(t => [t.id, t.title]));
    return notes.filter(n => n.formulas?.length).map(n => ({ topic: topicTitle[n.topic_id], formulas: n.formulas }));
  },

  // ---------- STUDY PLANNER ----------
  async getTasks(userId, dateStr) {
    assertReady();
    const { data, error } = await sb.from('study_tasks').select('*, subjects(name)').eq('user_id', userId).eq('due_date', dateStr).order('created_at');
    if (error) throw error;
    return data;
  },

  async addTask(userId, { title, subjectId, dueDate }) {
    assertReady();
    const { data, error } = await sb.from('study_tasks').insert({ user_id: userId, title, subject_id: subjectId, due_date: dueDate }).select().single();
    if (error) throw error;
    return data;
  },

  async toggleTask(id, done) {
    assertReady();
    const { error } = await sb.from('study_tasks').update({ done }).eq('id', id);
    if (error) throw error;
  },

  // ---------- CLASS DUEL (async — see honest note in the UI about why it's not live head-to-head) ----------
  async createDuel(classId, subjectId, challengerId) {
    assertReady();
    const { data, error } = await sb.from('class_duels').insert({ class_id: classId, subject_id: subjectId, challenger_id: challengerId, status: 'pending' }).select().single();
    if (error) throw error;
    return data;
  },

  async getMyDuels(userId) {
    assertReady();
    const { data, error } = await sb.from('class_duels').select('*, subjects(name)').or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async submitDuelScore(duelId, userId, score, isChallenger) {
    assertReady();
    const { data: duel, error: fetchErr } = await sb.from('class_duels').select('*').eq('id', duelId).single();
    if (fetchErr) throw fetchErr;
    const scoreJson = { ...(duel.score_json || {}), [isChallenger ? 'challenger' : 'opponent']: score };
    const bothIn = scoreJson.challenger != null && scoreJson.opponent != null;
    const { error } = await sb.from('class_duels').update({ score_json: scoreJson, status: bothIn ? 'completed' : 'active' }).eq('id', duelId);
    if (error) throw error;
  },

  // ---------- LIVE QUIZ (student join side) ----------
  async joinLiveQuizByCode(userId, code) {
    assertReady();
    const { data: session, error } = await sb.from('live_quiz_sessions').select('*').eq('join_code', code.toUpperCase()).maybeSingle();
    if (error) throw error;
    if (!session) throw new Error('No live quiz found with that code.');
    const { error: joinErr } = await sb.from('live_quiz_participants').upsert({ session_id: session.id, user_id: userId, score: 0 }, { onConflict: 'session_id,user_id' });
    if (joinErr) throw joinErr;
    return session;
  },

  subscribeToLiveQuiz(sessionId, onUpdate) {
    assertReady();
    return sb.channel('live-quiz-' + sessionId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_quiz_sessions', filter: `id=eq.${sessionId}` }, onUpdate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_quiz_participants', filter: `session_id=eq.${sessionId}` }, onUpdate)
      .subscribe();
  },

  /** Same-school leaderboard, ordered by XP — needs the school-read policy added in 006_ui_review_patches.sql. */
  async getLeaderboard(schoolId, limit = 5) {
    assertReady();
    const { data, error } = await sb
      .from('student_xp')
      .select('user_id, total_xp, level, users!inner(full_name, school_id)')
      .eq('users.school_id', schoolId)
      .order('total_xp', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async getRecentSessions(userId, limit = 5) {
    assertReady();
    const { data, error } = await sb
      .from('sessions')
      .select('*, subjects(name)')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async getLibraryResources(subjectId = null) {
    assertReady();
    let query = sb.from('library_resources').select('*').order('created_at', { ascending: false });
    if (subjectId) query = query.eq('subject_id', subjectId);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async getForumPosts(limit = 20) {
    assertReady();
    const { data, error } = await sb.from('forum_posts').select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data;
  },

  async getReminderPrefs(userId) {
    assertReady();
    const { data, error } = await sb.from('reminder_prefs').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async setReminderPrefs(userId, prefs) {
    assertReady();
    const { data, error } = await sb
      .from('reminder_prefs')
      .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// ---------- ROLE -> PORTAL ROUTING ----------
// The real MatricAce login screen is a single shared gate: Student vs
// Staff tabs, and Staff further auto-detects School Admin / Teacher /
// Subject Teacher / Super Admin from the signed-in account and routes
// to that portal's own file. This map is what that routing uses once
// the other four portal files exist alongside this one.
const AFRIACE_PORTAL_FILES = {
  student: 'student-portal.html',
  teacher: 'teacher.html',
  subject_teacher: 'subject-teacher.html',
  school_admin: 'school-admin.html',
  super_admin: 'super-admin.html',
};


window.sb = sb;
window.AFRIACE_LOAD_ERROR = AFRIACE_LOAD_ERROR;
window.AFRIACE_PORTAL_FILES = AFRIACE_PORTAL_FILES;
window.AfriAceAuth = AfriAceAuth;
window.AfriAceUser = AfriAceUser;
window.AfriAceAcademic = AfriAceAcademic;
window.AfriAceData = AfriAceData;
window.AfriAceAI = AfriAceAI;
