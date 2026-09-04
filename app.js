/* =========================================================
   Syllabus Ledger — app logic
   Talks to Supabase for cross-device sync (see SUPABASE_URL /
   SUPABASE_ANON_KEY below), then renders two pages from one
   in-memory `state` object: the syllabus tracker (Home) and
   the focus timer + history (Focus).
   ========================================================= */

// ====== YOUR SUPABASE DETAILS ======
const SUPABASE_URL = 'https://chrzbrcwkrvbisdftymb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNocnpicmN3a3J2YmlzZGZ0eW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MTM1NzgsImV4cCI6MjEwNDA4OTU3OH0.cXg6sp-TZxQRv2awAgrMDN-aD_7YPjzQABcKpH_D1lg';
const ROW_ID = 'sam-syllabus-lucknow';
// ====================================

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DEFAULT_SUBJECTS = [
  'Commerce','Economics','Accounts','Computer Science',
  'English (Language and Literature)','Physical Education'
];

// state.subjects  -> syllabus data (Home page)
// state.focus     -> { settings, sessions } for the Focus page
// Both are persisted together as one JSON blob in Supabase (see scheduleSave below).
let state = null;
let openSubjectId = null;   // id of the currently expanded subject card, or null
let currentPage = 'home';   // 'home' | 'focus' — drives showPage()

function uid(){ return Math.random().toString(36).slice(2,10); }

function makeDefaultState(){
  return {
    subjects: DEFAULT_SUBJECTS.map(name => ({ id: uid(), name, chapters: [] })),
    focus: {
      settings: { dailyGoalMinutes: 240, pomodoroMinutes: 25, breakMinutes: 5 },
      sessions: []
    }
  };
}

/**
 * Loads the single saved row for this app from Supabase.
 * Falls back to a fresh default state on first run or on any error,
 * so the app is always usable even if the network/table isn't ready.
 */
async function loadState(){
  try{
    const { data, error } = await supabaseClient
      .from('syllabus_data')
      .select('payload')
      .eq('id', ROW_ID)
      .maybeSingle();
    if(error) throw error;
    if(data && data.payload && data.payload.subjects){
      state = data.payload;
      if(!state.focus){
        state.focus = { settings: { dailyGoalMinutes: 240, pomodoroMinutes: 25, breakMinutes: 5 }, sessions: [] };
      }
      return;
    }
  }catch(e){
    console.error('load failed', e);
  }
  state = makeDefaultState();
}

// Debounced save: every state change calls scheduleSave() instead of
// saving immediately, so rapid edits (e.g. bulk-adding chapters) only
// trigger one network write instead of one per change.
let saveTimer = null;
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try{
      const { error } = await supabaseClient
        .from('syllabus_data')
        .upsert({ id: ROW_ID, payload: state, updated_at: new Date().toISOString() });
      if(error) throw error;
      flashSaved('saved');
    }catch(e){
      console.error('save failed', e);
      flashSaved('save failed — check your Supabase keys');
    }
  }, 250);
}

function flashSaved(msg){
  const el = document.getElementById('saveNote');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1200);
}

/* ====================================================================
   Reusable confirmation dialog
   Used for every destructive action (delete chapter, delete session,
   reset all data) so nothing is ever removed without an explicit tap.
   ==================================================================== */
function openConfirmDialog(title, message, onConfirm){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  const overlay = document.getElementById('confirmOverlay');
  overlay.classList.add('open');
  const okBtn = document.getElementById('confirmOkBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  const cleanup = () => {
    overlay.classList.remove('open');
    okBtn.onclick = null; cancelBtn.onclick = null; overlay.onclick = null;
  };
  okBtn.onclick = () => { cleanup(); onConfirm(); };
  cancelBtn.onclick = cleanup;
  overlay.onclick = (e) => { if(e.target === overlay) cleanup(); };
}

