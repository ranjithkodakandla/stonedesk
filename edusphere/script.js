/* ===== EduSphere – Main Application Script ===== */
'use strict';

/* ---------- State ---------- */
const state = {
  currentPage: 'dashboard',
  currentClass: 'class9',
  theme: 'dark',
  lang: 'en',
  syllabus: null,
  quizzes: null,
  flashcardsData: null,
  timerInterval: null,
  timerSeconds: 25 * 60,
  timerType: 'study',
  timerRunning: false,
  timerConfig: { study: 25, short: 5, long: 15 },
  timerTotalSecs: 0,
  currentQuiz: null,
  currentQ: 0,
  quizAnswers: [],
  currentFcDeck: null,
  currentFcIndex: 0,
  currentFcFlipped: false,
  searchQuery: ''
};

/* ---------- Storage helpers ---------- */
const STORE_KEY = 'edusphere_v1';

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch { return {}; }
}

function saveStore(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {}
}

function getStore(key, def) {
  const s = loadStore();
  return s[key] !== undefined ? s[key] : def;
}

function setStore(key, val) {
  const s = loadStore();
  s[key] = val;
  saveStore(s);
}

/* ---------- XP / Level ---------- */
const LEVELS = [
  { level: 1, name: 'Beginner', xp: 0 },
  { level: 2, name: 'Explorer', xp: 100 },
  { level: 3, name: 'Learner', xp: 250 },
  { level: 4, name: 'Curious Mind', xp: 500 },
  { level: 5, name: 'Knowledge Seeker', xp: 800 },
  { level: 6, name: 'Achiever', xp: 1200 },
  { level: 7, name: 'Scholar', xp: 1800 },
  { level: 8, name: 'Expert', xp: 2600 },
  { level: 9, name: 'Master', xp: 3600 },
  { level: 10, name: 'Grand Scholar', xp: 5000 },
  { level: 20, name: 'Master', xp: 15000 }
];

function getCurrentLevel(xp) {
  let lv = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.xp) lv = l; else break; }
  return lv;
}

function getNextLevel(xp) {
  for (let i = 0; i < LEVELS.length - 1; i++) {
    if (xp < LEVELS[i + 1].xp) return LEVELS[i + 1];
  }
  return null;
}

function addXP(amount, reason) {
  const xp = getStore('xp', 0) + amount;
  setStore('xp', xp);
  updateStreakData();
  const activity = getStore('activities', []);
  activity.unshift({ text: `+${amount} XP – ${reason}`, time: Date.now(), color: 'orange' });
  setStore('activities', activity.slice(0, 20));
  showToast(`+${amount} XP`, reason, 'success', '⭐');
  updateSidebarXP();
}

function updateStreakData() {
  const today = new Date().toDateString();
  const lastStudy = getStore('lastStudyDate', '');
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (lastStudy === today) return;
  if (lastStudy === yesterday) {
    setStore('streak', getStore('streak', 0) + 1);
  } else if (lastStudy !== today) {
    setStore('streak', 1);
  }
  setStore('lastStudyDate', today);
  checkAchievements();
}

/* ---------- Achievements ---------- */
const ACHIEVEMENTS = [
  { id: 'first_quiz', name: 'Quiz Starter', desc: 'Complete your first quiz', icon: '🎯', cond: s => s.quizCount >= 1 },
  { id: 'quiz_5', name: 'Quiz Enthusiast', desc: 'Complete 5 quizzes', icon: '🏆', cond: s => s.quizCount >= 5 },
  { id: 'hw_first', name: 'Task Master', desc: 'Complete first assignment', icon: '✅', cond: s => s.hwCompleted >= 1 },
  { id: 'streak_3', name: '3-Day Streak', desc: 'Study 3 days in a row', icon: '🔥', cond: s => getStore('streak', 0) >= 3 },
  { id: 'streak_7', name: 'Dedicated', desc: 'Study 7 days in a row', icon: '🌟', cond: s => getStore('streak', 0) >= 7 },
  { id: 'chapter_first', name: 'Chapter Champion', desc: 'Complete first chapter', icon: '📖', cond: s => s.chaptersCompleted >= 1 },
  { id: 'xp_500', name: 'Rising Star', desc: 'Earn 500 XP', icon: '⚡', cond: s => getStore('xp', 0) >= 500 },
  { id: 'fc_first', name: 'Flashcard Fan', desc: 'Review a flashcard deck', icon: '🃏', cond: s => s.fcDecksReviewed >= 1 },
  { id: 'timer_first', name: 'Focus Mode', desc: 'Complete a Pomodoro session', icon: '⏱️', cond: s => s.pomodoroCount >= 1 }
];

function checkAchievements() {
  const unlocked = getStore('achievements', []);
  const stats = {
    quizCount: getStore('quizCount', 0),
    hwCompleted: getStore('hwCompleted', 0),
    chaptersCompleted: (getStore('completedChapters', [])).length,
    fcDecksReviewed: getStore('fcDecksReviewed', 0),
    pomodoroCount: getStore('pomodoroCount', 0)
  };
  for (const ach of ACHIEVEMENTS) {
    if (!unlocked.includes(ach.id) && ach.cond(stats)) {
      unlocked.push(ach.id);
      setStore('achievements', unlocked);
      showToast('Achievement Unlocked!', `${ach.icon} ${ach.name}`, 'achievement', '🏅');
    }
  }
}

