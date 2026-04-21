document.addEventListener("DOMContentLoaded", () => {
// ===== PERSISTENCE LAYER =====
function save(key, data) { 
    localStorage.setItem('df_' + key, JSON.stringify(data)); 
    if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
        db.ref('users/' + firebase.auth().currentUser.uid + '/data/' + key).set(data);
    }
}
function load(key, fallback) { try { const d = localStorage.getItem('df_' + key); return d ? JSON.parse(d) : fallback; } catch(e) { return fallback; } }

// ===== STATE (loaded from localStorage) =====
let habits = load('habits', []);
let tasks = load('tasks', []);
let calendarEvents = load('events', []);
let habitNotes = load('habitNotes', {});
let friends = load('friends', []);

// User ID generation
let myUserId = localStorage.getItem('df_userId');
if (!myUserId) {
    myUserId = 'DF-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    localStorage.setItem('df_userId', myUserId);
}

// Daily Reset Logic
const todayStr = new Date().toISOString().split('T')[0];
const lastLogin = localStorage.getItem('df_lastLoginDate');
if (lastLogin !== todayStr) {
    // Reset habits for the new day
    habits.forEach(h => { h.completed = false; });
    save('habits', habits);
    localStorage.setItem('df_lastLoginDate', todayStr);
}

function saveAll() { save('habits', habits); save('tasks', tasks); save('events', calendarEvents); save('habitNotes', habitNotes); save('friends', friends); }

// ===== XP / LEVELING SYSTEM =====
let totalXP = load('totalXP', 0);

// Tier table: every 5 levels, the XP requirement per level increases
const XP_TIERS = [
    { maxLvl: 5,   xpPerLvl: 100 },
    { maxLvl: 10,  xpPerLvl: 150 },
    { maxLvl: 15,  xpPerLvl: 200 },
    { maxLvl: 20,  xpPerLvl: 300 },
    { maxLvl: 25,  xpPerLvl: 400 },
    { maxLvl: 30,  xpPerLvl: 500 },
    { maxLvl: 35,  xpPerLvl: 650 },
    { maxLvl: 40,  xpPerLvl: 800 },
    { maxLvl: 45,  xpPerLvl: 1000 },
    { maxLvl: 50,  xpPerLvl: 1250 },
    { maxLvl: 55,  xpPerLvl: 1500 },
    { maxLvl: 60,  xpPerLvl: 1800 },
    { maxLvl: 65,  xpPerLvl: 2200 },
    { maxLvl: 70,  xpPerLvl: 2600 },
    { maxLvl: 75,  xpPerLvl: 3000 },
    { maxLvl: 80,  xpPerLvl: 3500 },
    { maxLvl: 85,  xpPerLvl: 4000 },
    { maxLvl: 90,  xpPerLvl: 4500 },
    { maxLvl: 95,  xpPerLvl: 5200 },
    { maxLvl: 100, xpPerLvl: 6000 }
];

function getLevelInfo(xp) {
    let remaining = xp;
    let level = 1;
    for (const tier of XP_TIERS) {
        while (level < tier.maxLvl) {
            if (remaining < tier.xpPerLvl) {
                return { level, xpInLevel: remaining, xpNeeded: tier.xpPerLvl };
            }
            remaining -= tier.xpPerLvl;
            level++;
        }
    }
    return { level: 100, xpInLevel: 0, xpNeeded: 0 }; // Max level
}

function syncProfile() {
    if (typeof db !== 'undefined' && myUserId) {
        db.ref('users/' + myUserId).set({
            id: myUserId,
            name: localStorage.getItem('deepflow_username') || 'Anonyme',
            xp: totalXP,
            lastSeen: Date.now()
        });
    }
}

function addXP(amount) {
    const oldInfo = getLevelInfo(totalXP);
    totalXP += amount;
    save('totalXP', totalXP);
    const newInfo = getLevelInfo(totalXP);
    
    renderXP();
    syncProfile();

    if (newInfo.level > oldInfo.level) {
        showLevelUpAnimation(oldInfo.level, newInfo.level);
    }
}

function showLevelUpAnimation(oldLvl, newLvl) {
    const overlay = document.getElementById('levelUpOverlay');
    document.getElementById('levelOld').textContent = oldLvl;
    document.getElementById('levelNew').textContent = newLvl;
    
    overlay.style.display = 'flex';
    overlay.style.animation = 'none'; // reset any fade out

    // Play animation for 3.5 seconds, then fade out
    setTimeout(() => {
        overlay.style.animation = 'levelFadeOut 0.8s ease forwards';
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.style.animation = ''; // reset
        }, 800);
    }, 3500);
}

function renderXP() {
    const info = getLevelInfo(totalXP);
    document.getElementById('xpLevelBadge').textContent = `Niv. ${info.level}`;
    const pct = info.xpNeeded > 0 ? Math.min((info.xpInLevel / info.xpNeeded) * 100, 100) : 100;
    document.getElementById('xpBarFill').style.width = pct + '%';
    document.getElementById('xpText').textContent = info.level >= 100 ? 'MAX' : `${info.xpInLevel} / ${info.xpNeeded}`;
    const name = localStorage.getItem('deepflow_username');
    document.getElementById('xpUsername').textContent = name || '—';

    // Update Gamification Page
    const lvlPageCurrentLvl = document.getElementById('lvlPageCurrentLvl');
    if(lvlPageCurrentLvl) {
        lvlPageCurrentLvl.textContent = `Niv. ${info.level}`;
        document.getElementById('lvlPageXpText').textContent = info.level >= 100 ? 'Niveau Maximum Atteint' : `${info.xpInLevel} / ${info.xpNeeded} XP`;
        document.getElementById('lvlPageBarFill').style.width = pct + '%';
    }
}

// ===== AUTHENTICATION & CLOUD SAVE =====
const welcomeOverlay = document.getElementById('welcomeOverlay');
const authLoading = document.getElementById('authLoading');
const authScreen = document.getElementById('authScreen');
const appContainer = document.querySelector('.app-container');
const authEmailInput = document.getElementById('authEmailInput');
const authPassInput = document.getElementById('authPassInput');
const authNameInput = document.getElementById('authNameInput');
const authErrorMsg = document.getElementById('authErrorMsg');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authToggleLink = document.getElementById('authToggleLink');
const authSubtitle = document.getElementById('authSubtitle');
const authToggleText = document.getElementById('authToggleText');
let storedName = localStorage.getItem('deepflow_username') || '';