/* ---------------- Milestones / totals ---------------- */
function weeksUntil(dateStr){
  const target = new Date(dateStr);
  const now = new Date();
  const diffMs = target - now;
  if(diffMs <= 0) return null;
  return Math.round(diffMs / (1000*60*60*24*7));
}

function renderMilestones(){
  const wrap = document.getElementById('milestones');
  const items = [
    { label: 'Preboards', date: '2026-11-01' },
    { label: 'Boards', date: '2027-02-01' }
  ];
  wrap.innerHTML = items.map(m => {
    const w = weeksUntil(m.date);
    const wt = w === null ? 'underway' : `${w} weeks`;
    return `<span class="chip">${m.label} <b>${wt}</b></span>`;
  }).join('');
}

function subjectStats(subject){
  const total = subject.chapters.length;
  const done = subject.chapters.filter(c => c.done).length;
  const pct = total === 0 ? 0 : Math.round((done/total)*100);
  return { total, done, pct };
}

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12.5L9.5 18L20 6" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TRASH_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderTotals(){
  let total = 0, done = 0;
  state.subjects.forEach(s => {
    total += s.chapters.length;
    done += s.chapters.filter(c => c.done).length;
  });
  const pct = total === 0 ? 0 : Math.round((done/total)*100);
  document.getElementById('totalPct').textContent = pct + '%';
  document.getElementById('totalSub').textContent = `${done} of ${total} topics done`;
  document.getElementById('overviewTrackFill').style.width = pct + '%';
  if(currentPage === 'home') document.getElementById('pctChip').textContent = pct + '%';
}