/* ---------- Toast ---------- */
function showToast(title, msg, type = 'info', icon = 'ℹ️') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icon}</span><div class="toast-text"><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div>`;
  container.appendChild(t);
  setTimeout(() => { t.style.animation = 'fadeOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, 3500);
}

/* ---------- Navigation ---------- */
function navigate(page, extra) {
  state.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.getElementById('page-content').innerHTML = '';
  renderPage(page, extra);
  updatePageTitle(page);
  // close mobile sidebar
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.add('hidden');
}

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  subjects: 'Subjects & Syllabus',
  homework: 'Homework Tracker',
  timer: 'Study Timer',
  flashcards: 'Flashcards',
  quizzes: 'Quizzes',
  progress: 'My Progress',
  gamification: 'Study Quest',
  ai_checker: 'AI Answer Checker',
  settings: 'Settings',
  about: 'About EduSphere'
};

function updatePageTitle(page) {
  const el = document.getElementById('page-title');
  if (el) el.textContent = t(PAGE_TITLES[page] || page);
}

/* ---------- i18n ---------- */
const TRANSLATIONS = {
  en: {},
  hi: {
    'Dashboard': 'डैशबोर्ड',
    'Subjects & Syllabus': 'विषय और पाठ्यक्रम',
    'Homework Tracker': 'गृहकार्य ट्रैकर',
    'Study Timer': 'अध्ययन टाइमर',
    'Flashcards': 'फ्लैशकार्ड',
    'Quizzes': 'प्रश्नोत्तरी',
    'My Progress': 'मेरी प्रगति',
    'Study Quest': 'स्टडी क्वेस्ट',
    'AI Answer Checker': 'AI उत्तर जाँचक',
    'Settings': 'सेटिंग्स',
    'About EduSphere': 'EduSphere के बारे में',
    'Welcome back': 'स्वागत है',
    'Class': 'कक्षा',
    'Subject': 'विषय',
    'Chapter': 'अध्याय',
    'Complete': 'पूर्ण',
    'Completed': 'पूर्ण हुआ',
    'Start Quiz': 'प्रश्नोत्तरी शुरू करें',
    'Add Homework': 'गृहकार्य जोड़ें',
    'Save': 'सहेजें',
    'Cancel': 'रद्द करें',
    'Delete': 'हटाएं',
    'Edit': 'संपादित करें'
  }
};

function t(key) {
  if (state.lang === 'hi' && TRANSLATIONS.hi[key]) return TRANSLATIONS.hi[key];
  return key;
}

/* ---------- Render dispatcher ---------- */
function renderPage(page, extra) {
  const content = document.getElementById('page-content');
  switch (page) {
    case 'dashboard':   content.innerHTML = renderDashboard(); break;
    case 'subjects':    content.innerHTML = renderSubjects(); break;
    case 'homework':    content.innerHTML = renderHomework(); break;
    case 'timer':       content.innerHTML = renderTimer(); initTimer(); break;
    case 'flashcards':  content.innerHTML = renderFlashcards(); initFlashcards(); break;
    case 'quizzes':     content.innerHTML = renderQuizzes(); break;
    case 'progress':    content.innerHTML = renderProgress(); initCharts(); break;
    case 'gamification': content.innerHTML = renderGamification(); break;
    case 'ai_checker':  content.innerHTML = renderAIChecker(); break;
    case 'settings':    content.innerHTML = renderSettings(); break;
    case 'about':       content.innerHTML = renderAbout(); break;
    case 'subject_detail': content.innerHTML = renderSubjectDetail(extra); break;
    case 'quiz_play':   content.innerHTML = renderQuizPlay(extra); initQuiz(extra); break;
    case 'search':      content.innerHTML = renderSearchResults(); break;
    default: content.innerHTML = `<div class="empty-state"><div class="empty-icon">🚧</div><h3>Coming Soon</h3></div>`;
  }
  attachPageHandlers(page, extra);
}

/* ===== DASHBOARD ===== */
function renderDashboard() {
  const name = getStore('studentName', 'Student');
  const xp = getStore('xp', 0);
  const streak = getStore('streak', 0);
  const lv = getCurrentLevel(xp);
  const nextLv = getNextLevel(xp);
  const studyMins = getStore('totalStudyMins', 0);
  const quizCount = getStore('quizCount', 0);
  const completedChapters = getStore('completedChapters', []);
  const hw = getStore('homework', []);
  const pending = hw.filter(h => !h.completed);
  const done = hw.filter(h => h.completed);
  const activities = getStore('activities', []);

  const xpToNext = nextLv ? nextLv.xp - lv.xp : 0;
  const xpProgress = nextLv ? Math.round(((xp - lv.xp) / xpToNext) * 100) : 100;

  const hours = Math.floor(studyMins / 60);
  const mins = studyMins % 60;

  const recentActs = activities.slice(0, 6);

  return `
  <div class="dashboard-welcome">
    <div class="welcome-title">${t('Welcome back')}, ${name}! 👋</div>
    <div class="welcome-subtitle">Keep up the great work. You're on a ${streak}-day streak!</div>
  </div>

  <div class="stats-grid">
    <div class="stat-card"><div class="stat-icon orange">🔥</div><div><div class="stat-value">${streak}</div><div class="stat-label">Day Streak</div></div></div>
    <div class="stat-card"><div class="stat-icon blue">⭐</div><div><div class="stat-value">${xp.toLocaleString()}</div><div class="stat-label">Total XP</div></div></div>
    <div class="stat-card"><div class="stat-icon purple">🎖️</div><div><div class="stat-value">Lv. ${lv.level}</div><div class="stat-label">${lv.name}</div></div></div>
    <div class="stat-card"><div class="stat-icon green">⏱️</div><div><div class="stat-value">${hours}h ${mins}m</div><div class="stat-label">Study Time</div></div></div>
    <div class="stat-card"><div class="stat-icon yellow">🎯</div><div><div class="stat-value">${quizCount}</div><div class="stat-label">Quizzes Done</div></div></div>
    <div class="stat-card"><div class="stat-icon pink">📚</div><div><div class="stat-value">${completedChapters.length}</div><div class="stat-label">Chapters Done</div></div></div>
    <div class="stat-card"><div class="stat-icon orange">📋</div><div><div class="stat-value">${pending.length}</div><div class="stat-label">Pending HW</div></div></div>
    <div class="stat-card"><div class="stat-icon green">✅</div><div><div class="stat-value">${done.length}</div><div class="stat-label">HW Completed</div></div></div>
  </div>

  <div class="section-title">⚡ Quick Access</div>
  <div class="quick-actions mb-2">
    <div class="quick-action-btn" onclick="navigate('subjects')"><div class="qa-icon">📚</div><div class="qa-label">Syllabus</div></div>
    <div class="quick-action-btn" onclick="navigate('homework')"><div class="qa-icon">📝</div><div class="qa-label">Homework</div></div>
    <div class="quick-action-btn" onclick="navigate('timer')"><div class="qa-icon">⏱️</div><div class="qa-label">Timer</div></div>
    <div class="quick-action-btn" onclick="navigate('flashcards')"><div class="qa-icon">🃏</div><div class="qa-label">Flashcards</div></div>
    <div class="quick-action-btn" onclick="navigate('quizzes')"><div class="qa-icon">🎯</div><div class="qa-label">Quizzes</div></div>
    <div class="quick-action-btn" onclick="navigate('progress')"><div class="qa-icon">📊</div><div class="qa-label">Progress</div></div>
    <div class="quick-action-btn" onclick="navigate('gamification')"><div class="qa-icon">🏆</div><div class="qa-label">Achievements</div></div>
    <div class="quick-action-btn" onclick="navigate('ai_checker')"><div class="qa-icon">🤖</div><div class="qa-label">AI Checker</div></div>
  </div>

  <div class="dashboard-grid">
    <div class="card">
      <div class="card-title">📊 XP Progress</div>
      <div class="card-subtitle">Level ${lv.level} – ${lv.name}</div>
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">
          <span>${xp} XP</span><span>${nextLv ? nextLv.xp + ' XP' : 'MAX'}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${xpProgress}%"></div></div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${nextLv ? `${nextLv.xp - xp} XP to Level ${nextLv.level}` : 'Maximum level reached!'}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🕐 Recent Activity</div>
      <div class="activity-list">
        ${recentActs.length ? recentActs.map(a => `
          <div class="activity-item">
            <div class="activity-dot ${a.color || 'blue'}"></div>
            <div class="activity-text">${a.text}</div>
            <div class="activity-time">${formatTime(a.time)}</div>
          </div>`).join('') : '<div class="text-muted" style="font-size:0.85rem;padding:8px 0;">No recent activity. Start studying!</div>'}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">📋 Pending Assignments</div>
    ${pending.length === 0
      ? '<div class="text-muted" style="font-size:0.85rem;padding:8px 0;">No pending assignments. 🎉</div>'
      : pending.slice(0,4).map(hw => `
        <div class="activity-item">
          <div class="activity-dot ${isOverdue(hw.due) ? 'red' : 'orange'}"></div>
          <div class="activity-text"><strong>${hw.title}</strong> – ${hw.subject}</div>
          <div class="activity-time" style="color:${isOverdue(hw.due) ? 'var(--accent-red)' : ''}">${formatDate(hw.due)}</div>
        </div>`).join('')
    }
    ${pending.length > 4 ? `<div style="margin-top:10px;"><span class="btn btn-secondary btn-sm" onclick="navigate('homework')">View all ${pending.length} assignments →</span></div>` : ''}
  </div>`;
}

/* ===== SUBJECTS ===== */
function renderSubjects() {
  if (!state.syllabus) return '<div class="empty-state"><div class="empty-icon">⏳</div><h3>Loading syllabus...</h3></div>';

  const classObj = state.syllabus.classes.find(c => c.id === state.currentClass);

  const classTabs = state.syllabus.classes.map(c =>
    `<div class="class-tab ${c.id === state.currentClass ? 'active' : ''}" onclick="switchClass('${c.id}')">${c.label}</div>`
  ).join('');

  const subjectColors = ['blue', 'green', 'orange', 'purple', 'pink'];
  const subjectIcons = { 'Mathematics': '📐', 'Science': '🔬', 'Social Science': '🌍', 'English': '📖', 'Hindi': '📜', 'Hindi – Course A': '📜', 'Hindi – Course B': '📜' };

  const subjects = classObj.subjects.map((sub, i) => {
    const completedChapters = getStore('completedChapters', []);
    let totalChapters = 0;
    let completedCount = 0;

    if (sub.parts) {
      sub.parts.forEach(p => { p.chapters.forEach(ch => { totalChapters++; if (completedChapters.includes(ch.id)) completedCount++; }); });
    } else if (sub.books) {
      sub.books.forEach(b => { if (b.chapters) b.chapters.forEach(ch => { totalChapters++; if (completedChapters.includes(ch.id)) completedCount++; }); });
    }

    const pct = totalChapters ? Math.round((completedCount / totalChapters) * 100) : 0;

    return `
    <div class="subject-card" onclick="navigate('subject_detail', {classId:'${classObj.id}', subjectId:'${sub.id}'})">
      <div class="subject-card-header">
        <div class="subject-icon ${subjectColors[i % subjectColors.length]}">${subjectIcons[sub.name] || '📗'}</div>
        <div>
          <div style="font-weight:600;">${sub.name}</div>
          <div class="subject-book">${sub.book || 'Multiple Books'}</div>
        </div>
      </div>
      <div class="subject-card-body">
        <div class="subject-chapters">${totalChapters} chapters · ${completedCount} completed</div>
      </div>
      <div class="subject-progress">
        <div class="progress-label"><span>Progress</span><span>${pct}%</span></div>
        <div class="progress-bar-wrap"><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="page-header">
    <div class="page-header-text"><h2>📚 Subjects & Syllabus</h2><p>NCERT textbooks for 2026–27 session</p></div>
  </div>
  <div class="class-tabs">${classTabs}</div>
  <div class="subjects-grid">${subjects}</div>`;
}

function switchClass(classId) {
  state.currentClass = classId;
  navigate('subjects');
}

/* ===== SUBJECT DETAIL ===== */
function renderSubjectDetail(extra) {
  if (!extra || !state.syllabus) return '';
  const classObj = state.syllabus.classes.find(c => c.id === extra.classId);
  const subject = classObj?.subjects.find(s => s.id === extra.subjectId);
  if (!subject) return '';

  const completedChapters = getStore('completedChapters', []);

  function chapterListHTML(chapters, bookTitle) {
    return chapters.map(ch => {
      const done = completedChapters.includes(ch.id);
      return `
      <div class="chapter-item ${done ? 'completed' : ''}" data-ch-id="${ch.id}">
        <div class="chapter-num">${done ? '✓' : ch.num}</div>
        <div class="chapter-info">
          <div class="chapter-title">${ch.title}</div>
          <div class="chapter-desc">${ch.desc}</div>
        </div>
        <div class="chapter-actions">
          <button class="btn btn-sm ${done ? 'btn-success' : 'btn-secondary'}" onclick="toggleChapter('${ch.id}',event)">${done ? '✓ Done' : 'Mark Done'}</button>
        </div>
      </div>`;
    }).join('');
  }

  let chaptersSection = '';

  if (subject.parts) {
    subject.parts.forEach(p => {
      chaptersSection += `<div class="section-title">Part ${p.part}</div><div class="chapter-list">${chapterListHTML(p.chapters)}</div><div style="margin-bottom:20px;"></div>`;
    });
  } else if (subject.books) {
    subject.books.forEach(bk => {
      chaptersSection += `<div class="section-title">${bk.title}<span style="font-size:0.75rem;color:var(--text-muted);font-weight:400;margin-left:8px;">${bk.subject || ''}</span></div><div class="chapter-list">${chapterListHTML(bk.chapters || [])}</div><div style="margin-bottom:20px;"></div>`;
    });
  }

  return `
  <div class="page-header">
    <div class="page-header-text">
      <h2>${subject.name}</h2>
      <p>${classObj.label} · ${subject.book || 'Multiple Books'}</p>
    </div>
    <button class="btn btn-secondary" onclick="navigate('subjects')">← Back</button>
  </div>
  <div style="margin-bottom:20px;">
    <a href="https://ncert.nic.in/textbook.php" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">📥 Official NCERT Textbooks ↗</a>
  </div>
  ${chaptersSection}`;
}

function toggleChapter(chId, event) {
  event.stopPropagation();
  const completed = getStore('completedChapters', []);
  const idx = completed.indexOf(chId);
  if (idx === -1) {
    completed.push(chId);
    addXP(20, 'Chapter completed');
    showToast('Chapter Completed!', '+20 XP earned', 'success', '📚');
  } else {
    completed.splice(idx, 1);
  }
  setStore('completedChapters', completed);
  checkAchievements();
  // re-render page
  navigate('subject_detail', state._subjectDetailExtra);
}

/* ===== HOMEWORK ===== */
function renderHomework() {
  const hw = getStore('homework', []);
  const filter = state._hwFilter || 'pending';

  const pending = hw.filter(h => !h.completed);
  const done = hw.filter(h => h.completed);
  const display = filter === 'pending' ? pending : filter === 'completed' ? done : hw;
  const subjects = ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi', 'Other'];

  const sortedDisplay = [...display].sort((a, b) => {
    if (!a.due) return 1; if (!b.due) return -1;
    return new Date(a.due) - new Date(b.due);
  });

  return `
  <div class="page-header">
    <div class="page-header-text"><h2>📝 Homework Tracker</h2><p>Manage your assignments and deadlines</p></div>
    <button class="btn btn-primary" onclick="openHWModal()">+ Add Homework</button>
  </div>

  <div class="hw-tabs">
    <div class="hw-tab ${filter==='pending'?'active':''}" onclick="setHWFilter('pending')">Pending (${pending.length})</div>
    <div class="hw-tab ${filter==='completed'?'active':''}" onclick="setHWFilter('completed')">Completed (${done.length})</div>
    <div class="hw-tab ${filter==='all'?'active':''}" onclick="setHWFilter('all')">All (${hw.length})</div>
  </div>

  <div id="hw-list" class="hw-list">
    ${sortedDisplay.length === 0
      ? `<div class="empty-state"><div class="empty-icon">🎉</div><h3>No assignments here</h3><p>${filter==='pending' ? 'You\'re all caught up!' : 'Nothing to show.'}</p></div>`
      : sortedDisplay.map(h => `
        <div class="hw-card ${h.completed?'completed':''} ${!h.completed&&isOverdue(h.due)?'overdue':''}">
          <div class="hw-checkbox ${h.completed?'checked':''}" onclick="toggleHW('${h.id}')">${h.completed?'✓':''}</div>
          <div class="hw-info">
            <div class="hw-title" style="${h.completed?'text-decoration:line-through;':''}">${h.title}</div>
            <div class="hw-meta">
              <span class="hw-subject">${h.subject}</span>
              ${h.due ? `<span class="hw-due ${!h.completed&&isOverdue(h.due)?'overdue':''}">Due: ${formatDate(h.due)}${!h.completed&&isOverdue(h.due)?' (Overdue)':''}</span>` : ''}
            </div>
            ${h.desc ? `<div class="hw-desc">${h.desc}</div>` : ''}
          </div>
          <div class="hw-actions">
            <button class="btn btn-sm btn-secondary" onclick="editHW('${h.id}')">✏️</button>
            <button class="btn btn-sm btn-danger" onclick="deleteHW('${h.id}')">🗑️</button>
          </div>
        </div>`).join('')
    }
  </div>

  <!-- Add/Edit Modal -->
  <div class="modal-overlay hidden" id="hw-modal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title" id="hw-modal-title">Add Homework</div>
        <button class="modal-close" onclick="closeHWModal()">✕</button>
      </div>
      <div class="hw-form">
        <input id="id-hidden" type="hidden" value="">
        <div>
          <label class="form-label">Assignment Title *</label>
          <input id="hw-title-input" type="text" placeholder="e.g. Chapter 2 Exercise 2.1">
        </div>
        <div class="form-row">
          <div>
            <label class="form-label">Subject *</label>
            <select id="hw-subject-input">
              ${subjects.map(s=>`<option>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Due Date</label>
            <input id="hw-due-input" type="date">
          </div>
        </div>
        <div>
          <label class="form-label">Description (optional)</label>
          <textarea id="hw-desc-input" placeholder="Add notes or details..."></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn btn-secondary" onclick="closeHWModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveHW()">Save Assignment</button>
        </div>
      </div>
    </div>
  </div>`;
}

function setHWFilter(f) { state._hwFilter = f; navigate('homework'); }

function openHWModal(id) {
  const modal = document.getElementById('hw-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (id) {
    const hw = getStore('homework', []).find(h => h.id === id);
    if (hw) {
      document.getElementById('id-hidden').value = hw.id;
      document.getElementById('hw-title-input').value = hw.title;
      document.getElementById('hw-subject-input').value = hw.subject;
      document.getElementById('hw-due-input').value = hw.due || '';
      document.getElementById('hw-desc-input').value = hw.desc || '';
      document.getElementById('hw-modal-title').textContent = 'Edit Homework';
    }
  } else {
    document.getElementById('id-hidden').value = '';
    document.getElementById('hw-title-input').value = '';
    document.getElementById('hw-due-input').value = '';
    document.getElementById('hw-desc-input').value = '';
    document.getElementById('hw-modal-title').textContent = 'Add Homework';
  }
}

function closeHWModal() { document.getElementById('hw-modal')?.classList.add('hidden'); }

function saveHW() {
  const title = document.getElementById('hw-title-input').value.trim();
  if (!title) { showToast('Error', 'Please enter a title', 'error', '❌'); return; }
  const hw = getStore('homework', []);
  const id = document.getElementById('id-hidden').value;
  const entry = {
    id: id || `hw_${Date.now()}`,
    title,
    subject: document.getElementById('hw-subject-input').value,
    due: document.getElementById('hw-due-input').value,
    desc: document.getElementById('hw-desc-input').value.trim(),
    completed: false,
    createdAt: Date.now()
  };
  if (id) {
    const idx = hw.findIndex(h => h.id === id);
    if (idx !== -1) { entry.completed = hw[idx].completed; hw[idx] = entry; }
  } else {
    hw.push(entry);
    const activity = getStore('activities', []);
    activity.unshift({ text: `Added homework: ${title}`, time: Date.now(), color: 'blue' });
    setStore('activities', activity.slice(0, 20));
  }
  setStore('homework', hw);
  closeHWModal();
  navigate('homework');
  showToast('Saved!', id ? 'Assignment updated' : 'Assignment added', 'success', '✅');
}

function toggleHW(id) {
  const hw = getStore('homework', []);
  const h = hw.find(h => h.id === id);
  if (!h) return;
  h.completed = !h.completed;
  setStore('homework', hw);
  if (h.completed) {
    addXP(15, 'Homework completed');
    setStore('hwCompleted', getStore('hwCompleted', 0) + 1);
    checkAchievements();
  }
  navigate('homework');
}

function editHW(id) { openHWModal(id); }

function deleteHW(id) {
  if (!confirm('Delete this assignment?')) return;
  const hw = getStore('homework', []).filter(h => h.id !== id);
  setStore('homework', hw);
  navigate('homework');
  showToast('Deleted', 'Assignment removed', 'info', '🗑️');
}

/* ===== TIMER ===== */
function renderTimer() {
  const r = 90; const c = 2 * Math.PI * r;
  return `
  <div class="timer-container">
    <div class="page-header" style="text-align:center;display:block;">
      <div class="page-header-text"><h2>⏱️ Study Timer</h2><p>Focus with the Pomodoro technique</p></div>
    </div>
    <div class="timer-tabs">
      <div class="timer-tab active" id="tt-study" onclick="setTimerType('study')">Study (25m)</div>
      <div class="timer-tab" id="tt-short" onclick="setTimerType('short')">Short Break (5m)</div>
      <div class="timer-tab" id="tt-long" onclick="setTimerType('long')">Long Break (15m)</div>
    </div>

    <div class="timer-circle-wrap">
      <svg width="240" height="240" viewBox="0 0 240 240">
        <circle class="timer-circle-bg" cx="120" cy="120" r="${r}" stroke-width="10"/>
        <circle class="timer-circle-fg" cx="120" cy="120" r="${r}" stroke-width="10"
          stroke-dasharray="${c}" stroke-dashoffset="0" id="timer-circle"/>
      </svg>
      <div class="timer-display">
        <div class="timer-time" id="timer-display">25:00</div>
        <div class="timer-label" id="timer-label">Study Session</div>
      </div>
    </div>

    <div class="timer-controls">
      <button class="btn btn-primary" id="timer-start-btn" onclick="toggleTimer()">▶ Start</button>
      <button class="btn btn-secondary" onclick="resetTimer()">↺ Reset</button>
    </div>

    <div class="timer-settings">
      <h3>⚙️ Timer Settings</h3>
      <div class="timer-setting-row">
        <label>Study Duration (minutes)</label>
        <input type="number" id="cfg-study" value="${state.timerConfig.study}" min="1" max="90" onchange="updateTimerConfig()">
      </div>
      <div class="timer-setting-row">
        <label>Short Break (minutes)</label>
        <input type="number" id="cfg-short" value="${state.timerConfig.short}" min="1" max="30" onchange="updateTimerConfig()">
      </div>
      <div class="timer-setting-row">
        <label>Long Break (minutes)</label>
        <input type="number" id="cfg-long" value="${state.timerConfig.long}" min="1" max="60" onchange="updateTimerConfig()">
      </div>
    </div>

    <div class="timer-stats">
      <div class="timer-stat"><div class="timer-stat-val" id="ts-sessions">${getStore('pomodoroCount',0)}</div><div class="timer-stat-lbl">Sessions</div></div>
      <div class="timer-stat"><div class="timer-stat-val" id="ts-hours">${Math.floor(getStore('totalStudyMins',0)/60)}h ${getStore('totalStudyMins',0)%60}m</div><div class="timer-stat-lbl">Total Study</div></div>
      <div class="timer-stat"><div class="timer-stat-val" id="ts-today">${getStore('todayStudyMins',0)}m</div><div class="timer-stat-lbl">Today</div></div>
    </div>
  </div>`;
}

function initTimer() {
  state.timerRunning = false;
  state.timerType = state.timerType || 'study';
  state.timerSeconds = state.timerConfig[state.timerType] * 60;
  updateTimerDisplay();
}

function setTimerType(type) {
  if (state.timerRunning) { clearInterval(state.timerInterval); state.timerRunning = false; }
  state.timerType = type;
  state.timerSeconds = state.timerConfig[type] * 60;
  document.querySelectorAll('.timer-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tt-${type}`)?.classList.add('active');
  document.getElementById('timer-start-btn').textContent = '▶ Start';
  updateTimerDisplay();
}

function toggleTimer() {
  if (state.timerRunning) {
    clearInterval(state.timerInterval);
    state.timerRunning = false;
    document.getElementById('timer-start-btn').textContent = '▶ Resume';
  } else {
    state.timerRunning = true;
    document.getElementById('timer-start-btn').textContent = '⏸ Pause';
    state.timerInterval = setInterval(() => {
      state.timerSeconds--;
      if (state.timerSeconds <= 0) {
        clearInterval(state.timerInterval);
        state.timerRunning = false;
        timerComplete();
        return;
      }
      updateTimerDisplay();
      if (state.timerType === 'study') {
        setStore('totalStudyMins', getStore('totalStudyMins', 0) + 1/60);
        setStore('todayStudyMins', getStore('todayStudyMins', 0) + 1/60);
      }
    }, 1000);
  }
}

function timerComplete() {
  const labels = { study: 'Study session', short: 'Short break', long: 'Long break' };
  if (state.timerType === 'study') {
    addXP(25, 'Study session completed');
    setStore('pomodoroCount', getStore('pomodoroCount', 0) + 1);
    const totalMins = state.timerConfig.study;
    setStore('totalStudyMins', Math.round(getStore('totalStudyMins', 0) + totalMins));
    setStore('todayStudyMins', Math.round(getStore('todayStudyMins', 0) + totalMins));
    checkAchievements();
  }
  showToast('Session Complete!', `${labels[state.timerType]} finished 🎉`, 'success', '⏱️');
  state.timerSeconds = 0;
  updateTimerDisplay();
  document.getElementById('timer-start-btn').textContent = '▶ Start';
  document.getElementById('ts-sessions').textContent = getStore('pomodoroCount', 0);
}

function resetTimer() {
  clearInterval(state.timerInterval);
  state.timerRunning = false;
  state.timerSeconds = state.timerConfig[state.timerType] * 60;
  document.getElementById('timer-start-btn').textContent = '▶ Start';
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const m = Math.floor(state.timerSeconds / 60);
  const s = state.timerSeconds % 60;
  const disp = document.getElementById('timer-display');
  if (disp) disp.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  const labels = { study: 'Study Session', short: 'Short Break', long: 'Long Break' };
  const lbl = document.getElementById('timer-label');
  if (lbl) lbl.textContent = labels[state.timerType] || '';
  // Update circle
  const total = state.timerConfig[state.timerType] * 60;
  const r = 90; const circ = 2 * Math.PI * r;
  const pct = state.timerSeconds / total;
  const circle = document.getElementById('timer-circle');
  if (circle) circle.style.strokeDashoffset = circ * (1 - pct);
  // Update circle color
  const colors = { study: 'var(--accent)', short: 'var(--accent-green)', long: 'var(--accent-purple)' };
  if (circle) circle.style.stroke = colors[state.timerType];
}

function updateTimerConfig() {
  state.timerConfig.study = parseInt(document.getElementById('cfg-study')?.value) || 25;
  state.timerConfig.short = parseInt(document.getElementById('cfg-short')?.value) || 5;
  state.timerConfig.long = parseInt(document.getElementById('cfg-long')?.value) || 15;
  document.querySelectorAll('.timer-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tt-${state.timerType}`)?.classList.add('active');
  if (!state.timerRunning) {
    state.timerSeconds = state.timerConfig[state.timerType] * 60;
    updateTimerDisplay();
  }
}

/* ===== FLASHCARDS ===== */
function renderFlashcards() {
  const userDecks = getStore('userFlashcards', []);
  const builtInDecks = state.flashcardsData?.decks || [];
  const allDecks = [...builtInDecks, ...userDecks];

  const deckOptions = allDecks.map(d => `<option value="${d.id}">${d.title} (${d.cards.length} cards)</option>`).join('');

  return `
  <div class="page-header">
    <div class="page-header-text"><h2>🃏 Flashcards</h2><p>Review and memorize key concepts</p></div>
  </div>

  <div class="flashcard-controls">
    <select class="fc-deck-select" id="fc-deck-select" onchange="loadFCDeck()">
      <option value="">-- Select a deck --</option>
      ${deckOptions}
    </select>
    <button class="btn btn-primary btn-sm" onclick="showCreateFC()">+ Create Deck</button>
  </div>

  <div id="fc-arena" class="flashcard-arena"></div>

  <div id="create-fc-section" class="hidden card">
    <div class="card-title">➕ Create Flashcard Deck</div>
    <div class="fc-create-form mt-2">
      <input type="text" id="fc-deck-title" placeholder="Deck title (e.g. Physics Formulas)">
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <select id="fc-deck-class">
          <option value="class8">Class 8</option>
          <option value="class9" selected>Class 9</option>
          <option value="class10">Class 10</option>
        </select>
        <input type="text" id="fc-deck-subject" placeholder="Subject">
      </div>
      <div id="fc-cards-input"></div>
      <button class="btn btn-secondary btn-sm" onclick="addFCCardInput()">+ Add Card</button>
      <div style="display:flex;gap:10px;margin-top:8px;">
        <button class="btn btn-primary" onclick="saveFCDeck()">Save Deck</button>
        <button class="btn btn-secondary" onclick="hideCreateFC()">Cancel</button>
      </div>
    </div>
  </div>`;
}

let fcCardInputCount = 0;

function initFlashcards() {
  state.currentFcDeck = null;
  fcCardInputCount = 0;
}

function loadFCDeck() {
  const id = document.getElementById('fc-deck-select')?.value;
  if (!id) { document.getElementById('fc-arena').innerHTML = ''; return; }

  const builtIn = state.flashcardsData?.decks || [];
  const user = getStore('userFlashcards', []);
  const deck = [...builtIn, ...user].find(d => d.id === id);
  if (!deck) return;

  state.currentFcDeck = deck;
  state.currentFcIndex = 0;
  state.currentFcFlipped = false;

  setStore('fcDecksReviewed', getStore('fcDecksReviewed', 0) + 1);
  checkAchievements();
  renderFCArena();
}

function renderFCArena() {
  const deck = state.currentFcDeck;
  if (!deck) return;
  const arena = document.getElementById('fc-arena');
  if (!arena) return;
  const learned = getStore('fcLearned_' + deck.id, []);
  const idx = state.currentFcIndex;
  const card = deck.cards[idx];
  if (!card) return;
  const flipped = state.currentFcFlipped;

  arena.innerHTML = `
    <div class="flashcard ${flipped ? 'flipped' : ''}" onclick="flipFC()" id="fc-card">
      <div class="fc-inner">
        <div class="fc-front">
          <div class="fc-label">Question</div>
          <div class="fc-text">${card.question}</div>
          <div class="fc-hint">Click to reveal answer</div>
        </div>
        <div class="fc-back">
          <div class="fc-label">Answer</div>
          <div class="fc-text">${card.answer}</div>
        </div>
      </div>
    </div>

    <div class="fc-nav">
      <button class="btn btn-secondary btn-sm" onclick="prevFC()" ${idx===0?'disabled':''}>← Prev</button>
      <span class="fc-counter">${idx+1} / ${deck.cards.length}</span>
      <button class="btn btn-secondary btn-sm" onclick="nextFC()" ${idx===deck.cards.length-1?'disabled':''}>Next →</button>
    </div>

    ${flipped ? `
    <div class="fc-progress">
      <button class="fc-prog-btn know" onclick="markFC('know')">👍 I know this</button>
      <button class="fc-prog-btn review" onclick="markFC('review')">🔄 Review again</button>
    </div>` : ''}

    <div style="text-align:center;margin-top:12px;font-size:0.8rem;color:var(--text-muted);">
      Learned: ${learned.length} / ${deck.cards.length}
    </div>`;
}

function flipFC() { state.currentFcFlipped = !state.currentFcFlipped; renderFCArena(); }
function nextFC() { if (state.currentFcIndex < state.currentFcDeck.cards.length - 1) { state.currentFcIndex++; state.currentFcFlipped = false; renderFCArena(); } }
function prevFC() { if (state.currentFcIndex > 0) { state.currentFcIndex--; state.currentFcFlipped = false; renderFCArena(); } }

function markFC(status) {
  const deck = state.currentFcDeck;
  if (!deck) return;
  const card = deck.cards[state.currentFcIndex];
  if (status === 'know') {
    const learned = getStore('fcLearned_' + deck.id, []);
    if (!learned.includes(card.id)) {
      learned.push(card.id);
      setStore('fcLearned_' + deck.id, learned);
      addXP(5, 'Flashcard learned');
    }
  }
  if (state.currentFcIndex < deck.cards.length - 1) {
    nextFC();
  } else {
    showToast('Deck Complete!', 'You\'ve reviewed all cards! 🎉', 'success', '🃏');
  }
}

function showCreateFC() { document.getElementById('create-fc-section')?.classList.remove('hidden'); addFCCardInput(); }
function hideCreateFC() { document.getElementById('create-fc-section')?.classList.add('hidden'); document.getElementById('fc-cards-input').innerHTML = ''; fcCardInputCount = 0; }

function addFCCardInput() {
  const container = document.getElementById('fc-cards-input');
  if (!container) return;
  const i = fcCardInputCount++;
  const div = document.createElement('div');
  div.style.cssText = 'border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;';
  div.innerHTML = `
    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">Card ${i+1}</div>
    <input type="text" id="fc-q-${i}" placeholder="Question" style="margin-bottom:6px;">
    <input type="text" id="fc-a-${i}" placeholder="Answer">`;
  container.appendChild(div);
}

function saveFCDeck() {
  const title = document.getElementById('fc-deck-title')?.value.trim();
  if (!title) { showToast('Error', 'Please enter a deck title', 'error', '❌'); return; }
  const cards = [];
  for (let i = 0; i < fcCardInputCount; i++) {
    const q = document.getElementById(`fc-q-${i}`)?.value.trim();
    const a = document.getElementById(`fc-a-${i}`)?.value.trim();
    if (q && a) cards.push({ id: `uc_${i}`, question: q, answer: a });
  }
  if (cards.length === 0) { showToast('Error', 'Add at least one card', 'error', '❌'); return; }
  const deck = {
    id: `ud_${Date.now()}`,
    title,
    class: document.getElementById('fc-deck-class')?.value,
    subject: document.getElementById('fc-deck-subject')?.value || 'General',
    cards
  };
  const userDecks = getStore('userFlashcards', []);
  userDecks.push(deck);
  setStore('userFlashcards', userDecks);
  hideCreateFC();
  navigate('flashcards');
  showToast('Deck Created!', `"${title}" with ${cards.length} cards`, 'success', '🃏');
}

/* ===== QUIZZES ===== */
function renderQuizzes() {
  const history = getStore('quizHistory', []);
  const quizList = state.quizzes?.quizzes || [];

  return `
  <div class="page-header">
    <div class="page-header-text"><h2>🎯 Quizzes</h2><p>Test your knowledge chapter by chapter</p></div>
  </div>
  <div class="section-title">📚 Available Quizzes</div>
  <div class="quiz-selector">
    ${quizList.map(q => `
      <div class="quiz-card" onclick="navigate('quiz_play', '${q.id}')">
        <div class="quiz-card-icon">🎯</div>
        <div class="quiz-card-title">${q.title}</div>
        <div class="quiz-card-meta">${q.class.replace('class','Class ')} · ${q.subject} · ${q.questions.length} questions</div>
        ${history.some(h=>h.id===q.id) ? `<div style="margin-top:8px;font-size:0.75rem;color:var(--accent-green);">Best: ${history.filter(h=>h.id===q.id).reduce((a,b)=>Math.max(a,b.pct),0)}%</div>` : ''}
      </div>`).join('')}
  </div>

  ${history.length > 0 ? `
  <div class="section-divider"></div>
  <div class="section-title">📋 Recent Quiz Results</div>
  <div class="chapter-list">
    ${history.slice(0,5).map(h => `
      <div class="chapter-item">
        <div class="chapter-num" style="background:rgba(88,166,255,0.1);color:var(--accent);">🎯</div>
        <div class="chapter-info">
          <div class="chapter-title">${h.title}</div>
          <div class="chapter-desc">${formatTime(h.time)} · ${h.score}/${h.total} correct</div>
        </div>
        <div style="font-size:1rem;font-weight:700;color:${h.pct>=70?'var(--accent-green)':h.pct>=40?'var(--accent-orange)':'var(--accent-red)'};">${h.pct}%</div>
      </div>`).join('')}
  </div>` : ''}`;
}

function renderQuizPlay(quizId) {
  const quiz = state.quizzes?.quizzes.find(q => q.id === quizId);
  if (!quiz) return '<div class="empty-state"><div class="empty-icon">❌</div><h3>Quiz not found</h3></div>';
  return `
  <div class="page-header">
    <div class="page-header-text"><h2>${quiz.title}</h2><p>${quiz.questions.length} questions</p></div>
    <button class="btn btn-secondary" onclick="navigate('quizzes')">← Back</button>
  </div>
  <div id="quiz-container" class="quiz-arena"></div>`;
}

function initQuiz(quizId) {
  if (!quizId) return;
  const quiz = state.quizzes?.quizzes.find(q => q.id === quizId);
  if (!quiz) return;
  state.currentQuiz = quiz;
  state.currentQ = 0;
  state.quizAnswers = new Array(quiz.questions.length).fill(null);
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const quiz = state.currentQuiz;
  const container = document.getElementById('quiz-container');
  if (!quiz || !container) return;

  const answered = state.quizAnswers.filter(a => a !== null).length;
  const pct = Math.round((answered / quiz.questions.length) * 100);

  if (state.currentQ >= quiz.questions.length) {
    // Show result
    const correct = state.quizAnswers.filter((a, i) => a === quiz.questions[i].answer).length;
    const score = Math.round((correct / quiz.questions.length) * 100);
    const xpEarned = correct * 10;

    // Save to history
    const history = getStore('quizHistory', []);
    history.unshift({ id: quiz.id, title: quiz.title, score: correct, total: quiz.questions.length, pct: score, time: Date.now() });
    setStore('quizHistory', history.slice(0, 20));
    setStore('quizCount', getStore('quizCount', 0) + 1);
    addXP(xpEarned, `Quiz: ${quiz.title}`);
    checkAchievements();

    const activity = getStore('activities', []);
    activity.unshift({ text: `Quiz "${quiz.title}": ${score}%`, time: Date.now(), color: score >= 70 ? 'green' : 'orange' });
    setStore('activities', activity.slice(0, 20));

    container.innerHTML = `
    <div class="quiz-result">
      <div style="font-size:2rem;">${score >= 80 ? '🏆' : score >= 60 ? '🎉' : '📚'}</div>
      <div class="quiz-result-score" style="color:${score>=70?'var(--accent-green)':score>=40?'var(--accent-orange)':'var(--accent-red)'};">${score}%</div>
      <div class="quiz-result-label">${correct} out of ${quiz.questions.length} correct</div>
      <div class="quiz-result-xp">+${xpEarned} XP earned!</div>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button class="btn btn-primary" onclick="initQuiz('${quiz.id}')">Try Again</button>
        <button class="btn btn-secondary" onclick="navigate('quizzes')">Back to Quizzes</button>
      </div>
    </div>`;
    return;
  }

  const q = quiz.questions[state.currentQ];
  const answered_q = state.quizAnswers[state.currentQ];

  container.innerHTML = `
  <div class="quiz-header">
    <div class="quiz-progress-info"><span>Question ${state.currentQ + 1} of ${quiz.questions.length}</span><span>${answered} answered</span></div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
  </div>

  <div class="question-card">
    <div class="question-text">${q.text}</div>
    <div class="options-list">
      ${q.options.map((opt, i) => {
        let cls = '';
        if (answered_q !== null) {
          if (i === q.answer) cls = 'correct';
          else if (i === answered_q) cls = 'wrong';
        }
        return `<button class="option-btn ${cls}" ${answered_q !== null ? 'disabled' : ''} onclick="answerQuestion(${i})">
          <span class="option-label">${String.fromCharCode(65+i)}</span>${opt}
        </button>`;
      }).join('')}
    </div>
    ${answered_q !== null ? `<div class="quiz-explanation">💡 ${q.explanation}</div>` : ''}
  </div>

  <div style="display:flex;gap:12px;">
    ${state.currentQ > 0 ? `<button class="btn btn-secondary" onclick="prevQuestion()">← Previous</button>` : ''}
    ${answered_q !== null ? `<button class="btn btn-primary" onclick="nextQuestion()">${state.currentQ < quiz.questions.length - 1 ? 'Next →' : 'See Results'}</button>` : ''}
  </div>`;
}

function answerQuestion(optIdx) {
  if (state.quizAnswers[state.currentQ] !== null) return;
  state.quizAnswers[state.currentQ] = optIdx;
  renderQuizQuestion();
}

function nextQuestion() { state.currentQ++; renderQuizQuestion(); }
function prevQuestion() { state.currentQ--; renderQuizQuestion(); }

/* ===== PROGRESS ===== */
function renderProgress() {
  const xp = getStore('xp', 0);
  const lv = getCurrentLevel(xp);
  const streak = getStore('streak', 0);
  const quizCount = getStore('quizCount', 0);
  const totalMins = Math.round(getStore('totalStudyMins', 0));
  const completed = getStore('completedChapters', []).length;
  const hw = getStore('homework', []);
  const quizHistory = getStore('quizHistory', []);
  const avgScore = quizHistory.length ? Math.round(quizHistory.reduce((a,b) => a + b.pct, 0) / quizHistory.length) : 0;

  return `
  <div class="page-header">
    <div class="page-header-text"><h2>📊 My Progress</h2><p>Track your learning journey</p></div>
  </div>

  <div class="progress-grid">
    <div class="progress-card"><div class="progress-card-icon">⏱️</div><div class="progress-card-val">${Math.floor(totalMins/60)}h ${totalMins%60}m</div><div class="progress-card-lbl">Total Study Time</div></div>
    <div class="progress-card"><div class="progress-card-icon">📚</div><div class="progress-card-val">${completed}</div><div class="progress-card-lbl">Chapters Completed</div></div>
    <div class="progress-card"><div class="progress-card-icon">🎯</div><div class="progress-card-val">${quizCount}</div><div class="progress-card-lbl">Quizzes Taken</div></div>
    <div class="progress-card"><div class="progress-card-icon">📊</div><div class="progress-card-val">${avgScore}%</div><div class="progress-card-lbl">Avg Quiz Score</div></div>
    <div class="progress-card"><div class="progress-card-icon">✅</div><div class="progress-card-val">${hw.filter(h=>h.completed).length}</div><div class="progress-card-lbl">HW Completed</div></div>
    <div class="progress-card"><div class="progress-card-icon">🔥</div><div class="progress-card-val">${streak}</div><div class="progress-card-lbl">Day Streak</div></div>
    <div class="progress-card"><div class="progress-card-icon">⭐</div><div class="progress-card-val">${xp.toLocaleString()}</div><div class="progress-card-lbl">Total XP</div></div>
    <div class="progress-card"><div class="progress-card-icon">🎖️</div><div class="progress-card-val">Lv. ${lv.level}</div><div class="progress-card-lbl">${lv.name}</div></div>
  </div>

  ${quizHistory.length > 0 ? `
  <div class="card mb-2">
    <div class="card-title">🎯 Quiz Score Trend</div>
    <div class="chart-container"><canvas id="quiz-chart"></canvas></div>
  </div>` : ''}

  <div class="card">
    <div class="card-title">📋 Subject Progress</div>
    <div id="subject-progress-bars"></div>
  </div>`;
}

function initCharts() {
  const quizHistory = getStore('quizHistory', []).slice(0, 10).reverse();
  if (quizHistory.length && document.getElementById('quiz-chart')) {
    const ctx = document.getElementById('quiz-chart').getContext('2d');
    if (window.Chart) {
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: quizHistory.map((_, i) => `Quiz ${i+1}`),
          datasets: [{
            label: 'Score (%)',
            data: quizHistory.map(h => h.pct),
            borderColor: '#58a6ff',
            backgroundColor: 'rgba(88,166,255,0.1)',
            tension: 0.3,
            fill: true,
            pointBackgroundColor: '#58a6ff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b949e' } }, x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b949e' } } },
          plugins: { legend: { labels: { color: '#e6edf3' } } }
        }
      });
    }
  }

  // Subject progress bars
  const container = document.getElementById('subject-progress-bars');
  if (!container || !state.syllabus) return;
  const completedChapters = getStore('completedChapters', []);
  const subjectProgress = [];

  state.syllabus.classes.forEach(cl => {
    cl.subjects.forEach(sub => {
      let total = 0, done = 0;
      if (sub.parts) sub.parts.forEach(p => p.chapters.forEach(ch => { total++; if (completedChapters.includes(ch.id)) done++; }));
      else if (sub.books) sub.books.forEach(bk => (bk.chapters||[]).forEach(ch => { total++; if (completedChapters.includes(ch.id)) done++; }));
      if (total) subjectProgress.push({ name: `${sub.name} (${cl.label})`, total, done, pct: Math.round((done/total)*100) });
    });
  });

  container.innerHTML = subjectProgress.map(s => `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px;">
        <span>${s.name}</span><span style="color:var(--text-muted);">${s.done}/${s.total}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${s.pct}%"></div></div>
    </div>`).join('');
}

