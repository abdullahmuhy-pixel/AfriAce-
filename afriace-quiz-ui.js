// =============================================================
// AfriAce quiz UI — afriace-quiz-ui.js
// =============================================================
// Screens: exam switcher, practice menu, quick / timed / topic quizzes, mock exam (premium),
// results with wrong-answer review, theory questions with self-marking (free daily allowance),
// flashcards (spaced repetition) and weak topics with next steps.
//
// Load after afriace-client.js and afriace-learning.js, BEFORE the portal's main <script>:
//   <script src="afriace-client.js"></script>
//   <script src="afriace-learning.js"></script>
//   <script src="afriace-quiz-ui.js"></script>
//
// Uses these globals from the portal: STATE, escapeHtml, showToast, navTo, openSubject,
// openTopic, openAiChat, TOOLS_CATALOG, renderHomeSubjects, renderSubjectsList.
// =============================================================
(function () {
  'use strict';
  const L = window.AfriAceLearning;
  const DB = L.db;
  const QZ = { timer: null, run: null, last: null, premium: null, limits: null, exams: null, topicMap: new Map(), theory: null };
  window.QZ = QZ;

  const esc = s => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const $ = id => document.getElementById(id);
  const body = () => $('quiz-body');
  const setTag = t => { const el = $('quiz-subject-tag'); if (el) el.textContent = t; };
  const muted = t => '<p style="color:var(--text3);font-size:.85rem;">' + esc(t) + '</p>';

  // ---- small stylesheet (prefixed so it cannot clash with the portal's classes) ----
  const css = document.createElement('style');
  css.textContent = `
  .qz-btn{display:block;width:100%;text-align:left;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer;color:inherit;font:inherit}
  .qz-btn b{display:block;font-size:.95rem} .qz-btn span{font-size:.78rem;color:var(--text3)}
  .qz-primary{background:var(--green);color:#fff;border:0;border-radius:10px;padding:12px 18px;font-weight:700;cursor:pointer;font:inherit;font-weight:700}
  .qz-ghost{background:var(--bg3);color:inherit;border:1px solid var(--border);border-radius:10px;padding:10px 14px;cursor:pointer;font:inherit}
  .qz-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .qz-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .qz-chip{border:1px solid var(--border);background:var(--bg3);border-radius:999px;padding:6px 14px;cursor:pointer;font:inherit;font-size:.8rem;color:inherit}
  .qz-chip.on{background:var(--green);color:#fff;border-color:var(--green)}
  .qz-timer{float:right;font-weight:800;color:var(--gold)} .qz-timer.low{color:var(--red)}
  .qz-big{font-size:2.2rem;font-weight:800;text-align:center;margin:6px 0}
  .qz-pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:.72rem;font-weight:700;background:var(--bg3);margin:2px 4px 2px 0}
  .qz-explain{background:var(--bg3);border-radius:10px;padding:12px;margin-top:10px;font-size:.88rem;line-height:1.5}
  .qz-opt-sel{border-color:var(--gold)!important}
  .qz-rev{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px}
  .qz-lock{background:var(--bg3);border-radius:12px;padding:14px;font-size:.88rem}
  .qz-line{display:flex;gap:10px;align-items:center;margin:8px 0;font-size:.85rem}
  .qz-line select{padding:6px;border-radius:8px}
  textarea.qz-text{width:100%;min-height:110px;border-radius:10px;border:1px solid var(--border);padding:10px;font:inherit;background:var(--bg2);color:inherit}
  `;
  document.head.appendChild(css);

  // ---------------- shared helpers ----------------
  QZ.stopTimer = function () { if (QZ.timer) { clearInterval(QZ.timer); QZ.timer = null; } };
  window.qzStopTimer = QZ.stopTimer;

  async function ensurePremium() {
    if (QZ.premium == null) { try { QZ.premium = await DB.isPremium(); } catch (e) { QZ.premium = false; } }
    return QZ.premium;
  }
  const examLabel = e => (e.code === 'WASSCE' ? 'WAEC' : e.code);

  async function loadExams() {
    if (QZ.exams) return QZ.exams;
    const esid = STATE.academicProfile && STATE.academicProfile.education_system_id;
    try { QZ.exams = esid ? await DB.getExaminations(esid) : []; } catch (e) { QZ.exams = []; }
    return QZ.exams;
  }

  async function topicMap(subjects) {
    for (const s of subjects) {
      if ([...QZ.topicMap.values()].some(t => t.subject_id === s.id)) continue;
      try { (await DB.getTopics(s.id, STATE.academicProfile && STATE.academicProfile.level_id)).forEach(t => QZ.topicMap.set(t.id, t)); } catch (e) { /* leave empty */ }
    }
    return QZ.topicMap;
  }

  // ---------------- exam switcher ----------------
  window.qzRenderExamChips = async function (containerId) {
    const el = $(containerId); if (!el) return;
    const exams = await loadExams();
    if (exams.length < 2) { el.innerHTML = ''; return; }
    const active = STATE.activeExamId || (STATE.academicProfile && STATE.academicProfile.examination_id);
    el.innerHTML = '<div class="qz-chips">' + exams.map(e =>
      '<button class="qz-chip' + (e.id === active ? ' on' : '') + '" onclick="qzSetExam(\'' + e.id + '\')">' + esc(examLabel(e)) + '</button>').join('') + '</div>';
  };

  window.qzSetExam = async function (examId) {
    STATE.activeExamId = examId;
    try { STATE.subjects = await DB.getSubjectsForExamination(examId); } catch (e) { STATE.subjects = []; showToast('Could not load that exam'); }
    QZ.topicMap = new Map();
    if (typeof renderHomeSubjects === 'function') renderHomeSubjects();
    if (typeof renderSubjectsList === 'function') renderSubjectsList();
    window.renderQuizLanding();
  };

  // ---------------- practice landing and subject menu ----------------
  window.renderQuizLanding = async function () {
    QZ.stopTimer();
    setTag('Practice');
    body().innerHTML = '<div id="qz-exam-chips"></div>' + (STATE.subjects && STATE.subjects.length
      ? '<p style="color:var(--text2);font-size:.85rem;margin-bottom:12px">Pick a subject to practise.</p><div class="card-list">' +
        STATE.subjects.map(s => '<div class="subject-card" onclick="qzOpenSubject(\'' + s.id + '\')"><div class="icon">' + esc(s.icon || '📘') + '</div><div style="flex:1"><div class="name">' + esc(s.name) + '</div><div class="meta">' + esc(s.official_name || '') + '</div></div><span style="color:var(--text3)">›</span></div>').join('') + '</div>'
      : muted('Pick your subjects in Profile first, then come back here to practise.'));
    window.qzRenderExamChips('qz-exam-chips');
  };

  window.startQuiz = function (subjectId) {
    const s = (STATE.subjects || []).find(x => x.id === subjectId) || STATE.currentSubject;
    if (s) STATE.currentSubject = s;
    if (typeof navTo === 'function') navTo(document.querySelectorAll('.nav-item')[2], 'quiz');
    return window.qzOpenSubject(subjectId);
  };

  window.qzOpenSubject = async function (subjectId) {
    QZ.stopTimer();
    const s = (STATE.subjects || []).find(x => x.id === subjectId) || STATE.currentSubject;
    if (!s) return;
    STATE.currentSubject = s;
    setTag(s.name);
    const premium = await ensurePremium();
    let theoryNote = '';
    if (premium) theoryNote = 'Unlimited';
    else {
      try {
        QZ.limits = QZ.limits || await DB.getFreeDailyLimits();
        const a = L.theoryAllowance({ isPremium: false, usedToday: await DB.theoryUsedToday(), limit: QZ.limits.theory_questions });
        theoryNote = a.remaining + ' free today';
      } catch (e) { theoryNote = 'Free daily allowance'; }
    }
    body().innerHTML =
      '<p style="color:var(--text2);font-size:.85rem;margin-bottom:12px">' + esc(s.official_name || s.name) + '</p>' +
      '<button class="qz-btn" onclick="qzStart(\'quick\')"><b>⚡ Quick quiz</b><span>' + L.CONFIG.QUICK_QUESTIONS + ' questions, feedback after each answer</span></button>' +
      '<button class="qz-btn" onclick="qzStart(\'timed\')"><b>⏱ Timed quiz</b><span>Beat the clock. Ends automatically when time is up</span></button>' +
      '<button class="qz-btn" onclick="qzTopicPicker()"><b>🎯 Topic quiz</b><span>Practise one topic</span></button>' +
      '<button class="qz-btn" onclick="qzStartTheory()"><b>✍️ Theory question</b><span>Write your answer, then mark yourself · ' + esc(theoryNote) + '</span></button>' +
      '<button class="qz-btn" onclick="qzStartMock()"><b>📝 Mock exam ' + (premium ? '' : '🔒') + '</b><span>' + (premium ? 'Uses the exam paper timing' : 'Premium: school plan or individual registration') + '</span></button>' +
      '<button class="qz-btn" onclick="qzShowWeak()"><b>🔁 My weak topics</b><span>See where to focus next</span></button>' +
      '<button class="qz-btn" onclick="openTool && openTool(\'flashcards\')"><b>🗂️ Flashcards</b><span>Revise with spaced repetition</span></button>';
  };

  // From a lesson page: go straight into a quiz on that topic (no menu in between).
  window.qzPracticeTopic = async function (subjectId, topicId) {
    const sub = (STATE.subjects || []).find(x => x.id === subjectId) || STATE.currentSubject;
    if (sub) STATE.currentSubject = sub;
    if (typeof navTo === 'function') navTo(document.querySelectorAll('.nav-item')[2], 'quiz');
    setTag(sub ? sub.name : 'Practice');
    return window.qzStart('topic', { topicId });
  };

  window.qzTopicPicker = async function () {
    const s = STATE.currentSubject; if (!s) return;
    body().innerHTML = muted('Loading topics…');
    try {
      const topics = await DB.getTopics(s.id, STATE.academicProfile && STATE.academicProfile.level_id);
      const pool = await DB.getQuestionPool(s.id, { types: ['mcq', 'true_false'] });
      const counts = {}; pool.forEach(q => { if (q.topic_id) counts[q.topic_id] = (counts[q.topic_id] || 0) + 1; });
      topics.forEach(t => QZ.topicMap.set(t.id, t));
      const withQs = topics.filter(t => counts[t.id]);
      body().innerHTML = '<button class="qz-ghost" onclick="qzOpenSubject(\'' + s.id + '\')">‹ Back</button><div style="height:12px"></div>' +
        (withQs.length ? withQs.map(t => '<button class="qz-btn" onclick="qzStart(\'topic\',{topicId:\'' + t.id + '\'})"><b>' + esc(t.title) + '</b><span>' + counts[t.id] + ' question' + (counts[t.id] === 1 ? '' : 's') + '</span></button>').join('')
          : muted('No practice questions have been added for any topic yet.'));
    } catch (e) { body().innerHTML = muted('Could not load topics right now.'); }
  };

  // ---------------- running a quiz ----------------
  function objectiveFormat(formats) { return (formats || []).find(f => f.paper_type === 'objective') || null; }

  window.qzStart = async function (mode, opts) {
    opts = opts || {};
    const s = STATE.currentSubject; if (!s) return;
    QZ.stopTimer();
    body().innerHTML = muted('Loading questions…');
    try {
      const pool = await DB.getQuestionPool(s.id, { topicId: opts.topicId || null, types: ['mcq', 'true_false'] });
      L.assertScope(pool, [s.id]);
      let seen = [];
      if (!opts.topicId) { try { seen = await DB.getRecentSeenQuestionIds(STATE.profile.id, s.id, 7); } catch (e) { seen = []; } }
      let questions, seconds = null, format = null, note = '';
      if (mode === 'mock') {
        format = objectiveFormat(await DB.getExamFormats(s.id));
        const m = L.buildMock(pool, format, { excludeIds: seen });
        questions = m.questions; seconds = m.seconds;
        if (!m.countVerified) note = 'The official question count for this paper is not verified, so this mock uses ' + questions.length + ' questions.';
        else if (m.shortfall) note = 'Only ' + questions.length + ' of ' + (questions.length + m.shortfall) + ' questions are available yet.';
      } else {
        questions = L.selectQuestions(pool, { count: L.CONFIG.QUICK_QUESTIONS, topicId: opts.topicId, difficulty: opts.difficulty, excludeIds: seen }).map(q => L.shuffleOptions(q));
        if (mode === 'timed') { format = objectiveFormat(await DB.getExamFormats(s.id)); seconds = L.timedSeconds(format, questions.length); }
      }
      if (!questions.length) { body().innerHTML = '<div class="empty-state"><div class="icon">📭</div><div class="title">No questions yet</div><div class="sub">Check back once this subject\'s question bank is filled.</div></div>'; return; }
      QZ.run = { mode, subject: s, topicId: opts.topicId || null, questions, idx: 0, answers: {}, seconds, remaining: seconds, format, note, startedAt: Date.now(), qStart: Date.now(), locked: false, feedback: mode !== 'mock' };
      renderQuestion();
      if (seconds) startTimer();
    } catch (e) {
      console.warn(e);
      body().innerHTML = muted(e && /blocked/.test(e.message || '') ? e.message : 'Could not start the quiz right now.');
    }
  };

  window.qzStartMock = async function () {
    if (!(await ensurePremium())) {
      body().innerHTML = '<button class="qz-ghost" onclick="qzOpenSubject(\'' + STATE.currentSubject.id + '\')">‹ Back</button><div style="height:12px"></div><div class="qz-lock">🔒 Mock exams are part of AfriAce Premium. Your school can switch this on with a school plan, or you can register individually.</div>';
      return;
    }
    return window.qzStart('mock');
  };

  function startTimer() {
    QZ.stopTimer();
    QZ.timer = setInterval(function () {
      const r = QZ.run; if (!r) return QZ.stopTimer();
      r.remaining -= 1;
      const t = $('qz-timer'); if (t) { t.textContent = '⏱ ' + L.formatTime(r.remaining); t.classList.toggle('low', r.remaining <= 30); }
      if (r.remaining <= 0) window.qzFinish('timeout');
    }, 1000);
  }

  function renderQuestion() {
    const r = QZ.run; const q = r.questions[r.idx];
    const ans = r.answers[q.id];
    const opts = (q.options || []).map(o => {
      let cls = 'quiz-opt';
      if (ans && ans.key === o.key && !r.feedback) cls += ' qz-opt-sel';
      if (r.feedback && ans) { if (o.key === q.correct_answer) cls += ' correct'; else if (o.key === ans.key) cls += ' wrong'; }
      return '<button class="' + cls + '" data-key="' + o.key + '" ' + (r.feedback && ans ? 'disabled' : 'onclick="qzPick(\'' + o.key + '\')"') + '>' + esc(o.label || o.key) + '. ' + esc(o.text) + '</button>';
    }).join('');
    let feedback = '';
    if (r.feedback && ans) {
      const ok = ans.key === q.correct_answer;
      feedback = '<div class="qz-explain"><b>' + (ok ? '✅ Correct' : '❌ Not quite') + '</b><br>' + esc(q.explanation || '') +
        (ok ? '' : '<div class="qz-row"><button class="qz-ghost" onclick="qzAskAceCurrent()">🤖 Ask Ace</button></div>') + '</div>';
    }
    const last = r.idx === r.questions.length - 1;
    let nav;
    if (r.feedback) nav = ans ? '<div class="qz-row"><button class="qz-primary" onclick="qzNext()">' + (last ? 'See results' : 'Next ›') + '</button></div>' : '';
    else nav = '<div class="qz-row">' + (r.idx > 0 ? '<button class="qz-ghost" onclick="qzGo(-1)">‹ Previous</button>' : '') +
      (last ? '<button class="qz-primary" onclick="qzSubmitMock()">Submit exam</button>' : '<button class="qz-ghost" onclick="qzGo(1)">' + (ans ? 'Next ›' : 'Skip ›') + '</button>') + '</div>';
    body().innerHTML =
      '<div class="quiz-progress">Question ' + (r.idx + 1) + ' of ' + r.questions.length + (r.seconds ? '<span class="qz-timer" id="qz-timer">⏱ ' + L.formatTime(r.remaining) + '</span>' : '') + '</div>' +
      (r.note && r.idx === 0 ? '<div class="qz-lock" style="margin-bottom:10px">' + esc(r.note) + '</div>' : '') +
      '<div class="quiz-q"><div class="qtext">' + esc(q.question_text) + '</div>' + opts + feedback + '</div>' + nav;
    r.qStart = Date.now();
  }

  window.qzPick = function (key) {
    const r = QZ.run; if (!r) return;
    const q = r.questions[r.idx];
    if (r.feedback && r.answers[q.id]) return;
    const secs = (Date.now() - r.qStart) / 1000;
    r.answers[q.id] = { key, seconds: secs };
    renderQuestion();
  };
  window.qzNext = function () { const r = QZ.run; if (!r) return; if (r.idx < r.questions.length - 1) { r.idx++; renderQuestion(); } else window.qzFinish('done'); };
  window.qzGo = function (d) { const r = QZ.run; if (!r) return; r.idx = Math.min(r.questions.length - 1, Math.max(0, r.idx + d)); renderQuestion(); };
  window.qzSubmitMock = function () { window.qzFinish('done'); };

  function openAceWith(text) {
    const tool = (typeof TOOLS_CATALOG !== 'undefined') && TOOLS_CATALOG.flatMap(c => c.items).find(t => t.key === 'ai_buddy');
    if (tool && typeof openAiChat === 'function') { openAiChat(tool); const i = $('chat-input'); if (i) i.value = text; }
  }
  window.qzAskAceCurrent = function () {
    const r = QZ.run; if (!r) return; const q = r.questions[r.idx];
    const chosen = r.answers[q.id]; const opt = (q.options || []).find(o => chosen && o.key === chosen.key);
    openAceWith('Explain this question and why my answer was wrong: ' + q.question_text + (opt ? ' (I chose: ' + opt.text + ')' : ''));
  };

  // ---------------- results ----------------
  window.qzFinish = async function (reason) {
    const r = QZ.run; if (!r) return;
    QZ.stopTimer();
    const used = (Date.now() - r.startedAt) / 1000;
    const result = L.scoreMcq(r.questions, r.answers);
    QZ.last = { run: r, result, reason, used, premium: await ensurePremium() };
    QZ.run = null;
    let saved = true;
    try {
      await DB.saveSession({
        userId: STATE.profile.id, subjectId: r.subject.id, topicId: r.topicId, mode: r.mode,
        examFormatId: r.format && r.format.id, durationSeconds: used, score: result.correct, total: result.total,
        events: result.events, topicIds: Object.keys(result.perTopic).filter(k => k !== 'none'),
      });
    } catch (e) { console.warn('Could not save session', e); saved = false; }
    await topicMap([r.subject]);
    renderResults(saved);
  };

  function renderResults(saved) {
    const { run: r, result, reason, used, premium } = QZ.last;
    const topics = Object.entries(result.perTopic).map(([id, v]) => {
      const t = QZ.topicMap.get(id); const pct = Math.round(100 * v.correct / v.attempted);
      return '<div class="qz-line"><span style="flex:1">' + esc(t ? t.title : 'Topic') + '</span><span>' + v.correct + '/' + v.attempted + (premium ? ' · ' + pct + '%' : ' · 🔒 %') + '</span></div>';
    }).join('');
    const diffs = L.difficultyBreakdown(result.perDifficulty).map(d => '<span class="qz-pill">' + esc(d.difficulty.replace('_', ' ')) + ' ' + d.percent + '%</span>').join('');
    const msg = result.percent >= 80 ? 'Excellent work! 🌟' : result.percent >= 50 ? 'Good effort. Keep going! 💪' : 'Keep practising, you will get there. 📚';
    body().innerHTML =
      '<div class="quiz-q"><div class="qz-big">' + result.correct + ' / ' + result.total + '</div>' +
      '<div style="text-align:center;font-weight:700">' + result.percent + '% · ' + msg + '</div>' +
      '<div style="text-align:center;color:var(--text3);font-size:.8rem;margin-top:6px">' + (reason === 'timeout' ? "Time's up · " : '') + 'Time used ' + L.formatTime(used) +
      (result.skipped ? ' · ' + result.skipped + ' skipped' : '') + '</div>' +
      (diffs ? '<div style="margin-top:12px">' + diffs + '</div>' : '') +
      (topics ? '<div style="margin-top:12px"><b style="font-size:.85rem">Topic performance</b>' + topics + '</div>' : '') +
      (saved ? '' : '<div class="qz-lock" style="margin-top:10px">Your result could not be saved this time.</div>') + '</div>' +
      '<div class="qz-row">' +
      (result.review.length ? '<button class="qz-primary" onclick="qzReview()">Review ' + result.review.length + ' answer' + (result.review.length === 1 ? '' : 's') + '</button>' : '') +
      '<button class="qz-ghost" onclick="qzStart(\'' + r.mode + '\',{topicId:' + (r.topicId ? "'" + r.topicId + "'" : 'null') + '})">Practise again</button>' +
      '<button class="qz-ghost" onclick="qzShowWeak()">My weak topics</button>' +
      '<button class="qz-ghost" onclick="qzOpenSubject(\'' + r.subject.id + '\')">Menu</button></div>';
  }

  // ---------------- wrong-answer review ----------------
  window.qzReview = function () {
    if (!QZ.last) return;
    const { result } = QZ.last;
    body().innerHTML = '<button class="qz-ghost" onclick="qzBackToResults()">‹ Results</button><div style="height:12px"></div>' +
      result.review.map((x, i) =>
        '<div class="qz-rev"><div style="font-weight:700;margin-bottom:8px">' + (i + 1) + '. ' + esc(x.question_text) + '</div>' +
        '<div style="font-size:.85rem">' + (x.status === 'skipped' ? '<span class="qz-pill">Skipped</span>' : 'Your answer: <b style="color:var(--red)">' + esc(x.selected ? x.selected.label + '. ' + x.selected.text : '') + '</b>') + '</div>' +
        '<div style="font-size:.85rem;margin-top:4px">Correct answer: <b style="color:var(--green)">' + esc(x.correct.label + '. ' + x.correct.text) + '</b></div>' +
        (x.explanation ? '<div class="qz-explain">' + esc(x.explanation) + '</div>' : '') +
        '<div class="qz-row">' + (x.topic_id ? '<button class="qz-ghost" onclick="qzOpenLesson(\'' + x.topic_id + '\')">📖 Review this topic</button><button class="qz-ghost" onclick="qzStart(\'topic\',{topicId:\'' + x.topic_id + '\'})">🎯 Practise similar</button>' : '') +
        '<button class="qz-ghost" onclick="qzAskAceIdx(' + i + ')">🤖 Ask Ace</button></div></div>').join('');
  };
  window.qzBackToResults = function () { renderResults(true); };
  window.qzAskAceIdx = function (i) { const x = QZ.last && QZ.last.result.review[i]; if (x) openAceWith('Explain this question and the correct answer: ' + x.question_text); };
  window.qzOpenLesson = async function (topicId) {
    const s = STATE.currentSubject; if (!s) return;
    await openSubject(s.id);
    await openTopic(topicId);
  };

  // ---------------- theory with self-marking ----------------
  window.qzStartTheory = async function () {
    const s = STATE.currentSubject; if (!s) return;
    body().innerHTML = muted('Loading…');
    try {
      const premium = await ensurePremium();
      QZ.limits = QZ.limits || await DB.getFreeDailyLimits();
      const used = premium ? 0 : await DB.theoryUsedToday();
      const allow = L.theoryAllowance({ isPremium: premium, usedToday: used, limit: QZ.limits.theory_questions });
      if (!allow.allowed) {
        body().innerHTML = '<button class="qz-ghost" onclick="qzOpenSubject(\'' + s.id + '\')">‹ Back</button><div style="height:12px"></div><div class="qz-lock">You have used today\'s ' + QZ.limits.theory_questions + ' free theory questions. They reset tomorrow. Premium (a school plan or individual registration) removes the limit.</div>';
        return;
      }
      const pool = await DB.getQuestionPool(s.id, { types: ['structured', 'essay'] });
      L.assertScope(pool, [s.id]);
      let seen = []; try { seen = await DB.getRecentSeenQuestionIds(STATE.profile.id, s.id, 7); } catch (e) { /* ignore */ }
      const q = L.selectQuestions(pool, { count: 1, types: ['structured', 'essay'], excludeIds: seen })[0];
      if (!q) { body().innerHTML = '<div class="empty-state"><div class="icon">📭</div><div class="title">No theory questions yet</div></div>'; return; }
      QZ.theory = { q, subject: s, start: Date.now(), allow };
      body().innerHTML = '<button class="qz-ghost" onclick="qzOpenSubject(\'' + s.id + '\')">‹ Back</button><div style="height:12px"></div>' +
        '<div class="quiz-q"><div class="quiz-progress">' + esc(String(q.marks || '')) + ' marks' + (allow.unlimited ? '' : ' · ' + allow.remaining + ' free left today') + '</div>' +
        '<div class="qtext" style="white-space:pre-wrap">' + esc(q.question_text) + '</div>' +
        '<textarea class="qz-text" id="qz-theory-answer" placeholder="Write your working and answer here"></textarea>' +
        '<div class="qz-row"><button class="qz-primary" onclick="qzTheoryReveal()">Show marking scheme</button></div></div>';
    } catch (e) { console.warn(e); body().innerHTML = muted('Could not load a theory question right now.'); }
  };

  window.qzTheoryReveal = function () {
    const t = QZ.theory; if (!t) return;
    t.answer = ($('qz-theory-answer') || {}).value || '';
    const rub = t.q.rubric || [];
    body().innerHTML =
      '<div class="quiz-q"><div class="qtext" style="white-space:pre-wrap">' + esc(t.q.question_text) + '</div>' +
      '<div style="font-size:.85rem;margin-bottom:6px"><b>Your answer</b></div><div class="qz-explain" style="white-space:pre-wrap">' + esc(t.answer || '(nothing written)') + '</div>' +
      '<div style="margin-top:12px"><b style="font-size:.85rem">Model answer</b></div><div class="qz-explain" style="white-space:pre-wrap">' + esc(t.q.model_answer || t.q.explanation || '') + '</div>' +
      '<div style="margin-top:12px"><b style="font-size:.85rem">Mark yourself honestly, line by line</b></div>' +
      rub.map((r, i) => '<div class="qz-line"><span style="flex:1">' + esc(r.text) + '</span><select id="qz-mark-' + i + '">' +
        Array.from({ length: (Number(r.mark) || 0) + 1 }, (_, m) => '<option value="' + m + '">' + m + ' / ' + r.mark + '</option>').join('') + '</select></div>').join('') +
      '<div class="qz-row"><button class="qz-primary" onclick="qzTheorySubmit()">Save my marks</button></div></div>';
  };

  window.qzTheorySubmit = async function () {
    const t = QZ.theory; if (!t) return;
    const rub = t.q.rubric || [];
    const awarded = rub.map((_, i) => Number(($('qz-mark-' + i) || {}).value) || 0);
    const sc = L.scoreTheory(rub, awarded);
    const secs = Math.round((Date.now() - t.start) / 1000);
    let saved = true;
    try {
      await DB.saveSession({
        userId: STATE.profile.id, subjectId: t.subject.id, topicId: t.q.topic_id, mode: 'theory', durationSeconds: secs,
        score: sc.is_correct ? 1 : 0, total: 1, topicIds: t.q.topic_id ? [t.q.topic_id] : [],
        events: [{ question_id: t.q.id, answer_text: t.answer || null, self_marks: sc.self_marks, marks_awarded: sc.marks_awarded,
                   marks_available: sc.marks_available, is_correct: sc.is_correct, is_skipped: false, time_taken_seconds: secs }],
      });
    } catch (e) { console.warn(e); saved = false; }
    body().innerHTML = '<div class="quiz-q"><div class="qz-big">' + sc.marks_awarded + ' / ' + sc.marks_available + '</div>' +
      '<div style="text-align:center;font-weight:700">' + sc.percent + '% ' + (sc.is_correct ? '· Well done! 🌟' : '· Study the model answer and try again. 📚') + '</div>' +
      (saved ? '' : '<div class="qz-lock" style="margin-top:10px">Your marks could not be saved this time.</div>') + '</div>' +
      '<div class="qz-row"><button class="qz-primary" onclick="qzStartTheory()">Another theory question</button><button class="qz-ghost" onclick="qzOpenSubject(\'' + t.subject.id + '\')">Menu</button></div>';
  };

  // ---------------- weak topics ----------------
  async function loadWeak(subjects) {
    const rows = await DB.getProgress(STATE.profile.id, subjects.map(s => s.id));
    await topicMap(subjects);
    const weak = L.weakTopics(rows);
    let withCards = [];
    try { withCards = (await DB.getFlashcards(weak.map(w => w.topic_id))).map(c => c.topic_id); } catch (e) { /* none */ }
    return L.recommend(weak, { topicIdsWithFlashcards: withCards, limit: 5 });
  }
  function weakHtml(recs) {
    if (!recs.length) return '<div class="qz-lock">No weak topics yet. A topic is flagged after at least ' + L.CONFIG.MIN_ATTEMPTS + ' answers with under ' + L.CONFIG.DEVELOPING_PCT + '% correct.</div>';
    return recs.map(r => {
      const t = QZ.topicMap.get(r.topic_id);
      return '<div class="qz-rev"><div style="font-weight:700">' + esc(t ? t.title : 'Topic') + '</div><div style="font-size:.82rem;color:var(--text3)">' + r.mastery_pct + '% over ' + r.attempts + ' answers</div><div class="qz-row">' +
        r.steps.map(s => s.type === 'review_lesson' ? '<button class="qz-ghost" onclick="qzOpenLesson(\'' + r.topic_id + '\')">📖 Review lesson</button>'
          : s.type === 'targeted_quiz' ? '<button class="qz-ghost" onclick="qzStart(\'topic\',{topicId:\'' + r.topic_id + '\'})">🎯 Targeted quiz</button>'
          : '<button class="qz-ghost" onclick="openTool && openTool(\'flashcards\')">🗂️ Flashcards</button>').join('') + '</div></div>';
    }).join('');
  }
  window.qzShowWeak = async function () {
    const s = STATE.currentSubject; setTag('Weak topics');
    body().innerHTML = muted('Checking your progress…');
    try { body().innerHTML = (s ? '<button class="qz-ghost" onclick="qzOpenSubject(\'' + s.id + '\')">‹ Back</button><div style="height:12px"></div>' : '') + weakHtml(await loadWeak(s ? [s] : STATE.subjects)); }
    catch (e) { body().innerHTML = muted('Could not load your progress right now.'); }
  };
  window.renderProgressWeak = async function () {
    const el = $('progress-weak'); if (!el) return;
    try { el.innerHTML = weakHtml(await loadWeak(STATE.subjects || [])); } catch (e) { el.innerHTML = muted('Weak topics unavailable right now.'); }
  };

  // ---------------- flashcards (spaced repetition) ----------------
  window.renderFlashcards = async function () {
    const host = $('tool-detail-body');
    host.innerHTML = '<div class="tool-detail-header"><h2>🗂️ Flashcards</h2></div><div id="flash-body">' + muted('Loading…') + '</div>';
    const el = $('flash-body');
    if (!STATE.subjects || !STATE.subjects.length) { el.innerHTML = muted('Pick your subjects first.'); return; }
    try {
      await topicMap(STATE.subjects);
      const topicIds = [...QZ.topicMap.keys()];
      STATE.flashDeck = L.shuffle(await DB.getDueFlashcards(STATE.profile.id, topicIds));
      STATE.flashIndex = 0;
      if (!STATE.flashDeck.length) { el.innerHTML = '<div class="empty-state"><div class="icon">🗂️</div><div class="title">All caught up!</div><div class="sub">No cards due right now. Check back tomorrow.</div></div>'; return; }
      window.renderFlashcard();
    } catch (e) { console.warn(e); el.innerHTML = muted('Could not load flashcards right now.'); }
  };
  window.renderFlashcard = function () {
    const el = $('flash-body'); const card = STATE.flashDeck[STATE.flashIndex];
    if (!card) { el.innerHTML = '<div class="empty-state"><div class="icon">🎉</div><div class="title">Deck complete!</div><div class="sub">Come back tomorrow for more.</div></div>'; return; }
    const t = QZ.topicMap.get(card.topic_id);
    el.innerHTML = '<p style="text-align:center;color:var(--text3);font-size:.78rem;margin-bottom:10px">Card ' + (STATE.flashIndex + 1) + ' of ' + STATE.flashDeck.length + (t ? ' · ' + esc(t.title) : '') + '</p>' +
      '<div class="flip-card" id="flash-flipcard" onclick="this.classList.toggle(\'flipped\')"><div class="flip-card-inner"><div class="flip-card-face front">' + esc(card.front) + '</div><div class="flip-card-face back">' + esc(card.back) + '</div></div></div>' +
      '<div class="qz-row" style="justify-content:center"><button class="qz-ghost" onclick="flashAnswer(\'again\')">😕 Again</button><button class="qz-ghost" onclick="flashAnswer(\'hard\')">😬 Hard</button><button class="qz-ghost" onclick="flashAnswer(\'good\')">🙂 Good</button><button class="qz-ghost" onclick="flashAnswer(\'easy\')">😎 Easy</button></div>';
  };
  window.flashAnswer = async function (rating) {
    const card = STATE.flashDeck[STATE.flashIndex]; if (!card) return;
    try { await DB.saveFlashcardReview(STATE.profile.id, card, rating); } catch (e) { console.warn('Could not save flashcard review', e); }
    STATE.flashIndex++;
    window.renderFlashcard();
  };
})();