/* ---------------- Home page render ---------------- */
function renderSubjects(){
  const container = document.getElementById('subjects');
  container.innerHTML = '';

  state.subjects.forEach(subject => {
    const { total, done, pct } = subjectStats(subject);
    const isOpen = subject.id === openSubjectId;

    const card = document.createElement('div');
    card.className = 'subject-card' + (isOpen ? ' open' : '');
    card.dataset.id = subject.id;

    const head = document.createElement('div');
    head.className = 'subject-head';
    head.innerHTML = `
      <div class="subject-main">
        <p class="subject-name">${escapeHtml(subject.name)}</p>
        <div class="subject-track"><div class="subject-track-fill" style="width:${pct}%"></div></div>
      </div>
      <span class="subject-frac">${done}/${total}</span>
      <span class="expand-icon">${CHEVRON_SVG}</span>
    `;
    head.addEventListener('click', () => {
      openSubjectId = isOpen ? null : subject.id;
      renderSubjects();
    });
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'subject-body';

    if(subject.chapters.length === 0){
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'No chapters added yet — add them below, or paste your whole syllabus at once.';
      body.appendChild(note);
    }

    subject.chapters.forEach(ch => {
      const row = document.createElement('div');
      row.className = 'chapter-row';
      row.innerHTML = `
        <button class="m3-check ${ch.done ? 'done' : ''}" aria-label="toggle done">${CHECK_SVG}</button>
        <span class="chapter-name ${ch.done ? 'done' : ''}">${escapeHtml(ch.name)}</span>
        <button class="icon-btn" aria-label="delete">${TRASH_SVG}</button>
      `;
      row.querySelector('.m3-check').addEventListener('click', () => {
        ch.done = !ch.done;
        renderSubjects();
        renderTotals();
        scheduleSave();
      });
      row.querySelector('.icon-btn').addEventListener('click', () => {
        openConfirmDialog(
          'Delete chapter?',
          `"${ch.name}" will be removed from ${subject.name}. This can't be undone.`,
          () => {
            subject.chapters = subject.chapters.filter(c => c.id !== ch.id);
            renderSubjects();
            renderTotals();
            scheduleSave();
          }
        );
      });
      body.appendChild(row);
    });

    const fieldRow = document.createElement('div');
    fieldRow.className = 'field-row';
    fieldRow.innerHTML = `
      <input class="m3-field" type="text" placeholder="Add a chapter or topic" />
      <button class="btn-filled">Add</button>
    `;
    const input = fieldRow.querySelector('input');
    const addChapter = () => {
      const val = input.value.trim();
      if(!val) return;
      subject.chapters.push({ id: uid(), name: val, done: false });
      input.value = '';
      renderSubjects();
      renderTotals();
      scheduleSave();
    };
    fieldRow.querySelector('button').addEventListener('click', addChapter);
    input.addEventListener('keydown', e => { if(e.key === 'Enter') addChapter(); });
    body.appendChild(fieldRow);

    const bulkToggle = document.createElement('button');
    bulkToggle.className = 'btn-text';
    bulkToggle.textContent = 'paste multiple chapters at once';
    const bulkArea = document.createElement('div');
    bulkArea.className = 'bulk-area';
    bulkArea.innerHTML = `
      <textarea placeholder="Paste chapter names, one per line"></textarea>
      <button class="btn-filled">Add all</button>
    `;
    bulkToggle.addEventListener('click', () => bulkArea.classList.toggle('open'));
    bulkArea.querySelector('button').addEventListener('click', () => {
      const ta = bulkArea.querySelector('textarea');
      const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
      lines.forEach(name => subject.chapters.push({ id: uid(), name, done: false }));
      ta.value = '';
      bulkArea.classList.remove('open');
      renderSubjects();
      renderTotals();
      scheduleSave();
    });
    body.appendChild(bulkToggle);
    body.appendChild(bulkArea);

    card.appendChild(body);
    container.appendChild(card);
  });
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

document.getElementById('resetBtn').addEventListener('click', () => {
  openConfirmDialog(
    'Reset all data?',
    'This clears every subject, chapter, and focus session and starts fresh. This can\'t be undone.',
    () => {
      state = makeDefaultState();
      openSubjectId = null;
      renderSubjects();
      renderTotals();
      renderFocusPage();
      scheduleSave();
    }
  );
});

/* ====================================================================
   FOCUS PAGE — Pomodoro / Stopwatch timer

   timer.phase state machine:
     idle          -> nothing running, setup fields editable
     running       -> counting focus time (stopwatch: counts up,
                      pomodoro: counts down to pomodoroMinutes)
     paused        -> running was paused mid-focus
     break         -> pomodoro only: counting down the break
     breakPaused   -> break was paused

   Only 'running'/'paused' time counts as focus and gets saved as a
   session; break time never does. See tick() and stopSession().
   ==================================================================== */
let timer = {
  mode: 'pomodoro',       // 'pomodoro' | 'stopwatch'
  phase: 'idle',          // idle | running | paused | break | breakPaused
  elapsed: 0,
  label: '',
  subjectId: '',
  intervalId: null
};

function getFocusSettings(){ return state.focus.settings; }

function fmtClock(totalSeconds){
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s/60);
  const sec = s%60;
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

function fmtDuration(totalSeconds){
  const s = Math.round(totalSeconds);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  if(h > 0) return `${h}h ${m}m`;
  if(m > 0) return `${m}m`;
  return `${s}s`;
}

function populateSubjectSelect(){
  const sel = document.getElementById('focusSubjectSelect');
  const prev = sel.value;
  sel.innerHTML = '<option value="">No subject</option>' +
    state.subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if(prev) sel.value = prev;
}

function setMode(mode){
  if(timer.phase !== 'idle') return; // don't allow mode switch mid-session
  timer.mode = mode;
  document.getElementById('segPomodoro').classList.toggle('active', mode==='pomodoro');
  document.getElementById('segStopwatch').classList.toggle('active', mode==='stopwatch');
  updateTimerDisplay();
}

/** Records one completed (or manually stopped) focus interval to history. */
function saveSession(durationSeconds){
  if(durationSeconds < 5) return;
  const label = timer.label.trim() || 'Focus session';
  const subject = state.subjects.find(s => s.id === timer.subjectId);
  state.focus.sessions.unshift({
    id: uid(),
    label,
    subjectId: timer.subjectId || null,
    subjectName: subject ? subject.name : null,
    mode: timer.mode,
    durationSeconds: Math.round(durationSeconds),
    startedAt: new Date(Date.now() - durationSeconds*1000).toISOString(),
    endedAt: new Date().toISOString()
  });
  scheduleSave();
}

function startSession(){
  const input = document.getElementById('focusLabelInput');
  const sel = document.getElementById('focusSubjectSelect');
  timer.label = input.value;
  timer.subjectId = sel.value;
  timer.elapsed = 0;
  timer.phase = 'running';
  clearInterval(timer.intervalId);
  timer.intervalId = setInterval(tick, 1000);
  renderFocusPage();
}

function pauseSession(){
  clearInterval(timer.intervalId);
  timer.phase = timer.phase === 'break' ? 'breakPaused' : 'paused';
  renderFocusPage();
}

function resumeSession(){
  timer.phase = timer.phase === 'breakPaused' ? 'break' : 'running';
  timer.intervalId = setInterval(tick, 1000);
  renderFocusPage();
}

function stopSession(){
  clearInterval(timer.intervalId);
  const wasFocusPhase = timer.phase === 'running' || timer.phase === 'paused';
  if(wasFocusPhase && timer.elapsed >= 5){
    saveSession(timer.elapsed);
  }
  timer.phase = 'idle';
  timer.elapsed = 0;
  renderFocusPage();
  renderStats();
}

/** Runs once per second while a timer is active; advances the clock and
 *  handles automatic pomodoro -> break -> idle transitions. */
function tick(){
  timer.elapsed++;
  const settings = getFocusSettings();
  if(timer.mode === 'pomodoro'){
    if(timer.phase === 'running'){
      const target = settings.pomodoroMinutes * 60;
      if(timer.elapsed >= target){
        saveSession(target);
        timer.elapsed = 0;
        timer.phase = 'break';
        renderStats();
        renderFocusPage();
        return;
      }
    } else if(timer.phase === 'break'){
      const target = settings.breakMinutes * 60;
      if(timer.elapsed >= target){
        clearInterval(timer.intervalId);
        timer.phase = 'idle';
        timer.elapsed = 0;
        renderFocusPage();
        return;
      }
    }
  }
  updateTimerDisplay();
}

function updateTimerDisplay(){
  const settings = getFocusSettings();
  const clockEl = document.getElementById('timerClock');
  const phaseEl = document.getElementById('timerPhase');
  const subEl = document.getElementById('timerSub');

  if(timer.mode === 'stopwatch'){
    clockEl.textContent = fmtClock(timer.elapsed);
  } else {
    const target = timer.phase === 'break' || timer.phase === 'breakPaused'
      ? settings.breakMinutes*60 : settings.pomodoroMinutes*60;
    clockEl.textContent = fmtClock(Math.max(0, target - timer.elapsed));
  }

  const phaseLabels = {
    idle: 'Ready to focus',
    running: 'Focusing',
    paused: 'Paused',
    break: 'Break',
    breakPaused: 'Break paused'
  };
  phaseEl.textContent = phaseLabels[timer.phase];

  if(timer.phase !== 'idle' && timer.label){
    const subjName = state.subjects.find(s => s.id === timer.subjectId);
    subEl.textContent = subjName ? `${timer.label} · ${subjName.name}` : timer.label;
  } else {
    subEl.textContent = '';
  }
}

function renderTimerActions(){
  const actions = document.getElementById('timerActions');
  actions.innerHTML = '';
  if(timer.phase === 'idle'){
    const b = document.createElement('button');
    b.className = 'btn-filled wide';
    b.textContent = 'Start';
    b.style.width = '100%';
    b.addEventListener('click', startSession);
    actions.appendChild(b);
  } else if(timer.phase === 'running' || timer.phase === 'break'){
    const pause = document.createElement('button');
    pause.className = 'btn-tonal';
    pause.textContent = 'Pause';
    pause.addEventListener('click', pauseSession);
    const stop = document.createElement('button');
    stop.className = 'btn-filled error';
    stop.textContent = 'Stop';
    stop.addEventListener('click', stopSession);
    actions.appendChild(pause);
    actions.appendChild(stop);
  } else if(timer.phase === 'paused' || timer.phase === 'breakPaused'){
    const resume = document.createElement('button');
    resume.className = 'btn-filled';
    resume.textContent = 'Resume';
    resume.addEventListener('click', resumeSession);
    const stop = document.createElement('button');
    stop.className = 'btn-filled error';
    stop.textContent = 'Stop';
    stop.addEventListener('click', stopSession);
    actions.appendChild(resume);
    actions.appendChild(stop);
  }
}

function renderStats(){
  const settings = getFocusSettings();
  const todayStr = new Date().toDateString();
  const todaySeconds = state.focus.sessions
    .filter(s => new Date(s.startedAt).toDateString() === todayStr)
    .reduce((sum, s) => sum + s.durationSeconds, 0);
  const goalSeconds = settings.dailyGoalMinutes * 60;
  const pct = goalSeconds === 0 ? 0 : Math.min(100, Math.round((todaySeconds/goalSeconds)*100));

  const goalH = Math.floor(settings.dailyGoalMinutes/60);
  const goalM = settings.dailyGoalMinutes % 60;
  const goalStr = goalM > 0 ? `${goalH}h ${goalM}m` : `${goalH}h`;

  document.getElementById('statsSummary').textContent = `${fmtDuration(todaySeconds)} of ${goalStr}`;
  document.getElementById('statsTrackFill').style.width = pct + '%';

  if(currentPage === 'focus'){
    document.getElementById('pctChip').textContent = pct + '%';
  }
}

function renderFocusPage(){
  populateSubjectSelect();
  document.getElementById('segPomodoro').classList.toggle('active', timer.mode==='pomodoro');
  document.getElementById('segStopwatch').classList.toggle('active', timer.mode==='stopwatch');
  document.getElementById('segPomodoro').disabled = timer.phase !== 'idle';
  document.getElementById('segStopwatch').disabled = timer.phase !== 'idle';

  const setupEl = document.getElementById('timerSetup');
  setupEl.classList.toggle('hidden', timer.phase !== 'idle');

  updateTimerDisplay();
  renderTimerActions();
  renderStats();
}

document.getElementById('segPomodoro').addEventListener('click', () => setMode('pomodoro'));
document.getElementById('segStopwatch').addEventListener('click', () => setMode('stopwatch'));

/* ---- Focus settings dialog (daily goal / pomodoro / break lengths) ---- */
document.getElementById('focusSettingsBtn').addEventListener('click', () => {
  const s = getFocusSettings();
  document.getElementById('goalHoursInput').value = (s.dailyGoalMinutes/60).toString();
  document.getElementById('pomoMinInput').value = s.pomodoroMinutes;
  document.getElementById('breakMinInput').value = s.breakMinutes;
  document.getElementById('settingsOverlay').classList.add('open');
});
document.getElementById('settingsCancelBtn').addEventListener('click', () => {
  document.getElementById('settingsOverlay').classList.remove('open');
});
document.getElementById('settingsOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'settingsOverlay') document.getElementById('settingsOverlay').classList.remove('open');
});
document.getElementById('settingsSaveBtn').addEventListener('click', () => {
  const goalHours = parseFloat(document.getElementById('goalHoursInput').value) || 4;
  const pomoMin = parseInt(document.getElementById('pomoMinInput').value) || 25;
  const breakMin = parseInt(document.getElementById('breakMinInput').value) || 5;
  state.focus.settings = {
    dailyGoalMinutes: Math.round(goalHours*60),
    pomodoroMinutes: pomoMin,
    breakMinutes: breakMin
  };
  document.getElementById('settingsOverlay').classList.remove('open');
  updateTimerDisplay();
  renderStats();
  scheduleSave();
});