/* ===== GAMIFICATION ===== */
function renderGamification() {
  const xp = getStore('xp', 0);
  const lv = getCurrentLevel(xp);
  const nextLv = getNextLevel(xp);
  const unlocked = getStore('achievements', []);
  const streak = getStore('streak', 0);

  const xpToNext = nextLv ? nextLv.xp - lv.xp : 100;
  const xpProgress = nextLv ? Math.round(((xp - lv.xp) / xpToNext) * 100) : 100;

  const challenges = [
    { icon: '📚', title: 'Complete a chapter', xp: '+20 XP', done: (getStore('completedChapters', [])).length > 0 },
    { icon: '🎯', title: 'Take a quiz', xp: '+10–50 XP', done: getStore('quizCount', 0) > 0 },
    { icon: '⏱️', title: 'Complete a study session', xp: '+25 XP', done: getStore('pomodoroCount', 0) > 0 },
    { icon: '📝', title: 'Complete homework', xp: '+15 XP', done: getStore('hwCompleted', 0) > 0 },
    { icon: '🃏', title: 'Review a flashcard deck', xp: '+5 XP per card', done: getStore('fcDecksReviewed', 0) > 0 },
  ];

  return `
  <div class="page-header">
    <div class="page-header-text"><h2>🏆 Study Quest</h2><p>Earn XP and unlock achievements</p></div>
  </div>

  <div class="level-banner">
    <div class="level-avatar">🎖️</div>
    <div class="level-info-main">
      <h2>Level ${lv.level} – ${lv.name}</h2>
      <p>🔥 ${streak}-day streak · ⭐ ${xp.toLocaleString()} XP total</p>
      <div class="level-xp-bar">
        <div class="xp-bar"><div class="xp-fill" style="width:${xpProgress}%"></div></div>
        <div class="level-xp-label">${nextLv ? `${xp - lv.xp} / ${xpToNext} XP to Level ${nextLv.level}` : 'Maximum level!'}</div>
      </div>
    </div>
  </div>

  <div class="section-title">🎯 Daily Activities</div>
  <div class="daily-challenges mb-2">
    ${challenges.map(c => `
      <div class="challenge-item">
        <div class="challenge-icon">${c.icon}</div>
        <div class="challenge-info">
          <div class="challenge-title">${c.title}</div>
          <div class="challenge-xp">${c.xp}</div>
        </div>
        <div class="challenge-status" style="color:${c.done?'var(--accent-green)':'var(--text-muted)'};">${c.done ? '✅' : '○'}</div>
      </div>`).join('')}
  </div>

  <div class="section-title">🏅 Achievements (${unlocked.length}/${ACHIEVEMENTS.length})</div>
  <div class="achievements-grid">
    ${ACHIEVEMENTS.map(a => {
      const isUnlocked = unlocked.includes(a.id);
      return `
      <div class="achievement-card ${isUnlocked ? 'unlocked' : 'achievement-locked'}">
        <div class="achievement-icon">${a.icon}</div>
        <div class="achievement-name">${a.name}</div>
        <div class="achievement-desc">${a.desc}</div>
        ${isUnlocked ? '<div style="color:var(--accent-yellow);font-size:0.72rem;margin-top:4px;">✨ Unlocked</div>' : ''}
      </div>`;
    }).join('')}
  </div>

  <div class="section-divider"></div>
  <div class="section-title">📈 Level Roadmap</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;">
    ${LEVELS.map(l => `
      <div style="background:var(--bg-card);border:1px solid ${xp>=l.xp?'var(--accent)':'var(--border)'};border-radius:var(--radius-sm);padding:12px;text-align:center;">
        <div style="font-weight:700;color:${xp>=l.xp?'var(--accent)':'var(--text-muted)'};">Lv. ${l.level}</div>
        <div style="font-size:0.8rem;">${l.name}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">${l.xp.toLocaleString()} XP</div>
      </div>`).join('')}
  </div>`;
}

