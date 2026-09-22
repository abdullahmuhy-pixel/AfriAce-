// =============================================================
// AfriAce learning engine — afriace-learning.js
// =============================================================
// Part 1 (AfriAceLearning): pure logic. No DOM, no network. Tested in Node.
// Part 2 (AfriAceLearningDB): thin Supabase calls through the shared
//   window.sb client from afriace-client.js. Needs migration 013 + seed 014.
//
// Include after afriace-client.js:
//   <script src="afriace-client.js"></script>
//   <script src="afriace-learning.js"></script>
// =============================================================
(function (root) {
  'use strict';

  const L = {};

  L.CONFIG = {
    QUICK_QUESTIONS: 10,        // questions in a quick quiz
    SECONDS_PER_MCQ: 60,        // timed-quiz fallback when the exam format has no verified question count
    MIN_ATTEMPTS: 5,            // attempts needed before a topic can be called weak or strong
    STRONG_PCT: 70,             // mastery bands (same 70 / 50 thresholds as MatricAce's progress colours)
    DEVELOPING_PCT: 50,
    THEORY_PASS_FRACTION: 0.5,  // a self-marked theory answer counts as correct at 50% of the marks
    FREE_THEORY_DEFAULT: 3,     // free daily theory allowance if platform_config has no value
    LABELS: ['A', 'B', 'C', 'D', 'E', 'F'],
  };

  // ---------------- randomness ----------------
  L.shuffle = function (arr, rng) {
    rng = rng || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Deterministic random source for tests.
  L.seededRng = function (seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ---------------- question selection ----------------
  // Never repeats a question inside one quiz. Prefers questions the student has not seen recently.
  L.selectQuestions = function (pool, opts) {
    opts = opts || {};
    const count = opts.count == null ? L.CONFIG.QUICK_QUESTIONS : opts.count;
    const types = opts.types || null;
    const exclude = new Set(opts.excludeIds || []);
    const seen = new Set();
    const eligible = [];
    for (const q of pool || []) {
      if (!q || seen.has(q.id)) continue;
      seen.add(q.id);
      if (opts.topicId && q.topic_id !== opts.topicId) continue;
      if (opts.subtopicId && q.subtopic_id !== opts.subtopicId) continue;
      if (opts.difficulty && q.difficulty !== opts.difficulty) continue;
      if (types && !types.includes(q.question_type)) continue;
      eligible.push(q);
    }
    const fresh = L.shuffle(eligible.filter(q => !exclude.has(q.id)), opts.rng);
    const stale = L.shuffle(eligible.filter(q => exclude.has(q.id)), opts.rng);
    return fresh.concat(stale).slice(0, count);
  };

  // Shuffles the ORDER of the options but keeps each option's original key, so what is saved
  // (selected_answer) still matches questions.correct_answer in the database.
  L.shuffleOptions = function (q, rng) {
    if (!Array.isArray(q.options) || !q.options.length) return q;
    const shuffled = L.shuffle(q.options, rng).map((o, i) => Object.assign({}, o, { label: L.CONFIG.LABELS[i] || String(i + 1) }));
    return Object.assign({}, q, { options: shuffled });
  };

  L.isMcq = function (q) { return q.question_type === 'mcq' || q.question_type === 'true_false'; };
  L.isTheory = function (q) { return q.question_type === 'structured' || q.question_type === 'essay'; };

  // ---------------- timing ----------------
  // Uses the exam format when it has BOTH a duration and a verified question count; otherwise a flat rate.
  L.timedSeconds = function (format, questionCount) {
    if (format && format.duration_minutes && format.question_count) {
      return Math.round(format.duration_minutes * 60 * questionCount / format.question_count);
    }
    return questionCount * L.CONFIG.SECONDS_PER_MCQ;
  };

  // Mock exam: exam-format duration, no repeated questions. If the bank is too small the paper is shorter
  // and `shortfall` says by how much (it never pads with repeats).
  L.buildMock = function (pool, format, opts) {
    opts = opts || {};
    const mcqPool = (pool || []).filter(L.isMcq);
    const wanted = (format && format.question_count) || opts.defaultCount || 20;
    const questions = L.selectQuestions(mcqPool, { count: wanted, excludeIds: opts.excludeIds, rng: opts.rng });
    const seconds = format && format.duration_minutes
      ? (format.question_count ? Math.round(format.duration_minutes * 60 * questions.length / format.question_count) : format.duration_minutes * 60)
      : questions.length * L.CONFIG.SECONDS_PER_MCQ;
    return {
      questions: questions.map(q => L.shuffleOptions(q, opts.rng)),
      seconds,
      shortfall: Math.max(0, wanted - questions.length),
      countVerified: !!(format && format.question_count),
    };
  };

  // ---------------- scoring: multiple choice ----------------
  // answers: { [question_id]: { key: 'B', seconds: 12 } }   (missing = skipped)
  L.scoreMcq = function (questions, answers) {
    answers = answers || {};
    const events = [], review = [];
    const perTopic = {}, perDifficulty = {};
    let correct = 0, skipped = 0;
    for (const q of questions) {
      const a = answers[q.id];
      const isSkipped = !a || a.key == null;
      const isCorrect = !isSkipped && a.key === q.correct_answer;
      if (isCorrect) correct++;
      if (isSkipped) skipped++;
      events.push({
        question_id: q.id,
        selected_answer: isSkipped ? null : a.key,
        is_correct: isSkipped ? null : isCorrect,
        is_skipped: isSkipped,
        time_taken_seconds: a && a.seconds != null ? Math.round(a.seconds) : null,
      });
      if (!isSkipped) {
        const tk = q.topic_id || 'none';
        perTopic[tk] = perTopic[tk] || { attempted: 0, correct: 0 };
        perTopic[tk].attempted++; if (isCorrect) perTopic[tk].correct++;
        const dk = q.difficulty || 'medium';
        perDifficulty[dk] = perDifficulty[dk] || { attempted: 0, correct: 0 };
        perDifficulty[dk].attempted++; if (isCorrect) perDifficulty[dk].correct++;
      }
      if (!isCorrect) {
        const opts = Array.isArray(q.options) ? q.options : [];
        const chosen = opts.find(o => !isSkipped && o.key === a.key);
        const right = opts.find(o => o.key === q.correct_answer);
        review.push({
          question_id: q.id, topic_id: q.topic_id || null, question_text: q.question_text,
          status: isSkipped ? 'skipped' : 'wrong',
          selected: chosen ? { key: chosen.key, label: chosen.label || chosen.key, text: chosen.text } : null,
          correct: right ? { key: right.key, label: right.label || right.key, text: right.text } : { key: q.correct_answer, label: q.correct_answer, text: '' },
          explanation: q.explanation || '',
        });
      }
    }
    const total = questions.length;
    return {
      total, correct, wrong: total - correct - skipped, skipped,
      percent: total ? Math.round(1000 * correct / total) / 10 : 0,
      events, review, perTopic, perDifficulty,
    };
  };

  // ---------------- scoring: theory self-marking ----------------
  // rubric: [{ text, mark }]   awarded: array of marks the student gave themselves, one per rubric line
  L.scoreTheory = function (rubric, awarded) {
    rubric = rubric || []; awarded = awarded || [];
    const lines = rubric.map((r, i) => {
      const max = Number(r.mark) || 0;
      const given = Math.min(max, Math.max(0, Number(awarded[i]) || 0));
      return { mark: max, awarded: given };
    });
    const available = lines.reduce((s, l) => s + l.mark, 0);
    const got = lines.reduce((s, l) => s + l.awarded, 0);
    return {
      self_marks: lines,
      marks_awarded: got,
      marks_available: available,
      percent: available ? Math.round(1000 * got / available) / 10 : 0,
      is_correct: available > 0 && got >= available * L.CONFIG.THEORY_PASS_FRACTION,
    };
  };

  // ---------------- mastery, weak topics, recommendations ----------------
  L.masteryBand = function (pct, attempts) {
    if (!attempts || attempts < L.CONFIG.MIN_ATTEMPTS) return 'insufficient';
    if (pct >= L.CONFIG.STRONG_PCT) return 'strong';
    if (pct >= L.CONFIG.DEVELOPING_PCT) return 'developing';
    return 'weak';
  };

  // rows: [{ topic_id, mastery_pct, questions_attempted }] (from progress). Weakest first.
  L.weakTopics = function (rows) {
    return (rows || [])
      .filter(r => L.masteryBand(Number(r.mastery_pct), r.questions_attempted) === 'weak')
      .sort((a, b) => Number(a.mastery_pct) - Number(b.mastery_pct));
  };

  // Recommended next steps for the weakest topics: review the lesson, do a targeted quiz, revise flashcards.
  L.recommend = function (weakRows, opts) {
    opts = opts || {};
    const limit = opts.limit || 3;
    const hasCards = new Set(opts.topicIdsWithFlashcards || []);
    const out = [];
    for (const w of (weakRows || []).slice(0, limit)) {
      const steps = [{ type: 'review_lesson', topic_id: w.topic_id }, { type: 'targeted_quiz', topic_id: w.topic_id }];
      if (hasCards.has(w.topic_id)) steps.push({ type: 'flashcards', topic_id: w.topic_id });
      out.push({ topic_id: w.topic_id, mastery_pct: Number(w.mastery_pct), attempts: w.questions_attempted, steps });
    }
    return out;
  };

  // Difficulty breakdown for a results screen, e.g. Easy 92%.
  L.difficultyBreakdown = function (perDifficulty) {
    const order = ['easy', 'medium', 'hard', 'exam_level'];
    return order.filter(k => perDifficulty[k]).map(k => ({
      difficulty: k, attempted: perDifficulty[k].attempted, correct: perDifficulty[k].correct,
      percent: Math.round(100 * perDifficulty[k].correct / perDifficulty[k].attempted),
    }));
  };

  // ---------------- free / premium ----------------
  L.theoryAllowance = function (o) {
    if (o.isPremium) return { allowed: true, remaining: null, unlimited: true };
    const limit = o.limit == null ? L.CONFIG.FREE_THEORY_DEFAULT : o.limit;
    const remaining = Math.max(0, limit - (o.usedToday || 0));
    return { allowed: remaining > 0, remaining, unlimited: false };
  };

  // Free: multiple-choice quizzes, lessons, flashcards, weak-topic list. Premium: mock exams, topic percentages,
  // unlimited theory. Same split as MatricAce, without the ad gates.
  L.canUse = function (feature, o) {
    o = o || {};
    if (o.isPremium) return true;
    return ['quiz', 'topic_quiz', 'timed_quiz', 'flashcards', 'lessons', 'review'].includes(feature);
  };

  // ---------------- topic and level scoping ----------------
  // A topic with no level spans all levels. A topic with a level is shown only to that level.
  L.filterTopicsForLevel = function (topics, levelId) {
    if (!levelId) return topics.slice();
    return topics.filter(t => !t.level_id || t.level_id === levelId);
  };

  // Guard used before rendering: refuses to show content that belongs to a different subject
  // (subjects are per exam syllabus version, so this is what keeps WAEC, NECO and JAMB apart).
  L.assertScope = function (items, allowedSubjectIds) {
    const ok = new Set(allowedSubjectIds);
    const bad = (items || []).filter(i => !ok.has(i.subject_id));
    if (bad.length) throw new Error('Content from another subject or exam was blocked (' + bad.length + ' item(s)).');
    return items;
  };

  // Group topics under their unit label, in order.
  L.groupByUnit = function (topics) {
    const groups = [];
    for (const t of topics) {
      const label = t.unit_label || 'Topics';
      let g = groups.find(x => x.label === label);
      if (!g) { g = { label, topics: [] }; groups.push(g); }
      g.topics.push(t);
    }
    return groups;
  };

  // ---------------- flashcards: SM-2 spaced repetition ----------------
  function ymd(d) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  L.sm2 = function (state, rating, today) {
    const map = { again: 1, hard: 3, good: 4, easy: 5 };
    const q = map[rating];
    if (q == null) throw new Error('Unknown rating: ' + rating);
    let ease = state && state.ease_factor != null ? Number(state.ease_factor) : 2.5;
    let reps = state && state.repetitions ? state.repetitions : 0;
    let interval = state && state.interval_days ? state.interval_days : 0;
    if (q < 3) { reps = 0; interval = 1; }
    else {
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 6;
      else interval = Math.round(interval * ease);
    }
    ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    const base = today ? new Date(today + 'T00:00:00') : new Date();
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + interval);
    return { ease_factor: Math.round(ease * 100) / 100, repetitions: reps, interval_days: interval, next_review_date: ymd(next),
             streak: q >= 3 ? ((state && state.streak) || 0) + 1 : 0 };
  };

  L.formatTime = function (sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  };

  // =============================================================
  // Part 2: database layer (browser only)
  // =============================================================
  const DB = {};
  function sbc() {
    if (!root.sb) throw new Error('Supabase client not ready (afriace-client.js must load first).');
    return root.sb;
  }
  function unwrap(res) { if (res.error) throw res.error; return res.data; }

  // Topics for a subject, with the correct level rule (a topic with no level spans all levels).
  DB.getTopics = async function (subjectId, levelId) {
    const data = unwrap(await sbc().from('topics').select('*').eq('subject_id', subjectId)
      .order('unit_sort_order', { ascending: true, nullsFirst: true })
      .order('sort_order', { ascending: true, nullsFirst: true }));
    return L.filterTopicsForLevel(data, levelId);
  };

  // Current subjects of one examination (its own syllabus version only).
  DB.getSubjectsForExamination = async function (examinationId) {
    const c = unwrap(await sbc().from('curricula').select('id').eq('examination_id', examinationId));
    if (!c.length) return [];
    const sy = unwrap(await sbc().from('syllabuses').select('id').in('curriculum_id', c.map(x => x.id)));
    if (!sy.length) return [];
    const v = unwrap(await sbc().from('syllabus_versions').select('id').in('syllabus_id', sy.map(x => x.id)).eq('is_current', true));
    if (!v.length) return [];
    return unwrap(await sbc().from('subjects').select('*, canonical_subjects(name)').in('syllabus_version_id', v.map(x => x.id)).order('name'));
  };

  DB.getExaminations = async function (educationSystemId) {
    return unwrap(await sbc().from('examinations').select('*').eq('education_system_id', educationSystemId).order('code'));
  };

  DB.getQuestionPool = async function (subjectId, o) {
    o = o || {};
    let q = sbc().from('questions').select('*').eq('subject_id', subjectId);
    if (o.topicId) q = q.eq('topic_id', o.topicId);
    if (o.types) q = q.in('question_type', o.types);
    return unwrap(await q.limit(o.limit || 300));
  };

  DB.getQuestionsByIds = async function (ids) {
    if (!ids.length) return [];
    return unwrap(await sbc().from('questions').select('*').in('id', ids));
  };

  DB.getExamFormats = async function (subjectId) {
    return unwrap(await sbc().from('exam_formats').select('*').eq('subject_id', subjectId).order('paper_no'));
  };

  DB.getFlashcards = async function (topicIds) {
    if (!topicIds.length) return [];
    return unwrap(await sbc().from('flashcards').select('*').in('topic_id', topicIds));
  };

  DB.getDueFlashcards = async function (userId, topicIds, today) {
    const cards = await DB.getFlashcards(topicIds);
    if (!cards.length) return [];
    const reviews = unwrap(await sbc().from('flashcard_reviews').select('*').eq('user_id', userId).in('flashcard_id', cards.map(c => c.id)));
    const byCard = new Map(reviews.map(r => [r.flashcard_id, r]));
    const t = today || ymd(new Date());
    return cards.filter(c => { const r = byCard.get(c.id); return !r || r.next_review_date <= t; })
                .map(c => Object.assign({}, c, { review: byCard.get(c.id) || null }));
  };

  DB.saveFlashcardReview = async function (userId, card, rating) {
    const next = L.sm2(card.review, rating);
    const row = { user_id: userId, flashcard_id: card.id, interval_days: next.interval_days, next_review_date: next.next_review_date,
                  streak: next.streak, ease_factor: next.ease_factor, repetitions: next.repetitions };
    if (card.review && card.review.id) {
      unwrap(await sbc().from('flashcard_reviews').update(row).eq('id', card.review.id));
    } else {
      unwrap(await sbc().from('flashcard_reviews').insert(row));
    }
    return next;
  };

  DB.isPremium = async function () { return !!unwrap(await sbc().rpc('app_is_premium')); };
  DB.theoryUsedToday = async function () { return Number(unwrap(await sbc().rpc('app_theory_used_today')) || 0); };
  DB.getFreeDailyLimits = async function () {
    const row = unwrap(await sbc().from('platform_config').select('value').eq('key', 'free_daily_limits').maybeSingle());
    return row && row.value ? row.value : { theory_questions: L.CONFIG.FREE_THEORY_DEFAULT };
  };

  // Saves one finished quiz / mock / theory session, then recomputes mastery for the topics touched.
  // events: rows shaped like L.scoreMcq(...).events (or theory events with self_marks / marks_*).
  DB.saveSession = async function (o) {
    const s = unwrap(await sbc().from('sessions').insert({
      user_id: o.userId, subject_id: o.subjectId, topic_id: o.topicId || null, session_type: o.mode,
      exam_format_id: o.examFormatId || null, duration_seconds: o.durationSeconds == null ? null : Math.round(o.durationSeconds),
      score: o.score, total: o.total, ended_at: new Date().toISOString(),
    }).select().single());
    if (o.events && o.events.length) {
      unwrap(await sbc().from('session_events').insert(o.events.map(e => Object.assign({ session_id: s.id }, e))));
    }
    if (o.topicIds && o.topicIds.length) unwrap(await sbc().rpc('refresh_topic_progress', { p_topic_ids: o.topicIds }));
    return s;
  };

  DB.getProgress = async function (userId, subjectIds) {
    return unwrap(await sbc().from('progress').select('*').eq('user_id', userId).in('subject_id', subjectIds));
  };

  DB.getSessionReview = async function (sessionId) {
    return unwrap(await sbc().from('session_events').select('*, questions(*)').eq('session_id', sessionId).order('created_at'));
  };

  DB.getRecentSeenQuestionIds = async function (userId, subjectId, days) {
    const since = new Date(Date.now() - (days || 7) * 86400000).toISOString();
    const sess = unwrap(await sbc().from('sessions').select('id').eq('user_id', userId).eq('subject_id', subjectId).gte('started_at', since));
    if (!sess.length) return [];
    const ev = unwrap(await sbc().from('session_events').select('question_id').in('session_id', sess.map(s => s.id)));
    return Array.from(new Set(ev.map(e => e.question_id).filter(Boolean)));
  };

  L.db = DB;

  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  else root.AfriAceLearning = L;
})(typeof window !== 'undefined' ? window : globalThis);