/* ---- History sheet: lists every saved session, grouped by day ---- */
function renderHistory(){
  const body = document.getElementById('historyBody');
  const sessions = [...state.focus.sessions].sort((a,b) => new Date(b.startedAt) - new Date(a.startedAt));

  if(sessions.length === 0){
    body.innerHTML = '<div class="empty-note">No sessions logged yet. Start a timer on the Focus page to build your history.</div>';
    return;
  }

  let html = '';
  let lastDayLabel = null;
  const todayStr = new Date().toDateString();
  const yestStr = new Date(Date.now()-86400000).toDateString();

  sessions.forEach(s => {
    const d = new Date(s.startedAt);
    const dayStr = d.toDateString();
    let dayLabel = d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
    if(dayStr === todayStr) dayLabel = 'Today';
    else if(dayStr === yestStr) dayLabel = 'Yesterday';

    if(dayLabel !== lastDayLabel){
      html += `<div class="day-heading">${dayLabel}</div>`;
      lastDayLabel = dayLabel;
    }

    const timeStr = d.toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
    const modeTag = s.mode === 'pomodoro' ? 'Pomodoro' : 'Stopwatch';
    const meta = s.subjectName ? `${s.subjectName} · ${modeTag} · ${timeStr}` : `${modeTag} · ${timeStr}`;

    html += `
      <div class="session-row" data-id="${s.id}">
        <div class="session-main">
          <p class="session-label">${escapeHtml(s.label)}</p>
          <div class="session-meta">${escapeHtml(meta)}</div>
        </div>
        <span class="session-dur">${fmtDuration(s.durationSeconds)}</span>
        <button class="icon-btn" aria-label="delete session" data-del="${s.id}">${TRASH_SVG}</button>
      </div>
    `;
  });

  body.innerHTML = html;

  body.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del');
      const session = state.focus.sessions.find(s => s.id === id);
      openConfirmDialog(
        'Delete session?',
        `This will remove "${session ? session.label : 'this session'}" from your history. This can't be undone.`,
        () => {
          state.focus.sessions = state.focus.sessions.filter(s => s.id !== id);
          renderHistory();
          renderStats();
          scheduleSave();
        }
      );
    });
  });
}