/* ===== AI CHECKER ===== */
function renderAIChecker() {
  return `
  <div class="ai-checker">
    <div class="page-header">
      <div class="page-header-text"><h2>🤖 AI Answer Checker</h2><p>Get feedback on your answers</p></div>
    </div>

    <div class="ai-demo-banner">
      ⚠️ <strong>Demo Mode:</strong> This is a demonstration interface. Real AI checking requires an API integration. The feedback shown is illustrative only.
    </div>

    <div class="card">
      <div class="ai-form">
        <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label class="form-label">Class</label>
            <select id="ai-class">
              <option>Class 8</option>
              <option selected>Class 9</option>
              <option>Class 10</option>
            </select>
          </div>
          <div>
            <label class="form-label">Subject</label>
            <select id="ai-subject">
              <option>Mathematics</option>
              <option>Science</option>
              <option>Social Science</option>
              <option>English</option>
              <option>Hindi</option>
            </select>
          </div>
        </div>
        <div>
          <label class="form-label">Your Question</label>
          <textarea id="ai-question" placeholder="Enter the question you answered..." rows="3"></textarea>
        </div>
        <div>
          <label class="form-label">Your Answer</label>
          <textarea id="ai-answer" placeholder="Enter your answer here..." rows="4"></textarea>
        </div>
        <button class="btn btn-primary" onclick="runAICheck()">🤖 Check My Answer</button>
      </div>
    </div>

    <div id="ai-result-section"></div>

    <div class="card mt-2" style="background:rgba(88,166,255,0.05);border-color:rgba(88,166,255,0.2);">
      <div class="card-title">ℹ️ About AI Answer Checker</div>
      <div style="font-size:0.85rem;color:var(--text-secondary);line-height:1.7;">
        <p>This feature is designed to help you understand your mistakes. In a future update, it will connect to a real AI service to provide:</p>
        <ul style="list-style:disc;padding-left:20px;margin-top:8px;">
          <li>Detailed feedback on your answers</li>
          <li>Suggestions for improvement</li>
          <li>Links to relevant NCERT sections</li>
          <li>Similar practice questions</li>
        </ul>
        <p style="margin-top:8px;font-size:0.78rem;color:var(--text-muted);">No API keys are exposed in this demo. Real AI integration will follow best security practices.</p>
      </div>
    </div>
  </div>`;
}

