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
//
// `pendingSave` is also how the cross-device polling below avoids a race:
// it refuses to overwrite local state with a server fetch while a save
// is in flight, so we never clobber an edit that hasn't reached the
// server yet.
let saveTimer = null;
let pendingSave = false;
function scheduleSave(){
  pendingSave = true;
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
    }finally{
      pendingSave = false;
    }
  }, 250);
}

function flashSaved(msg){
  const el = document.getElementById('saveToast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1200);
}

/* ====================================================================
   CROSS-DEVICE SYNC (polling)
   Supabase holds the single source of truth. Besides saving on every
   local change, we periodically re-fetch it here so that changes made
   on *another* device (or another tab) show up here too — on tab
   focus/visibility (for an instant refresh when you switch back) and
   every 20s while the tab is open (to catch changes without needing to
   switch away and back). We skip the refetch whenever a local save is
   still pending, so we never overwrite an edit before it's saved.

   Note: this is "last write wins" — if two devices edit at the exact
   same moment, whichever save lands last on the server wins. Fine for
   one person using their own devices; not a real-time collaboration
   system.
   ==================================================================== */
async function refetchAndMerge(){
  if(pendingSave) return;
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
      renderSubjects();
      renderTotals();
      renderFocusPage();
    }
  }catch(e){
    console.error('background refresh failed', e);
  }
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

/* ---- "More options" menu — keeps rarely-needed/destructive actions
   (currently just Reset) out of the everyday UI, one tap away instead
   of always on screen. ---- */
document.getElementById('moreMenuBtn').addEventListener('click', () => {
  document.getElementById('moreOverlay').classList.add('open');
});
document.getElementById('moreCancelBtn').addEventListener('click', () => {
  document.getElementById('moreOverlay').classList.remove('open');
});
document.getElementById('moreOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'moreOverlay') document.getElementById('moreOverlay').classList.remove('open');
});