document.getElementById('historyBtn').addEventListener('click', () => {
  renderHistory();
  document.getElementById('historyOverlay').classList.add('open');
});
document.getElementById('historyCloseBtn').addEventListener('click', () => {
  document.getElementById('historyOverlay').classList.remove('open');
});
document.getElementById('historyOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'historyOverlay') document.getElementById('historyOverlay').classList.remove('open');
});

/* ====================================================================
   PAGE NAVIGATION — swaps Home/Focus content and updates the app bar
   and bottom nav to match. No routing library; just two toggled divs.
   ==================================================================== */
function showPage(page){
  currentPage = page;
  document.getElementById('page-home').classList.toggle('hidden', page !== 'home');
  document.getElementById('page-focus').classList.toggle('hidden', page !== 'focus');
  document.getElementById('navHome').classList.toggle('active', page === 'home');
  document.getElementById('navFocus').classList.toggle('active', page === 'focus');

  if(page === 'home'){
    document.getElementById('appbarEyebrow').textContent = 'Class 12 · Commerce';
    document.getElementById('appbarTitle').textContent = 'Syllabus Ledger';
    renderTotals();
  } else {
    document.getElementById('appbarEyebrow').textContent = 'Deep work';
    document.getElementById('appbarTitle').textContent = 'Focus';
    renderStats();
  }
}
document.getElementById('navHome').addEventListener('click', () => showPage('home'));
document.getElementById('navFocus').addEventListener('click', () => showPage('focus'));

// Registers the PWA service worker so the app can be installed and its
// shell (not your data — that always comes from Supabase) loads offline.
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(e => console.error('SW failed', e));
  });
}

// Entry point: load saved data, then render everything once.
(async function init(){
  await loadState();
  renderSubjects();
  renderTotals();
  renderMilestones();
  renderFocusPage();
  showPage('home');
})();