function runAICheck() {
  const question = document.getElementById('ai-question')?.value.trim();
  const answer = document.getElementById('ai-answer')?.value.trim();
  if (!question || !answer) { showToast('Missing fields', 'Please enter both a question and your answer', 'error', '❌'); return; }

  const resultSection = document.getElementById('ai-result-section');
  if (!resultSection) return;
  resultSection.innerHTML = `<div class="card mt-2" style="text-align:center;padding:24px;">⏳ Analyzing your answer...</div>`;

  setTimeout(() => {
    const wordCount = answer.split(/\s+/).length;
    const score = Math.min(100, Math.max(40, 50 + wordCount * 2 + Math.floor(Math.random() * 20)));

    resultSection.innerHTML = `
    <div class="ai-result mt-2">
      <h3>📊 Feedback (Demo Mode)</h3>
      <span class="ai-score">${score}/100</span>
      <div class="ai-result-section">
        <div class="ai-result-label">Overall Assessment</div>
        <div class="ai-result-text">${score >= 80 ? 'Great answer! You have a good understanding of the concept.' : score >= 60 ? 'Good attempt. Your answer covers the basics but could be more detailed.' : 'Your answer has some gaps. Review the relevant NCERT section and try again.'}</div>
      </div>
      <div class="ai-result-section">
        <div class="ai-result-label">Suggestions</div>
        <div class="ai-result-text">• Include specific examples from the textbook where possible.<br>• Use key vocabulary terms relevant to the topic.<br>• Structure your answer with an introduction, explanation, and conclusion for long-answer questions.</div>
      </div>
      <div class="ai-result-section">
        <div class="ai-result-label">Recommended Resources</div>
        <div class="ai-result-text">Review the relevant chapter in your NCERT textbook. <a href="https://ncert.nic.in/textbook.php" target="_blank">Access NCERT textbooks ↗</a></div>
      </div>
      <div style="font-size:0.72rem;color:var(--text-muted);margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">⚠️ This is demo feedback only and not from a real AI service.</div>
    </div>`;
    addXP(5, 'Used AI Answer Checker');
  }, 1500);
}