let isRegistering = false;

authToggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isRegistering = !isRegistering;
    authNameInput.style.display = isRegistering ? 'block' : 'none';
    authSubmitBtn.textContent = isRegistering ? "S'inscrire" : 'Se connecter';
    authSubtitle.textContent = isRegistering ? "Créez votre compte pour sauvegarder vos données." : "Connectez-vous pour synchroniser vos données.";
    authToggleText.textContent = isRegistering ? "Déjà un compte ?" : "Pas encore de compte ?";
    authToggleLink.textContent = isRegistering ? "Se connecter" : "S'inscrire";
    authErrorMsg.textContent = '';
});

authSubmitBtn.addEventListener('click', async () => {
    const email = authEmailInput.value.trim();
    const pass = authPassInput.value.trim();
    const name = authNameInput.value.trim();
    
    if (!email || !pass) { authErrorMsg.textContent = "Veuillez remplir tous les champs."; return; }
    if (isRegistering && !name) { authErrorMsg.textContent = "Le pseudo est obligatoire pour l'inscription."; return; }
    
    authErrorMsg.textContent = "Patientez...";
    try {
        if (isRegistering) {
            const cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
            await cred.user.updateProfile({ displayName: name });
            localStorage.setItem('deepflow_username', name);
            storedName = name;
        } else {
            await firebase.auth().signInWithEmailAndPassword(email, pass);
        }
    } catch (error) {
        authErrorMsg.textContent = error.message;
    }
});

document.getElementById('btnLogout').addEventListener('click', () => {
    firebase.auth().signOut().then(() => { location.reload(); });
});

// Auth State Observer
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        // Logged in
        authLoading.style.display = 'block';
        authScreen.style.display = 'none';
        
        if (user.displayName && !storedName) {
            storedName = user.displayName;
            localStorage.setItem('deepflow_username', storedName);
        }
        
        // Fetch Cloud Data
        db.ref('users/' + user.uid + '/data').once('value', snapshot => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                if(data.habits) habits = data.habits;
                if(data.tasks) tasks = data.tasks;
                if(data.events) calendarEvents = data.events;
                if(data.habitNotes) habitNotes = data.habitNotes;
                if(data.friends) friends = data.friends;
                if(data.totalXP !== undefined) totalXP = data.totalXP;
                if(data.userId) myUserId = data.userId;
                
                // Save loaded cloud data to local storage
                localStorage.setItem('df_userId', myUserId);
                save('habits', habits); save('tasks', tasks); save('events', calendarEvents); 
                save('habitNotes', habitNotes); save('friends', friends); save('totalXP', totalXP);
            } else {
                // First login, push local data to cloud
                save('userId', myUserId);
                saveAll();
            }
            
            // Re-render everything with loaded data
            renderHabits();
            renderTaskChecklist();
            renderXP();
            if (calendar) calendar.render();
            
            // Sync Profile (Leaderboard)
            syncProfile();
            
            // Hide overlay and show app
            welcomeOverlay.classList.add('hidden');
            setTimeout(() => { welcomeOverlay.style.display = 'none'; appContainer.classList.add('visible'); }, 500);
            
            const greetEl = document.getElementById('dashGreeting');
            if(greetEl) greetEl.textContent = storedName ? `Bonne session, ${storedName}.` : 'Prêt pour une session de Deep Work ?';
        });
        
    } else {
        // Not logged in
        authLoading.style.display = 'none';
        authScreen.style.display = 'flex';
        welcomeOverlay.style.display = 'flex';
        appContainer.classList.remove('visible');
    }
});

// ===== NAVIGATION =====
const navLinks = document.querySelectorAll('.nav-links li');
const views = document.querySelectorAll('.view-section');
let calendar;

function switchView(targetId) {
    navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('data-target') === targetId));
    views.forEach(v => {
        const show = v.id === targetId;
        v.classList.toggle('active', show);
        if (show && targetId === 'view-agenda' && calendar) setTimeout(() => calendar.render(), 50);
        if (show && targetId === 'view-productivity') renderCharts();
        if (show && targetId === 'view-pomodoro') updatePomodoroSelect();
        if (show && targetId === 'view-habits') renderHabitsHub();
        if (show && targetId === 'view-leaderboard') renderLeaderboard();
    });
}
navLinks.forEach(l => l.addEventListener('click', e => switchView(e.currentTarget.getAttribute('data-target'))));
document.querySelector('.productivity-link').addEventListener('click', e => { e.preventDefault(); switchView('view-productivity'); });
document.querySelectorAll('.section-link').forEach(btn => {
    btn.addEventListener('click', e => { 
        e.preventDefault(); 
        switchView(e.currentTarget.getAttribute('data-target')); 
    });
});

// ===== HABITS =====
function renderHabits() {
    const list = document.getElementById('habitList');
    list.innerHTML = '';
    habits.forEach(h => {
        const d = document.createElement('div');
        d.className = `habit-item ${h.completed ? 'completed disabled-habit' : ''}`;
        d.innerHTML = `<div class="checkbox" data-id="${h.id}"></div><span>${h.text}</span>`;
        list.appendChild(d);
    });
    list.querySelectorAll('.checkbox').forEach(b => b.addEventListener('click', e => {
        const h = habits.find(x => x.id == e.target.dataset.id);
        if(h && !h.completed) { 
            h.completed = true; 
            h.timesCompleted = (h.timesCompleted||0)+1; 
            addXP(10); // +10 XP pour une habitude complétée
            saveAll(); renderHabits();
        }
    }));
}

function addHabit(text) {
    if(!text) return;
    habits.push({ id: Date.now(), text, completed: false, timesCompleted: 0 });
    saveAll(); renderHabits(); renderHabitsHub();
}

document.getElementById('addHabitBtn').addEventListener('click', () => { const inp = document.getElementById('newHabitInput'); addHabit(inp.value.trim()); inp.value=''; });
document.getElementById('addHabitBtnHub').addEventListener('click', () => { const inp = document.getElementById('newHabitInputHub'); addHabit(inp.value.trim()); inp.value=''; });