document.getElementById('resetBtn').addEventListener('click', () => {
  document.getElementById('moreOverlay').classList.remove('open');
  openConfirmDialog(
    'Reset all data?',
    'This clears every subject, chapter, and focus session and starts fresh. This can\'t be undone.',
    () => {
      state = makeDefaultState();
      openSubjectId = null;
      chartOffset = 0;
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

   IMPORTANT — why timestamps, not a tick counter:
   Browsers heavily throttle (or fully suspend) setInterval in
   background/inactive tabs to save battery. If we counted "+1 second"
   per tick, 30 real minutes in a hidden tab could show as only 1-2
   minutes, because most ticks simply never fired. Instead we record
   the real Date.now() when a phase starts (phaseStartEpoch) plus how
   much time it already had banked before that (accumulatedMs), and
   compute elapsed as an actual clock difference. That's correct no
   matter how badly the interval was throttled while hidden — the
   moment the tab wakes up (or the next tick fires), the true elapsed
   time is recalculated from real timestamps, not from counted ticks.
   ==================================================================== */
let timer = {
  mode: 'pomodoro',        // 'pomodoro' | 'stopwatch'
  phase: 'idle',           // idle | running | paused | break | breakPaused
  accumulatedMs: 0,        // time banked from before the current run (e.g. before a pause)
  phaseStartEpoch: null,   // Date.now() when the current run started, or null if not running
  label: '',
  subjectId: '',
  intervalId: null
};

function getFocusSettings(){ return state.focus.settings; }

/** Real elapsed seconds in the current phase, computed from timestamps
 *  (not tick counts) so it's correct even after the tab was backgrounded. */
function getPhaseElapsedSeconds(){
  let ms = timer.accumulatedMs;
  if(timer.phaseStartEpoch !== null){
    ms += Date.now() - timer.phaseStartEpoch;
  }
  return ms / 1000;
}

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
  timer.accumulatedMs = 0;
  timer.phaseStartEpoch = Date.now();
  timer.phase = 'running';
  clearInterval(timer.intervalId);
  timer.intervalId = setInterval(tick, 1000);
  renderFocusPage();
}

function pauseSession(){
  // Freeze the elapsed time into accumulatedMs and stop the running clock,
  // so resuming later continues from exactly where it left off.
  timer.accumulatedMs = getPhaseElapsedSeconds() * 1000;
  timer.phaseStartEpoch = null;
  clearInterval(timer.intervalId);
  timer.phase = timer.phase === 'break' ? 'breakPaused' : 'paused';
  renderFocusPage();
}

function resumeSession(){
  timer.phaseStartEpoch = Date.now();
  timer.phase = timer.phase === 'breakPaused' ? 'break' : 'running';
  timer.intervalId = setInterval(tick, 1000);
  renderFocusPage();
}

function stopSession(){
  clearInterval(timer.intervalId);
  const wasFocusPhase = timer.phase === 'running' || timer.phase === 'paused';
  const elapsed = getPhaseElapsedSeconds();
  if(wasFocusPhase && elapsed >= 5){
    saveSession(elapsed);
  }
  timer.phase = 'idle';
  timer.accumulatedMs = 0;
  timer.phaseStartEpoch = null;
  renderFocusPage();
  renderStats();
  renderChart();
}

/** Runs once per second while a timer is active (though it may fire far
 *  less often in a backgrounded tab — see the note above). Recomputes
 *  the real elapsed time from timestamps and handles automatic
 *  pomodoro -> break -> idle transitions. Also called directly when the
 *  tab regains visibility, so the display snaps to the correct time and
 *  any missed transition happens immediately rather than waiting for
 *  the next throttled tick. */
function tick(){
  const settings = getFocusSettings();
  const elapsed = getPhaseElapsedSeconds();

  if(timer.mode === 'pomodoro'){
    if(timer.phase === 'running'){
      const target = settings.pomodoroMinutes * 60;
      if(elapsed >= target){
        saveSession(target);
        timer.accumulatedMs = 0;
        timer.phaseStartEpoch = Date.now();
        timer.phase = 'break';
        renderStats();
        renderChart();
        renderFocusPage();
        return;
      }
    } else if(timer.phase === 'break'){
      const target = settings.breakMinutes * 60;
      if(elapsed >= target){
        clearInterval(timer.intervalId);
        timer.phase = 'idle';
        timer.accumulatedMs = 0;
        timer.phaseStartEpoch = null;
        renderFocusPage();
        return;
      }
    }
  }
  updateTimerDisplay();
}

const BASE_TITLE = 'Syllabus Ledger';

function updateTimerDisplay(){
  const settings = getFocusSettings();
  const clockEl = document.getElementById('timerClock');
  const phaseEl = document.getElementById('timerPhase');
  const subEl = document.getElementById('timerSub');
  const elapsed = getPhaseElapsedSeconds();

  let clockText;
  if(timer.mode === 'stopwatch'){
    clockText = fmtClock(elapsed);
  } else {
    const target = timer.phase === 'break' || timer.phase === 'breakPaused'
      ? settings.breakMinutes*60 : settings.pomodoroMinutes*60;
    clockText = fmtClock(Math.max(0, target - elapsed));
  }
  clockEl.textContent = clockText;

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

  updateTabIndicator(timer.phase === 'idle' ? null : clockText, phaseLabels[timer.phase]);
  updateLiveDot();
}

/** Shows the running timer in the browser tab itself (title + favicon
 *  badge), so you can tell a session is still going without switching
 *  back to this tab — handy when you've tabbed away to a lecture video. */
function updateTabIndicator(clockText, phaseLabel){
  const favicon = document.getElementById('faviconLink');
  if(clockText){
    document.title = `${clockText} · ${phaseLabel} — ${BASE_TITLE}`;
    favicon.href = 'favicon-active.png';
  } else {
    document.title = BASE_TITLE;
    favicon.href = 'favicon.png';
  }
}

/** Small dot on the bottom-nav Focus icon so a running session is
 *  visible even while browsing the Home page. */
function updateLiveDot(){
  document.getElementById('focusLiveDot').classList.toggle('hidden', timer.phase === 'idle');
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

/* ====================================================================
   FOCUS CHART — Week / Month / Year bar chart of logged focus time.
   chartView picks the granularity; chartOffset moves backward/forward
   through periods (0 = the current week/month/year, -1 = previous, ...).
   The chart is drawn as a plain inline SVG built by hand (no charting
   library) so the app stays a handful of static files with no build
   step.
   ==================================================================== */
let chartView = 'week';   // 'week' | 'month' | 'year'
let chartOffset = 0;      // 0 = current period, -1 = previous, +1 = next (capped)

function startOfWeek(d){
  // Treats Monday as the first day of the week.
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon=0 ... Sun=6
  date.setHours(0,0,0,0);
  date.setDate(date.getDate() - day);
  return date;
}

/** Sums focus seconds per bucket for the current chartView/chartOffset,
 *  returning bars ready to draw plus a human-readable range label. */
function computeChartData(){
  const sessions = state.focus.sessions;
  const now = new Date();
  const bars = [];
  let rangeLabel = '';

  if(chartView === 'week'){
    const start = startOfWeek(now);
    start.setDate(start.getDate() + chartOffset*7);
    const end = new Date(start); end.setDate(end.getDate()+6);
    const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    for(let i=0;i<7;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      const seconds = sumSecondsOnDate(sessions, d);
      bars.push({ label: dayNames[i], seconds, isToday: d.toDateString() === now.toDateString() });
    }
    rangeLabel = chartOffset === 0 ? 'This week' :
      `${start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${end.toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;

  } else if(chartView === 'month'){
    const base = new Date(now.getFullYear(), now.getMonth() + chartOffset, 1);
    const daysInMonth = new Date(base.getFullYear(), base.getMonth()+1, 0).getDate();
    for(let day=1; day<=daysInMonth; day++){
      const d = new Date(base.getFullYear(), base.getMonth(), day);
      const seconds = sumSecondsOnDate(sessions, d);
      // Label every 5th day (plus day 1) to keep the axis readable.
      const label = (day === 1 || day % 5 === 0) ? String(day) : '';
      bars.push({ label, seconds, isToday: d.toDateString() === now.toDateString() });
    }
    rangeLabel = chartOffset === 0 ? 'This month' :
      base.toLocaleDateString(undefined, { month:'long', year:'numeric' });

  } else { // year
    const year = now.getFullYear() + chartOffset;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for(let m=0; m<12; m++){
      const seconds = sessions
        .filter(s => {
          const d = new Date(s.startedAt);
          return d.getFullYear() === year && d.getMonth() === m;
        })
        .reduce((sum,s) => sum + s.durationSeconds, 0);
      bars.push({ label: monthNames[m], seconds, isToday: m === now.getMonth() && year === now.getFullYear() });
    }
    rangeLabel = String(year);
  }

  const totalSeconds = bars.reduce((sum,b) => sum + b.seconds, 0);
  return { bars, rangeLabel, totalSeconds };
}

function sumSecondsOnDate(sessions, date){
  const dayStr = date.toDateString();
  return sessions
    .filter(s => new Date(s.startedAt).toDateString() === dayStr)
    .reduce((sum,s) => sum + s.durationSeconds, 0);
}

/** Builds the bar-chart SVG by hand and injects it into the page. */
function renderChartSvg(bars){
  const wrap = document.getElementById('chartSvgWrap');
  const w = 320, h = 130;
  const padTop = 8, padBottom = 18, padSide = 4;
  const chartH = h - padTop - padBottom;
  const barGap = 3;
  const barW = (w - padSide*2) / bars.length - barGap;

  const maxSeconds = Math.max(...bars.map(b => b.seconds), 1);
  const goalSeconds = getFocusSettings().dailyGoalMinutes * 60;
  // Scale to whichever is taller: the tallest bar, or the goal line
  // (only meaningful for the week/month views where bars are per-day).
  const scaleMax = Math.max(maxSeconds, chartView !== 'year' ? goalSeconds : 0) * 1.1 || 1;

  let barsSvg = '';
  bars.forEach((b, i) => {
    const x = padSide + i * (barW + barGap);
    const barH = Math.max(b.seconds > 0 ? 2 : 0, (b.seconds / scaleMax) * chartH);
    const y = padTop + (chartH - barH);
    const cls = b.isToday ? 'chart-bar today' : 'chart-bar';
    barsSvg += `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2"/>`;
    if(b.label){
      barsSvg += `<text class="chart-axis-label" x="${(x+barW/2).toFixed(1)}" y="${h-4}" text-anchor="middle">${b.label}</text>`;
    }
  });

  let goalLineSvg = '';
  if(chartView !== 'year' && goalSeconds > 0 && goalSeconds < scaleMax){
    const y = padTop + (chartH - (goalSeconds/scaleMax)*chartH);
    goalLineSvg = `<line class="chart-goal-line" x1="${padSide}" y1="${y.toFixed(1)}" x2="${w-padSide}" y2="${y.toFixed(1)}"/>`;
  }

  wrap.innerHTML = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${goalLineSvg}${barsSvg}</svg>`;
}

function renderChart(){
  document.querySelectorAll('#page-focus .segmented.small .segment-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === chartView);
  });

  const { bars, rangeLabel, totalSeconds } = computeChartData();
  document.getElementById('chartRangeLabel').textContent = rangeLabel;
  document.getElementById('chartTotal').textContent = `${fmtDuration(totalSeconds)} total`;
  renderChartSvg(bars);

  // Don't let "next" go past the current period.
  document.getElementById('chartNextBtn').disabled = chartOffset >= 0;
}

document.querySelectorAll('#page-focus .segmented.small .segment-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    chartView = btn.dataset.range;
    chartOffset = 0;
    renderChart();
  });
});
document.getElementById('chartPrevBtn').addEventListener('click', () => {
  chartOffset -= 1;
  renderChart();
});
document.getElementById('chartNextBtn').addEventListener('click', () => {
  if(chartOffset < 0){ chartOffset += 1; renderChart(); }
});

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
  renderChart();
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
  renderChart();
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
          renderChart();
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

/* ---- Tab visibility: snap the timer to the correct time immediately
   when you switch back (instead of waiting for the next tick, which
   may have been throttled), and opportunistically pull in any changes
   made on another device while this tab was away. ---- */
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible'){
    if(timer.phase !== 'idle') tick();
    refetchAndMerge();
  }
});
window.addEventListener('focus', () => {
  if(timer.phase !== 'idle') tick();
  refetchAndMerge();
});
// Belt-and-braces polling so changes from another device show up here
// even if you never switch tabs away and back.
setInterval(refetchAndMerge, 20000);

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