/* ===== SETTINGS ===== */
function renderSettings() {
  const name = getStore('studentName', 'Student');
  const goal = getStore('dailyGoal', 60);
  return `
  <div class="page-header">
    <div class="page-header-text"><h2>⚙️ Settings</h2><p>Customize your EduSphere experience</p></div>
  </div>

  <div class="settings-sections">
    <div class="settings-section">
      <h3>👤 Profile</h3>
      <div class="setting-row">
        <div>
          <div class="setting-label">Your Name</div>
          <div class="setting-desc">Used for the welcome message</div>
        </div>
        <input type="text" id="setting-name" value="${name}" style="width:160px;" onchange="saveName(this.value)">
      </div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Default Class</div>
        </div>
        <select id="setting-class" style="width:140px;" onchange="saveDefaultClass(this.value)">
          <option value="class8" ${state.currentClass==='class8'?'selected':''}>Class 8</option>
          <option value="class9" ${state.currentClass==='class9'?'selected':''}>Class 9</option>
          <option value="class10" ${state.currentClass==='class10'?'selected':''}>Class 10</option>
        </select>
      </div>
    </div>

    <div class="settings-section">
      <h3>🎨 Appearance</h3>
      <div class="setting-row">
        <div>
          <div class="setting-label">Theme</div>
          <div class="setting-desc">Choose light or dark mode</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm ${state.theme==='dark'?'btn-primary':'btn-secondary'}" onclick="setTheme('dark')">🌙 Dark</button>
          <button class="btn btn-sm ${state.theme==='light'?'btn-primary':'btn-secondary'}" onclick="setTheme('light')">☀️ Light</button>
        </div>
      </div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Language</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm ${state.lang==='en'?'btn-primary':'btn-secondary'}" onclick="setLang('en')">English</button>
          <button class="btn btn-sm ${state.lang==='hi'?'btn-primary':'btn-secondary'}" onclick="setLang('hi')">हिंदी</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3>🎯 Study Goals</h3>
      <div class="setting-row">
        <div>
          <div class="setting-label">Daily Study Goal</div>
          <div class="setting-desc">Target minutes per day</div>
        </div>
        <input type="number" id="setting-goal" value="${goal}" min="15" max="480" style="width:80px;" onchange="setStore('dailyGoal',parseInt(this.value))">
      </div>
    </div>

    <div class="settings-section">
      <h3>📊 Data Management</h3>
      <div class="setting-row">
        <div>
          <div class="setting-label">Reset All Progress</div>
          <div class="setting-desc">⚠️ This will delete all your data</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="confirmReset()">Reset</button>
      </div>
      <div style="margin-top:12px;font-size:0.78rem;color:var(--text-muted);line-height:1.6;">
        📌 Data is saved in your browser's localStorage. It is not synced across devices or browsers. Clearing browser data will erase your progress.
      </div>
    </div>
  </div>`;
}