// ===== HABITS HUB =====
let habitBarChart;
function renderHabitsHub() {
    // Bubbles
    const container = document.getElementById('habitBubbles');
    container.innerHTML = '';
    const icons = {'Lecture':'📖','Méditation':'🧘','Sport':'💪','Maths':'📐','Anglais':'🇬🇧','Espagnol':'🇪🇸'};
    habits.forEach(h => {
        const b = document.createElement('div');
        b.className = 'habit-bubble';
        b.innerHTML = `<span class="bubble-icon">${icons[h.text]||'✦'}</span><span class="bubble-label">${h.text}</span><span class="bubble-count">${h.timesCompleted||0} fois</span>`;
        b.addEventListener('click', () => openHabitDetail(h.id));
        container.appendChild(b);
    });
    // Bar chart
    const ctx = document.getElementById('habitBarChart');
    if(!ctx) return;
    const labels = habits.map(h => h.text);
    const data = habits.map(h => h.timesCompleted || 0);
    if(habitBarChart) habitBarChart.destroy();
    habitBarChart = new Chart(ctx, {
        type: 'bar', data: { labels, datasets: [{ label: 'Fois complétées', data, backgroundColor: '#1A1A1A', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#EAEAEA' } }, x: { grid: { display: false } } } }
    });
}

function openHabitDetail(id) {
    const h = habits.find(x => x.id == id);
    if(!h) return;
    document.getElementById('habitDetailTitle').textContent = h.text;
    document.getElementById('habitDetailSubtitle').textContent = `Interface dédiée à : ${h.text}`;
    document.getElementById('detailTimesCompleted').textContent = h.timesCompleted || 0;
    document.getElementById('detailStreak').textContent = h.completed ? '✓ Faite' : 'En attente';
    document.getElementById('habitDetailNotes').value = habitNotes[id] || '';
    views.forEach(v => v.classList.remove('active'));
    document.getElementById('view-habit-detail').classList.add('active');
    document.getElementById('view-habit-detail').dataset.habitId = id;

    // Toggle between reading tracker and generic view
    const isLecture = h.text.toLowerCase().includes('lecture');
    document.getElementById('genericHabitDetail').style.display = isLecture ? 'none' : 'flex';
    document.getElementById('readingTracker').style.display = isLecture ? 'block' : 'none';
    if(isLecture) renderReadingTable();
}
document.getElementById('habitDetailBack').addEventListener('click', () => switchView('view-habits'));
document.getElementById('saveHabitNotes').addEventListener('click', () => {
    const id = document.getElementById('view-habit-detail').dataset.habitId;
    habitNotes[id] = document.getElementById('habitDetailNotes').value;
    saveAll();
});

// ===== READING TRACKER (Notion-style) =====
let books = load('books', []);
let rtFilter = 'all';

// Modal
document.getElementById('addBookBtn').addEventListener('click', () => { document.getElementById('addBookModal').style.display = 'flex'; });
document.getElementById('cancelBookBtn').addEventListener('click', () => { document.getElementById('addBookModal').style.display = 'none'; });
document.getElementById('saveBookBtn').addEventListener('click', () => {
    const title = document.getElementById('bookTitle').value.trim();
    const author = document.getElementById('bookAuthor').value.trim();
    const type = document.getElementById('bookType').value;
    const totalPages = parseInt(document.getElementById('bookTotalPages').value) || 0;
    if(!title) return;
    books.push({ id: Date.now(), title, author, type, totalPages, pagesRead: 0, rating: 0, status: 'pas-lu' });
    save('books', books);
    document.getElementById('bookTitle').value = '';
    document.getElementById('bookAuthor').value = '';
    document.getElementById('bookTotalPages').value = '';
    document.getElementById('addBookModal').style.display = 'none';
    renderReadingTable();
});

// Filters
document.querySelectorAll('.rt-filter').forEach(btn => btn.addEventListener('click', e => {
    document.querySelectorAll('.rt-filter').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    rtFilter = e.target.dataset.rtFilter;
    renderReadingTable();
}));

function renderReadingTable() {
    const tbody = document.getElementById('readingTableBody');
    tbody.innerHTML = '';
    let filtered = rtFilter === 'all' ? [...books] : books.filter(b => b.status === rtFilter);
    // Sort: finished books by finishedDate ascending (oldest first), then unfinished at the bottom
    filtered.sort((a, b) => {
        if(a.finishedDate && b.finishedDate) return new Date(a.finishedDate) - new Date(b.finishedDate);
        if(a.finishedDate) return -1;
        if(b.finishedDate) return 1;
        return 0;
    });
    if(!filtered.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#737373;padding:2rem;">Aucun livre. Cliquez sur "Nouveau" pour commencer.</td></tr>'; return; }
    filtered.forEach(book => {
        const pct = book.totalPages > 0 ? Math.round((book.pagesRead / book.totalPages) * 100) : 0;
        const statusClass = `rt-status-${book.status}`;
        const statusLabel = book.status === 'lu' ? 'Lu' : book.status === 'en-cours' ? 'En cours' : 'Pas lu';
        const stars = [1,2,3,4,5].map(i => `<span class="rt-star ${i <= book.rating ? 'filled' : ''}" data-book="${book.id}" data-star="${i}">★</span>`).join('');
        const dateStr = book.finishedDate ? new Date(book.finishedDate).toLocaleDateString('fr-FR', {day:'numeric',month:'long',year:'numeric'}) : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${book.title}</td>
            <td style="color:#737373">${book.author}</td>
            <td><span class="rt-status ${statusClass}" data-book="${book.id}">${statusLabel}</span></td>
            <td><span class="rt-type-tag">${book.type}</span></td>
            <td><div class="rt-stars">${stars}</div></td>
            <td class="rt-progress-cell"><div class="rt-progress-wrap"><span class="rt-progress-text">${pct} %</span><div class="rt-progress-bar"><div class="rt-progress-fill" style="width:${pct}%"></div></div></div></td>
            <td><input type="number" class="rt-page-input" value="${book.pagesRead}" min="0" max="${book.totalPages}" data-book="${book.id}"> / ${book.totalPages}</td>
            <td style="color:#737373;font-size:0.85rem;white-space:nowrap;">${dateStr}</td>
            <td><button class="rt-delete-btn" data-book="${book.id}"><i class="ph ph-trash"></i></button></td>
        `;
        tbody.appendChild(tr);
    });

    // Star click
    tbody.querySelectorAll('.rt-star').forEach(s => s.addEventListener('click', e => {
        const book = books.find(b => b.id == e.target.dataset.book);
        if(book) { book.rating = parseInt(e.target.dataset.star); save('books', books); renderReadingTable(); }
    }));
    // Status cycle — auto-set finishedDate when "Lu"
    tbody.querySelectorAll('.rt-status').forEach(s => s.addEventListener('click', e => {
        const book = books.find(b => b.id == e.currentTarget.dataset.book);
        if(book) {
            const cycle = ['pas-lu','en-cours','lu'];
            book.status = cycle[(cycle.indexOf(book.status)+1)%3];
            if(book.status==='lu') { book.pagesRead=book.totalPages; book.finishedDate = book.finishedDate || new Date().toISOString(); }
            else { book.finishedDate = null; }
            save('books', books); renderReadingTable();
        }
    }));
    // Page input — auto-set finishedDate when pages == total
    tbody.querySelectorAll('.rt-page-input').forEach(inp => inp.addEventListener('change', e => {
        const book = books.find(b => b.id == e.target.dataset.book);
        if(book) {
            book.pagesRead = Math.min(parseInt(e.target.value)||0, book.totalPages);
            if(book.pagesRead>=book.totalPages) { book.status='lu'; book.finishedDate = book.finishedDate || new Date().toISOString(); }
            else if(book.pagesRead>0) { book.status='en-cours'; book.finishedDate=null; }
            else { book.status='pas-lu'; book.finishedDate=null; }
            save('books', books); renderReadingTable();
        }
    }));
    // Delete
    tbody.querySelectorAll('.rt-delete-btn').forEach(btn => btn.addEventListener('click', e => {
        const id = e.currentTarget.dataset.book;
        books = books.filter(b => b.id != id);
        save('books', books); renderReadingTable();
    }));
}

// ===== TASKS =====
function renderTaskChecklist() {
    const el = document.getElementById('taskChecklist');
    el.innerHTML = '';
    if(!tasks.length) { el.innerHTML = '<p class="empty-state">Aucune tâche. Utilisez l\'assistant ci-dessus !</p>'; return; }
    tasks.forEach(t => {
        const d = document.createElement('div');
        d.className = `task-check-item disabled-task ${t.completed ? 'completed' : ''}`;
        d.innerHTML = `<div class="checkbox" data-id="${t.id}"></div><span>${t.title}</span><span class="task-subject">${t.subject||'Général'}</span>`;
        el.appendChild(d);
    });
    // Manual checking is disabled. Tasks are completed automatically by Pomodoro.
}

// ===== FULLCALENDAR =====
const calEl = document.getElementById('calendar');
calendar = new FullCalendar.Calendar(calEl, {
    initialView: 'timeGridDay', locale: 'fr',
    headerToolbar: { left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek' },
    slotMinTime: '08:00:00', slotMaxTime: '22:00:00', allDaySlot: false, editable: true,
    events: calendarEvents.map(e => ({...e})),
    eventDrop: info => { const ev = calendarEvents.find(x=>x.id===info.event.id); if(ev){ev.start=info.event.startStr;ev.end=info.event.endStr;} saveAll(); }
});

// ===== GEMINI AI ASSISTANT =====
const aiProposal = document.getElementById('aiProposal');
const aiList = document.getElementById('aiProposalList');
const geminiStatus = document.getElementById('geminiStatus');
const geminiKeySetup = document.getElementById('geminiKeySetup');
const aiChatInterface = document.getElementById('aiChatInterface');
const aiSpinner = document.getElementById('aiSpinner');
const aiSubmitText = document.getElementById('aiSubmitText');
let proposedActions = [];

// API Key Management
const apiStatusDot = document.getElementById('apiStatusDot');
const apiStatusText = document.getElementById('apiStatusText');
const resetApiBtn = document.getElementById('resetApiBtn');

function getGeminiKey() { return localStorage.getItem('df_gemini_api_key'); }
function updateGeminiUI() {
    const key = getGeminiKey();
    if(key) {
        geminiStatus.textContent = "Connecté";
        geminiStatus.className = "gemini-status ready";
        geminiKeySetup.style.display = "none";
        aiChatInterface.style.display = "flex";
        
        // Sidebar status
        if(apiStatusDot) apiStatusDot.classList.add('active');
        if(apiStatusText) apiStatusText.textContent = "IA Active";
        if(resetApiBtn) resetApiBtn.style.display = "flex";
    } else {
        geminiStatus.textContent = "Clé requise";
        geminiStatus.className = "gemini-status missing";
        geminiKeySetup.style.display = "block";
        aiChatInterface.style.display = "none";
        
        // Sidebar status
        if(apiStatusDot) apiStatusDot.classList.remove('active');
        if(apiStatusText) apiStatusText.textContent = "IA non configurée";
        if(resetApiBtn) resetApiBtn.style.display = "none";
    }
}

document.getElementById('saveGeminiKeyBtn').addEventListener('click', () => {
    const val = document.getElementById('geminiKeyInput').value.trim();
    if(val) { 
        localStorage.setItem('df_gemini_api_key', val); 
        // Also save to firebase if connected
        if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
            db.ref('users/' + firebase.auth().currentUser.uid + '/data/gemini_api_key').set(val);
        }
        updateGeminiUI(); 
    }
});

if(resetApiBtn) {
    resetApiBtn.addEventListener('click', () => {
        if(confirm("Voulez-vous vraiment modifier ou supprimer la clé API actuelle ?")) {
            localStorage.removeItem('df_gemini_api_key');
            if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
                db.ref('users/' + firebase.auth().currentUser.uid + '/data/gemini_api_key').remove();
            }
            updateGeminiUI();
        }
    });
}

// Manual Task Addition
const manualTaskInput = document.getElementById('manualTaskInput');
const addManualTaskBtn = document.getElementById('addManualTaskBtn');

if(addManualTaskBtn) {
    addManualTaskBtn.addEventListener('click', () => {
        const title = manualTaskInput.value.trim();
        if(title) {
            const now = new Date();
            const startStr = now.toISOString().slice(0, 16); // Local time simplified
            const endStr = new Date(now.getTime() + 60*60*1000).toISOString().slice(0, 16);
            
            const newId = 'man-' + Date.now();
            const newEvent = {
                id: newId,
                title: title,
                start: startStr,
                end: endStr,
                subject: 'Manuel',
                backgroundColor: '#171717'
            };
            
            calendarEvents.push(newEvent);
            if (typeof calendar !== 'undefined' && calendar) calendar.addEvent(newEvent);
            
            tasks.push({ id: newId, title: title, subject: 'Manuel', completed: false, pomodoros: 0 });
            
            saveAll();
            if (typeof renderTaskChecklist === 'function') renderTaskChecklist();
            manualTaskInput.value = '';
            addXP(5); // Small reward for planning
        }
    });
}

// Click on geminiStatus to disconnect
if(geminiStatus) {
    geminiStatus.addEventListener('click', () => {
        if(getGeminiKey() && confirm("Voulez-vous vous déconnecter de l'IA (supprimer la clé API) ?")) {
            localStorage.removeItem('df_gemini_api_key');
            if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
                db.ref('users/' + firebase.auth().currentUser.uid + '/data/gemini_api_key').remove();
            }
            updateGeminiUI();
        }
    });
    geminiStatus.style.cursor = 'pointer';
}


updateGeminiUI();

document.getElementById('aiSubmitBtn').addEventListener('click', async () => {
    const prompt = document.getElementById('aiInput').value.trim();
    if(!prompt) return;
    const apiKey = getGeminiKey();
    if(!apiKey) return;

    // UI Loading state
    aiSpinner.style.display = 'block';
    aiSubmitText.textContent = "Réflexion...";
    document.getElementById('aiSubmitBtn').disabled = true;
    aiProposal.style.display = 'none';

    // Construct the context
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const calendarContext = calendarEvents.map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end }));
    
    const systemPrompt = `
Tu es un assistant IA de productivité intégré à "Benthic".
Aujourd'hui, nous sommes le ${todayStr}. Il est ${now.toLocaleTimeString()}.
Voici l'état actuel du calendrier de l'utilisateur (format JSON) :
${JSON.stringify(calendarContext)}

L'utilisateur demande : "${prompt}"

Tu dois analyser sa demande et renvoyer EXCLUSIVEMENT un tableau JSON d'actions pour modifier son calendrier.
Ne renvoie AUCUN texte explicatif, juste le code JSON valide commençant par [ et finissant par ].
Chaque action doit avoir ce format :
- Pour ajouter : {"action": "ADD", "title": "Titre", "subject": "Sujet/Matière", "start": "YYYY-MM-DDTHH:mm:00", "end": "YYYY-MM-DDTHH:mm:00"}
- Pour déplacer : {"action": "MOVE", "id": "id-de-levenement", "newStart": "YYYY-MM-DDTHH:mm:00", "newEnd": "YYYY-MM-DDTHH:mm:00"}
- Pour supprimer : {"action": "DELETE", "id": "id-de-levenement"}

Les durées par défaut si non précisées : 1h. Garde des pauses de 15min entre les créneaux si tu ajoutes plusieurs tâches.
Réponds uniquement avec le JSON.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt }] }]
            })
        });
        
        const data = await response.json();
        if(data.error) throw new Error(data.error.message);
        
        const rawText = data.candidates[0].content.parts[0].text;
        // Clean markdown backticks if Gemini adds them
        const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        proposedActions = JSON.parse(jsonStr);
        
        renderProposals();
    } catch(err) {
        alert("Erreur de l'API Gemini : " + err.message);
    } finally {
        aiSpinner.style.display = 'none';
        aiSubmitText.textContent = "Demander à Gemini";
        document.getElementById('aiSubmitBtn').disabled = false;
    }
});

function renderProposals() {
    aiList.innerHTML = '';
    if(!proposedActions || !proposedActions.length) {
        aiList.innerHTML = '<li>Aucune action modifiant le calendrier détectée.</li>';
    } else {
        proposedActions.forEach(a => {
            const li = document.createElement('li');
            if(a.action === 'ADD') li.innerHTML = `<span><span style="color:var(--success)">[AJOUT]</span> ${a.title}</span><span class="time-badge">${new Date(a.start).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})} - ${new Date(a.end).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>`;
            if(a.action === 'MOVE') {
                const ev = calendarEvents.find(e => e.id === a.id);
                li.innerHTML = `<span><span style="color:var(--accent-primary)">[DÉPLACEMENT]</span> ${ev ? ev.title : a.id}</span><span class="time-badge">➜ ${new Date(a.newStart).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>`;
            }
            if(a.action === 'DELETE') {
                const ev = calendarEvents.find(e => e.id === a.id);
                li.innerHTML = `<span><span style="color:var(--danger)">[SUPPRESSION]</span> ${ev ? ev.title : a.id}</span>`;
            }
            aiList.appendChild(li);
        });
    }
    aiProposal.style.display = 'block';
}

document.getElementById('aiAcceptBtn').addEventListener('click', () => {
    if(!proposedActions) return;
    proposedActions.forEach(a => {
        if(a.action === 'ADD') {
            const id = `ai-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
            const ev = { id, title: `${a.subject}: ${a.title}`, start: a.start, end: a.end, backgroundColor: '#171717' };
            calendarEvents.push(ev); calendar.addEvent(ev);
            tasks.push({ id, title: a.title, subject: a.subject || 'Général', completed: false, pomodoros: 0 });
        } else if (a.action === 'MOVE') {
            const evIndex = calendarEvents.findIndex(e => e.id === a.id);
            if(evIndex > -1) {
                calendarEvents[evIndex].start = a.newStart;
                calendarEvents[evIndex].end = a.newEnd;
                const calEv = calendar.getEventById(a.id);
                if(calEv) { calEv.setStart(a.newStart); calEv.setEnd(a.newEnd); }
            }
        } else if (a.action === 'DELETE') {
            calendarEvents = calendarEvents.filter(e => e.id !== a.id);
            tasks = tasks.filter(t => t.id !== a.id);
            const calEv = calendar.getEventById(a.id);
            if(calEv) calEv.remove();
        }
    });
    saveAll(); renderTaskChecklist(); 
    aiProposal.style.display = 'none';
    document.getElementById('aiInput').value = '';
});
document.getElementById('aiRejectBtn').addEventListener('click', () => { aiProposal.style.display = 'none'; });

// ===== VACATION PLANNER =====
document.getElementById('generateVacationBtn').addEventListener('click', () => {
    tasks = []; calendarEvents = []; calendar.removeAllEvents();
    const today = new Date();
    const ds = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const mathExos = ["Matrices: Ex 2","EV: Ex 1","Fonctions: Ex 3","Intégration: Ex 4","Intégration: Ex 5","Séries: Ex 3","Probas: Ex 6","Probas: Ex 7","VA: Ex 8"];
    let tid = 1;
    const add = (title, subject, sh, eh) => {
        const id = `t-${tid++}`;
        tasks.push({ id, title, subject, completed: false, pomodoros: 0 });
        const ev = { id, title: `${subject}: ${title}`, start: `${ds}T${sh}:00`, end: `${ds}T${eh}:00`, backgroundColor: '#171717' };
        calendarEvents.push(ev); calendar.addEvent(ev);
    };
    add(`${mathExos[0]}, ${mathExos[1]}, ${mathExos[2]}`,'Maths','09:00','10:00');
    add(`${mathExos[3]}, ${mathExos[4]}, ${mathExos[5]}`,'Maths','10:15','11:15');
    add(`${mathExos[6]}, ${mathExos[7]}, ${mathExos[8]}`,'Maths','11:30','12:30');
    add('Versions & Thèmes','Anglais','14:00','15:00');
    add('Grammaire: Conj. Réguliers/Irréguliers','Espagnol','15:15','16:00');
    add('Versions & Thèmes','Espagnol','16:00','16:45');
    add('Révision: Chapitres 1-4','ESH','17:00','18:30');
    add('Révision / Lectures','Philo & Lettres','18:45','19:45');
    saveAll(); renderTaskChecklist(); switchView('view-agenda');
});

// ===== POMODORO =====
let pomoInterval, timeRemaining = 55*60, isRunning = false, selectedTaskId = null;
let currentPhase = 'WORK'; // 'WORK' or 'BREAK'
const timerDisplay = document.getElementById('timerDisplay');
const pomoCountEl = document.getElementById('pomoCount');
const pomoPhaseEl = document.getElementById('pomodoroPhase');
const durationSelect = document.getElementById('pomodoroDuration');

function updatePomodoroSelect() {
    const sel = document.getElementById('pomodoroTask');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Sélectionnez une tâche...</option>';
    tasks.filter(t=>!t.completed).forEach(t => { const o=document.createElement('option'); o.value=t.id; o.textContent=`${t.subject} — ${t.title}`; if(t.id===cur) o.selected=true; sel.appendChild(o); });
}
document.getElementById('pomodoroTask').addEventListener('change', e => {
    selectedTaskId = e.target.value;
    const t = tasks.find(x=>x.id===selectedTaskId);
    pomoCountEl.textContent = t ? t.pomodoros : 0;
});

durationSelect.addEventListener('change', (e) => {
    if(!isRunning && currentPhase === 'WORK') {
        timeRemaining = parseInt(e.target.value) * 60;
        updateTimer();
    }
});

function updateTimer() { timerDisplay.textContent = `${String(Math.floor(timeRemaining/60)).padStart(2,'0')}:${String(timeRemaining%60).padStart(2,'0')}`; }

function endPomodoro() {
    clearInterval(pomoInterval);
    isRunning = false;
    
    if (currentPhase === 'WORK') {
        const t = tasks.find(x=>x.id===selectedTaskId);
        if(t){ 
            t.pomodoros++; 
            pomoCountEl.textContent = t.pomodoros; 
            
            // Auto complete task
            t.completed = true; 
            const ev = calendar.getEventById(t.id); 
            if(ev) ev.setProp('backgroundColor','#10B981'); 
            
            // Add task XP
            addXP(20);
        }
        
        // Add work XP
        const durationMins = parseInt(durationSelect.value);
        const xpEarned = Math.round(durationMins * (50/60));
        addXP(xpEarned);
        
        saveAll();
        renderTaskChecklist();
        updatePomodoroSelect();
        
        // Start Break Phase
        currentPhase = 'BREAK';
        pomoPhaseEl.textContent = 'PAUSE (5 MIN)';
        pomoPhaseEl.className = 'pomodoro-phase break';
        timeRemaining = 5 * 60; // 5 min break
        updateTimer();
        alert('Session de travail terminée ! XP gagné. Prenez 5 minutes de pause.');
    } else {
        // End of Break Phase
        currentPhase = 'WORK';
        pomoPhaseEl.textContent = 'TRAVAIL';
        pomoPhaseEl.className = 'pomodoro-phase';
        timeRemaining = parseInt(durationSelect.value) * 60;
        updateTimer();
        alert('Pause terminée. Prêt pour la prochaine session ?');
    }
}

document.getElementById('btnStart').addEventListener('click', () => {
    if(currentPhase === 'WORK' && !selectedTaskId){ alert('Sélectionnez une tâche avant de commencer à travailler.'); return; }
    if(isRunning) return; isRunning = true;
    pomoInterval = setInterval(() => {
        if(timeRemaining > 0){ timeRemaining--; updateTimer(); }
        else { endPomodoro(); }
    }, 1000);
});
document.getElementById('btnPause').addEventListener('click', () => { clearInterval(pomoInterval); isRunning=false; });
document.getElementById('btnReset').addEventListener('click', () => { 
    clearInterval(pomoInterval); 
    isRunning=false; 
    currentPhase = 'WORK';
    pomoPhaseEl.textContent = 'TRAVAIL';
    pomoPhaseEl.className = 'pomodoro-phase';
    timeRemaining = parseInt(durationSelect.value)*60; 
    updateTimer(); 
});

// ===== PRODUCTIVITY CHARTS =====
let timeChart, ratioChart;
Chart.defaults.color = '#737373'; Chart.defaults.font.family = "'Outfit', sans-serif";

timeChart = new Chart(document.getElementById('timeChart'), {
    type:'bar', data:{labels:[],datasets:[]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true,grid:{color:'#EAEAEA'}}, x:{grid:{display:false}} } }
});
ratioChart = new Chart(document.getElementById('ratioChart'), {
    type:'doughnut', data:{labels:[],datasets:[]},
    options:{ responsive:true, maintainAspectRatio:false, cutout:'75%', plugins:{legend:{position:'bottom'}} }
});

function renderCharts() {
    const total = tasks.length, done = tasks.filter(t=>t.completed).length;
    ratioChart.data = { labels:['Terminées','Restantes'], datasets:[{ data: total?[done,total-done]:[], backgroundColor:['#171717','#EAEAEA'], borderWidth:0 }] };
    ratioChart.update();
    const subj = {}; tasks.forEach(t=>{ if(t.completed) subj[t.subject]=(subj[t.subject]||0)+1; });
    timeChart.data = { labels:Object.keys(subj), datasets:[{ label:'Tâches', data:Object.values(subj), backgroundColor:'#1A1A1A', borderRadius:4 }] };
    timeChart.update();
    // Pomo stats
    const psc = document.getElementById('pomoStatsContent');
    const wp = tasks.filter(t=>t.pomodoros>0);
    if(!wp.length){ psc.innerHTML='<p class="empty-state">Aucun Pomodoro terminé.</p>'; }
    else { psc.innerHTML=''; let tot=0; wp.forEach(t=>{ tot+=t.pomodoros; const d=document.createElement('div'); d.className='pomo-stat-item'; d.innerHTML=`<span class="pomo-stat-title">${t.subject} — ${t.title}</span><span class="pomo-stat-count">${t.pomodoros}</span>`; psc.appendChild(d); });
        const td=document.createElement('div'); td.className='pomo-stat-item'; td.style.borderTop='1px solid var(--panel-border)'; td.innerHTML=`<span class="pomo-stat-title" style="font-weight:500;color:var(--text-main)">Total</span><span class="pomo-stat-count" style="background:#171717;color:#fff">${tot}</span>`; psc.appendChild(td);
    }
    // Habit stats
    const hsc = document.getElementById('habitStatsContent');
    if(!habits.length){ hsc.innerHTML='<p class="empty-state">Aucune habitude.</p>'; }
    else { hsc.innerHTML=''; habits.forEach(h=>{ const d=document.createElement('div'); d.className='habit-stat-item'; d.innerHTML=`<span class="habit-stat-title">${h.text}</span><span class="habit-stat-count" style="${h.completed?'background:#10B981;color:#fff':''}">${h.completed?'Faite':'En attente'}</span>`; hsc.appendChild(d); }); }
}

document.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', e => {
    document.querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active'));
    e.target.classList.add('active'); renderCharts();
}));

// ===== LEADERBOARD & SOCIAL =====
document.getElementById('lbMyId').textContent = myUserId;
document.getElementById('btnCopyId').addEventListener('click', () => {
    navigator.clipboard.writeText(myUserId);
    const btn = document.getElementById('btnCopyId');
    btn.innerHTML = '<i class="ph ph-check"></i>';
    setTimeout(() => btn.innerHTML = '<i class="ph ph-copy"></i>', 2000);
});

document.getElementById('btnAddFriend').addEventListener('click', () => {
    const input = document.getElementById('friendIdInput');
    const id = input.value.trim().toUpperCase();
    if(!id) return;
    if(id === myUserId) { alert("Vous ne pouvez pas vous ajouter vous-même !"); return; }
    if(friends.find(f => f.id === id)) { alert("Cet ami est déjà dans votre liste."); return; }
    
    // Check if user exists in Firebase
    db.ref('users/' + id).once('value', snapshot => {
        if (snapshot.exists()) {
            const user = snapshot.val();
            friends.push({ id: user.id, name: user.name });
            saveAll();
            input.value = '';
            renderLeaderboard();
            alert(`Ami ajouté : ${user.name}`);
        } else {
            alert("ID introuvable. Demandez à votre ami de se connecter une fois sur l'application !");
        }
    });
});

let lbCurrentTab = 'friends';
document.querySelectorAll('.lb-tab').forEach(b => b.addEventListener('click', e => {
    document.querySelectorAll('.lb-tab').forEach(x => x.classList.remove('active'));
    e.target.classList.add('active');
    lbCurrentTab = e.target.dataset.tab;
    renderLeaderboard();
}));

function renderLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');
    if(!tbody) return;
    
    const { level } = getLevelInfo(totalXP);
    document.getElementById('lbMyName').textContent = storedName || 'Utilisateur';
    document.getElementById('lbMyLevel').textContent = 'Niv. ' + level;
    
    // Fetch data from Firebase
    if (lbCurrentTab === 'friends') {
        // Fetch specific friends
        const ids = [myUserId, ...friends.map(f => f.id)];
        const promises = ids.map(id => db.ref('users/' + id).once('value'));
        
        Promise.all(promises).then(snapshots => {
            const list = snapshots.filter(s => s.exists()).map(s => {
                const u = s.val();
                return { ...u, isMe: u.id === myUserId };
            });
            displayLeaderboardRows(list);
        });
    } else {
        // Global: fetch top 20
        db.ref('users').orderByChild('xp').limitToLast(20).once('value', snapshot => {
            const list = [];
            snapshot.forEach(child => {
                const u = child.val();
                list.push({ ...u, isMe: u.id === myUserId });
            });
            list.reverse(); // high to low
            displayLeaderboardRows(list);
        });
    }
}

function displayLeaderboardRows(list) {
    const tbody = document.getElementById('leaderboardBody');
    tbody.innerHTML = '';
    list.sort((a, b) => b.xp - a.xp);
    
    list.forEach((user, index) => {
        const tr = document.createElement('tr');
        const rankClass = index < 3 ? `rank-${index+1}` : '';
        const lInfo = getLevelInfo(user.xp);
        tr.innerHTML = `
            <td><div class="rank-badge ${rankClass}">${index + 1}</div></td>
            <td>
                <div class="lb-user-cell">
                    <i class="ph ph-user-circle"></i>
                    ${user.name}
                    ${user.isMe ? '<span class="lb-is-me">VOUS</span>' : ''}
                </div>
            </td>
            <td>Niv. ${lInfo.level}</td>
            <td style="font-weight: 600;">${user.xp} XP</td>
        `;
        tbody.appendChild(tr);
    });
}

// ===== REWARDS & SKINS SYSTEM =====
const REWARDS_CONFIG = {
    wallpapers: [
        { id: 'default', name: 'Abysses Profonds', level: 1, url: 'none', color: '#0F172A' },
        { id: 'bg1', name: 'Rayons Abyssaux', level: 3, url: 'backgrounds/bg_level_3.png', color: '#1e293b' },
        { id: 'bg2', name: 'Bioluminescence', level: 5, url: 'backgrounds/bg_level_5.png', color: '#0f172a' },
        { id: 'bg3', name: 'Cité Engloutie', level: 7, url: 'backgrounds/bg_level_7.png', color: '#1e293b' },
        { id: 'bg4', name: 'Trône de Corail', level: 9, url: 'backgrounds/bg_level_9.png', color: '#0f172a' }
    ],
    pomoSkins: [
        { id: 'default', name: 'Classique', level: 1, class: '' },
        { id: 'neon', name: 'Néon Futuriste', level: 2, class: 'skin-neon' },
        { id: 'minimal', name: 'Ultra Minimal', level: 4, class: 'skin-minimal' },
        { id: 'abyssal', name: 'Signature Abyssale', level: 6, class: 'skin-abyssal' }
    ],
    titles: [
        { id: 't1', name: 'Plongeur Novice', level: 1 },
        { id: 't2', name: 'Éclaireur des Eaux', level: 5 },
        { id: 't3', name: 'Maître des Abysses', level: 10 }
    ]
};

let userSettings = load('userSettings', { wallpaper: 'default', pomoSkin: 'default' });

function applyUserSettings() {
    // Apply wallpaper
    const wp = REWARDS_CONFIG.wallpapers.find(w => w.id === userSettings.wallpaper);
    if (wp) {
        if (wp.url !== 'none') {
            document.body.style.backgroundImage = `url('${wp.url}')`;
            document.body.classList.add('has-custom-bg');
        } else {
            document.body.style.backgroundImage = 'none';
            document.body.style.backgroundColor = wp.color;
            document.body.classList.remove('has-custom-bg');
        }
    }

    // Apply Pomo Skin
    const skin = REWARDS_CONFIG.pomoSkins.find(s => s.id === userSettings.pomoSkin);
    const timerDisplay = document.getElementById('timerDisplay');
    if (skin && timerDisplay) {
        timerDisplay.className = 'timer-display ' + skin.class;
    }
}

function renderRewards() {
    const { level } = getLevelInfo(totalXP);
    
    // Wallpapers
    const wpContainer = document.getElementById('rewards-wallpapers');
    wpContainer.innerHTML = '';
    REWARDS_CONFIG.wallpapers.forEach(wp => {
        const isLocked = level < wp.level;
        const isActive = userSettings.wallpaper === wp.id;
        const card = document.createElement('div');
        card.className = `reward-card ${isLocked ? 'locked' : ''} ${isActive ? 'active-reward' : ''}`;
        card.innerHTML = `
            ${isActive ? '<span class="reward-badge-active">Actif</span>' : ''}
            <div class="reward-preview" style="background-image: url('${wp.url}'); background-color: ${wp.color}">
                ${isLocked ? '<i class="ph ph-lock"></i>' : ''}
            </div>
            <div class="reward-info">
                <h4>${wp.name}</h4>
                <p>${isLocked ? `Débloqué au Niv. ${wp.level}` : 'Débloqué'}</p>
            </div>
        `;
        if (!isLocked) {
            card.onclick = () => {
                userSettings.wallpaper = wp.id;
                save('userSettings', userSettings);
                applyUserSettings();
                renderRewards();
            };
        }
        wpContainer.appendChild(card);
    });

    // Pomo Skins
    const skinContainer = document.getElementById('rewards-pomo-skins');
    skinContainer.innerHTML = '';
    REWARDS_CONFIG.pomoSkins.forEach(skin => {
        const isLocked = level < skin.level;
        const isActive = userSettings.pomoSkin === skin.id;
        const card = document.createElement('div');
        card.className = `reward-card ${isLocked ? 'locked' : ''} ${isActive ? 'active-reward' : ''}`;
        card.innerHTML = `
            ${isActive ? '<span class="reward-badge-active">Actif</span>' : ''}
            <div class="reward-preview">
                <span class="timer-display ${skin.class}" style="font-size: 1.5rem;">25:00</span>
                ${isLocked ? '<i class="ph ph-lock" style="position:absolute"></i>' : ''}
            </div>
            <div class="reward-info">
                <h4>${skin.name}</h4>
                <p>${isLocked ? `Débloqué au Niv. ${skin.level}` : 'Débloqué'}</p>
            </div>
        `;
        if (!isLocked) {
            card.onclick = () => {
                userSettings.pomoSkin = skin.id;
                save('userSettings', userSettings);
                applyUserSettings();
                renderRewards();
            };
        }
        skinContainer.appendChild(card);
    });
}

// Reward Tabs Navigation
document.querySelectorAll('.reward-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.reward-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById('rewards-wallpapers').style.display = tab === 'wallpapers' ? 'grid' : 'none';
        document.getElementById('rewards-pomo-skins').style.display = tab === 'pomo-skins' ? 'grid' : 'none';
        document.getElementById('rewards-titles').style.display = tab === 'titles' ? 'grid' : 'none';
    });
});

document.getElementById('linkToRewards').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('view-rewards');
    renderRewards();
});

// ===== INITIAL RENDER =====
renderHabits(); renderTaskChecklist(); renderXP(); syncProfile(); renderLeaderboard(); applyUserSettings();

// ===== PWA SERVICE WORKER REGISTRATION =====
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service Worker registered', reg))
        .catch(err => console.error('Service Worker registration failed', err));
}
});