function saveName(v) { setStore('studentName', v.trim() || 'Student'); }
function saveDefaultClass(v) { state.currentClass = v; setStore('defaultClass', v); }
function setTheme(t) { state.theme = t; document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : ''); setStore('theme', t); navigate('settings'); }
function setLang(l) { state.lang = l; setStore('lang', l); navigate('settings'); }
function confirmReset() {
  if (confirm('Are you sure you want to reset ALL your EduSphere progress? This cannot be undone.')) {
    localStorage.removeItem(STORE_KEY);
    showToast('Reset Complete', 'All progress has been cleared', 'info', '🔄');
    setTimeout(() => location.reload(), 1000);
  }
}

/* ===== ABOUT ===== */
function renderAbout() {
  return `
  <div class="page-header">
    <div class="page-header-text"><h2>ℹ️ About EduSphere</h2></div>
  </div>
  <div class="card mb-2">
    <div style="text-align:center;padding:16px 0 24px;">
      <div style="width:72px;height:72px;background:linear-gradient(135deg,var(--accent),var(--accent-purple));border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:2rem;margin:0 auto 16px;">🎓</div>
      <h2 style="font-size:1.5rem;margin-bottom:8px;">EduSphere</h2>
      <div style="color:var(--text-muted);font-size:0.9rem;">Complete NCERT Learning Platform for CBSE Students</div>
    </div>
    <div style="font-size:0.9rem;color:var(--text-secondary);line-height:1.8;">
      <p>EduSphere is a student-focused educational platform designed to help CBSE students (Classes 8, 9 and 10) learn, practise, organize homework and monitor academic progress in one place.</p>
      <p style="margin-top:12px;">The platform aims to make studying easier, more organized and more engaging through features like NCERT chapter tracking, flashcards, quizzes, a Pomodoro timer, homework management, gamification, and progress analytics.</p>
    </div>
  </div>
  <div class="card mb-2">
    <div class="card-title">✨ Features</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:12px;">
      ${['📚 NCERT Syllabus (Class 8–10)','📝 Homework Tracker','⏱️ Pomodoro Timer','🃏 Flashcard System','🎯 Chapter-wise Quizzes','📊 Progress Dashboard','🏆 Gamification & Achievements','🤖 AI Answer Checker (Demo)','🌐 English & Hindi Interface','🌙 Dark & Light Themes'].map(f=>`<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;font-size:0.85rem;">${f}</div>`).join('')}
    </div>
  </div>
  <div class="card">
    <div class="card-title">📌 Important Notes</div>
    <div style="font-size:0.85rem;color:var(--text-secondary);line-height:1.8;margin-top:8px;">
      <p>• All data is stored locally in your browser using localStorage.</p>
      <p>• NCERT textbook PDFs are not hosted here. Use the official NCERT website: <a href="https://ncert.nic.in/textbook.php" target="_blank">ncert.nic.in</a></p>
      <p>• Syllabus content follows CBSE guidelines for the 2026–27 academic session.</p>
      <p>• This is Version 1.0. Cloud sync, real AI, and teacher dashboards are planned for future versions.</p>
    </div>
  </div>`;
}

/* ===== SEARCH ===== */
function renderSearchResults() {
  const q = state.searchQuery.toLowerCase();
  if (!q) return '<div class="empty-state"><div class="empty-icon">🔍</div><h3>Search for anything</h3><p>Chapters, subjects, notes, flashcards…</p></div>';

  const results = [];

  if (state.syllabus) {
    state.syllabus.classes.forEach(cl => {
      cl.subjects.forEach(sub => {
        if (sub.name.toLowerCase().includes(q)) results.push({ type: 'Subject', title: sub.name, meta: `${cl.label} · ${sub.book || ''}`, action: () => navigate('subject_detail', {classId: cl.id, subjectId: sub.id}) });
        const addChapters = (chapters) => chapters.forEach(ch => {
          if (ch.title.toLowerCase().includes(q) || ch.desc.toLowerCase().includes(q)) {
            results.push({ type: 'Chapter', title: ch.title, meta: `${cl.label} · ${sub.name}`, action: () => navigate('subject_detail', {classId: cl.id, subjectId: sub.id}) });
          }
        });
        if (sub.parts) sub.parts.forEach(p => addChapters(p.chapters));
        else if (sub.books) sub.books.forEach(bk => addChapters(bk.chapters || []));
      });
    });
  }

  if (state.quizzes) {
    state.quizzes.quizzes.forEach(qz => {
      if (qz.title.toLowerCase().includes(q) || qz.subject.toLowerCase().includes(q)) {
        results.push({ type: 'Quiz', title: qz.title, meta: `${qz.class.replace('class','Class ')} · ${qz.subject}`, action: () => navigate('quiz_play', qz.id) });
      }
    });
  }

  if (state.flashcardsData) {
    state.flashcardsData.decks.forEach(d => {
      if (d.title.toLowerCase().includes(q)) results.push({ type: 'Flashcard Deck', title: d.title, meta: `${d.cards.length} cards`, action: () => navigate('flashcards') });
    });
  }

  return `
  <div class="page-header">
    <div class="page-header-text"><h2>🔍 Search Results for "${state.searchQuery}"</h2><p>${results.length} result${results.length !== 1 ? 's' : ''} found</p></div>
  </div>
  <div class="search-results">
    ${results.length === 0
      ? '<div class="empty-state"><div class="empty-icon">🤷</div><h3>No results found</h3><p>Try a different search term</p></div>'
      : results.map((r, i) => `
        <div class="search-result-item" onclick="searchResults[${i}]?.action()">
          <div class="search-result-title"><span class="search-result-type">${r.type}</span>${r.title}</div>
          <div class="search-result-meta">${r.meta}</div>
        </div>`).join('')}
  </div>`;
}

let searchResults = [];

/* ===== Attach Page Handlers ===== */
function attachPageHandlers(page, extra) {
  if (page === 'subject_detail') state._subjectDetailExtra = extra;
}

/* ===== Helpers ===== */
function isOverdue(due) {
  if (!due) return false;
  return new Date(due) < new Date(new Date().toDateString());
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return d.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
}

/* ===== Sidebar XP update ===== */
function updateSidebarXP() {
  const xp = getStore('xp', 0);
  const lv = getCurrentLevel(xp);
  const nextLv = getNextLevel(xp);
  const xpProgress = nextLv ? Math.round(((xp - lv.xp) / (nextLv.xp - lv.xp)) * 100) : 100;
  const nameEl = document.querySelector('.level-info .level-name');
  const fillEl = document.querySelector('.sidebar-bottom .xp-fill');
  const textEl = document.querySelector('.sidebar-bottom .xp-text');
  if (nameEl) nameEl.textContent = `Lv. ${lv.level} · ${lv.name}`;
  if (fillEl) fillEl.style.width = xpProgress + '%';
  if (textEl) textEl.textContent = `${xp} XP`;
  const streakEl = document.querySelector('.streak-badge span:last-child');
  if (streakEl) streakEl.textContent = `${getStore('streak', 0)} day streak`;
}

/* ===== Initialize App ===== */
async function init() {
  // Load preferences
  state.theme = getStore('theme', 'dark');
  state.lang = getStore('lang', 'en');
  state.currentClass = getStore('defaultClass', 'class9');
  state.timerConfig = getStore('timerConfig', { study: 25, short: 5, long: 15 });

  if (state.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');

  // Load data files
  try {
    const [sRes, qRes, fRes] = await Promise.all([
      fetch('data/syllabus.json'),
      fetch('data/quizzes.json'),
      fetch('data/flashcards.json')
    ]);
    state.syllabus = await sRes.json();
    state.quizzes = await qRes.json();
    state.flashcardsData = await fRes.json();
  } catch (e) {
    console.warn('Could not load data files:', e);
  }

  // Build sidebar
  buildSidebar();

  // Wire up hamburger
  document.getElementById('hamburger-btn')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('hidden');
  });
  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.add('hidden');
  });

  // Wire up search
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.length >= 2) {
      state.searchQuery = val;
      searchResults = [];
      navigate('search');
      // rebuild results array for click handlers
      buildSearchResultsActions();
    }
  });

  // Theme & lang buttons in header
  document.getElementById('theme-toggle')?.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));

  // Update streak
  updateStreakData();
  updateSidebarXP();

  // Navigate to dashboard
  navigate('dashboard');
}

function buildSearchResultsActions() {
  if (!state.searchQuery || !state.syllabus) return;
  const q = state.searchQuery.toLowerCase();
  const results = [];
  state.syllabus.classes.forEach(cl => {
    cl.subjects.forEach(sub => {
      const addChs = (chs) => chs.forEach(ch => {
        if (ch.title.toLowerCase().includes(q) || ch.desc.toLowerCase().includes(q))
          results.push({ action: () => navigate('subject_detail', {classId: cl.id, subjectId: sub.id}) });
      });
      if (sub.name.toLowerCase().includes(q)) results.push({ action: () => navigate('subject_detail', {classId: cl.id, subjectId: sub.id}) });
      if (sub.parts) sub.parts.forEach(p => addChs(p.chapters));
      else if (sub.books) sub.books.forEach(bk => addChs(bk.chapters || []));
    });
  });
  state.quizzes?.quizzes.forEach(qz => {
    if (qz.title.toLowerCase().includes(q)) results.push({ action: () => navigate('quiz_play', qz.id) });
  });
  state.flashcardsData?.decks.forEach(d => {
    if (d.title.toLowerCase().includes(q)) results.push({ action: () => navigate('flashcards') });
  });
  searchResults = results;
}

function buildSidebar() {
  const xp = getStore('xp', 0);
  const lv = getCurrentLevel(xp);
  const nextLv = getNextLevel(xp);
  const xpProgress = nextLv ? Math.round(((xp - lv.xp) / (nextLv.xp - lv.xp)) * 100) : 100;
  const streak = getStore('streak', 0);
  const hw = getStore('homework', []);
  const pendingCount = hw.filter(h => !h.completed && isOverdue(h.due)).length;

  const navItems = [
    { page: 'dashboard', icon: '🏠', label: 'Dashboard' },
    { page: 'subjects', icon: '📚', label: 'Subjects' },
    { page: 'homework', icon: '📝', label: 'Homework', badge: pendingCount || '' },
    { page: 'timer', icon: '⏱️', label: 'Study Timer' },
    { page: 'flashcards', icon: '🃏', label: 'Flashcards' },
    { page: 'quizzes', icon: '🎯', label: 'Quizzes' },
    { page: 'progress', icon: '📊', label: 'Progress' },
    { page: 'gamification', icon: '🏆', label: 'Study Quest' },
    { page: 'ai_checker', icon: '🤖', label: 'AI Checker' },
  ];

  const bottomItems = [
    { page: 'settings', icon: '⚙️', label: 'Settings' },
    { page: 'about', icon: 'ℹ️', label: 'About' },
  ];

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = `
  <div class="sidebar-logo">
    <div class="logo-icon">🎓</div>
    <div class="logo-text"><h1>EduSphere</h1><span>CBSE Learning Platform</span></div>
  </div>
  <div class="sidebar-search">
    <div class="search-wrap">
      <span class="search-icon">🔍</span>
      <input id="search-input" type="text" placeholder="Search chapters, subjects...">
    </div>
  </div>
  <nav class="sidebar-nav">
    <div class="nav-section-label">Main Menu</div>
    ${navItems.map(item => `
      <div class="nav-item" data-page="${item.page}" onclick="navigate('${item.page}')">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
        ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ''}
      </div>`).join('')}
    <div class="nav-section-label" style="margin-top:8px;">Other</div>
    ${bottomItems.map(item => `
      <div class="nav-item" data-page="${item.page}" onclick="navigate('${item.page}')">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
      </div>`).join('')}
  </nav>
  <div class="sidebar-bottom">
    <div class="level-badge">
      <span style="font-size:1.3rem;">🎖️</span>
      <div class="level-info">
        <div class="level-name">Lv. ${lv.level} · ${lv.name}</div>
        <div class="xp-bar-wrap">
          <div class="xp-bar"><div class="xp-fill" style="width:${xpProgress}%"></div></div>
          <div class="xp-text">${xp} XP</div>
        </div>
      </div>
    </div>
  </div>`;

  // Re-wire search after rebuild
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.length >= 2) {
      state.searchQuery = val;
      navigate('search');
      buildSearchResultsActions();
    }
  });
}

// Header streak badge update
function updateHeaderStreak() {
  const badge = document.querySelector('.streak-badge');
  if (badge) badge.innerHTML = `🔥 <span>${getStore('streak', 0)} day streak</span>`;
}

document.addEventListener('DOMContentLoaded', init);
