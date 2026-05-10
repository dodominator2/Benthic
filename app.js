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
function performDailyReset() {
    const todayStr = new Date().toISOString().split('T')[0];
    const lastLogin = localStorage.getItem('df_lastLoginDate');
    
    if (lastLogin !== todayStr) {
        console.log("Nouveau jour détecté. Réinitialisation des données quotidiennes...");
        
        // Reset habits for the new day
        habits.forEach(h => { h.completed = false; });
        
        // We no longer remove completed tasks here, so they can appear in the history
        // tasks = tasks.filter(t => !t.completed);
        
        localStorage.setItem('df_lastLoginDate', todayStr);
        saveAll();
        return true;
    }
    return false;
}

// Perform initial reset
performDailyReset();

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
            performDailyReset(); // Check if cloud data needs reset (e.g. from previous day)
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
    
    const todayStr = new Date().toISOString().split('T')[0];
    const visibleTasks = tasks.filter(t => !t.completed || (t.completedAt && t.completedAt.startsWith(todayStr)));
    
    if(!visibleTasks.length) { el.innerHTML = '<p class="empty-state">Aucune tâche. Utilisez l\'assistant ci-dessus !</p>'; return; }
    
    visibleTasks.forEach(t => {
        const d = document.createElement('div');
        d.className = `task-check-item ${t.completed ? 'completed' : ''}`;
        d.innerHTML = `<div class="checkbox" data-id="${t.id}"></div><span>${t.title}</span><span class="task-subject">${t.subject||'Général'}</span>`;
        el.appendChild(d);
    });

    // Manual checking
    el.querySelectorAll('.checkbox').forEach(b => b.addEventListener('click', e => {
        const t = tasks.find(x => x.id == e.target.dataset.id);
        if(t && !t.completed) {
            t.completed = true;
            t.completedAt = new Date().toISOString();
            addXP(20);
            saveAll();
            renderTaskChecklist();
            updatePomodoroSelect();
            // Color calendar event if it exists
            if (typeof calendar !== 'undefined') {
                const ev = calendar.getEventById(t.id);
                if(ev) ev.setProp('backgroundColor','#10B981');
            }
        }
    }));
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
            t.completedAt = new Date().toISOString();
            const ev = calendar.getEventById(t.id); 
            if(ev) ev.setProp('backgroundColor','#10B981'); 
            
            // Add task XP
            addXP(20);
        }
        
        // Add work XP
        const durationMins = parseInt(durationSelect.value);
        const xpEarned = Math.round(durationMins * (50/60));
        addXP(xpEarned);
        
        // Add minigame credit
        userSettings.gameCredits = (userSettings.gameCredits || 0) + 1;
        save('userSettings', userSettings);
        
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
    
    // Task History
    renderTaskHistory();
}

function renderTaskHistory() {
    const list = document.getElementById('completedTasksList');
    if(!list) return;
    const completed = tasks.filter(t => t.completed).sort((a,b) => {
        const d1 = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const d2 = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return d2 - d1; // newest first
    });
    
    if(!completed.length) {
        list.innerHTML = '<p class="empty-state">Aucune tâche terminée récemment.</p>';
        return;
    }
    
    list.innerHTML = '';
    completed.forEach(t => {
        const d = document.createElement('div');
        d.className = 'history-task-item';
        const dateStr = t.completedAt ? new Date(t.completedAt).toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short'}) : 'Date inconnue';
        d.innerHTML = `
            <div class="history-task-left">
                <span class="history-task-title">${t.title}</span>
                <span class="history-task-subject">${t.subject||'Général'}</span>
            </div>
            <span class="history-task-date">${dateStr}</span>
        `;
        list.appendChild(d);
    });
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
        { id: 'default', name: 'Benthic Clair (Défaut)', level: 1, url: 'none', color: '#FAFAFA' },
        { id: 'bg1', name: 'Rayons Abyssaux', level: 3, url: 'backgrounds/bg_level_3.png', color: '#1e293b' },
        { id: 'bg2', name: 'Bioluminescence', level: 5, url: 'backgrounds/bg_level_5.png', color: '#0f172a' },
        { id: 'bg3', name: 'Cité Engloutie', level: 7, url: 'backgrounds/bg_level_7.png', color: '#1e293b' },
        { id: 'bg4', name: 'Trône de Corail', level: 9, url: 'backgrounds/bg_level_9.png', color: '#0f172a' },
        { id: 'bg5', name: 'Fosse des Mariannes', level: 12, url: 'none', color: '#0a0f1c' },
        { id: 'bg6', name: 'Épave Oubliée', level: 15, url: 'none', color: '#111827' },
        { id: 'bg7', name: 'Sanctuaire Sous-Marin', level: 18, url: 'none', color: '#0f172a' },
        { id: 'bg8', name: 'Aurore Boréale', level: 22, url: 'none', color: '#064e3b' },
        { id: 'bg9', name: 'Forêt de Varech', level: 26, url: 'none', color: '#14532d' },
        { id: 'bg10', name: 'Océan Infini', level: 30, url: 'none', color: '#1e3a8a' },
        { id: 'bg11', name: 'Abysse Scintillant', level: 35, url: 'none', color: '#312e81' },
        { id: 'bg12', name: 'Mégalodon', level: 40, url: 'none', color: '#111827' },
        { id: 'bg13', name: 'Léviathan', level: 45, url: 'none', color: '#171717' },
        { id: 'bg14', name: 'L\'Œil de l\'Océan', level: 50, url: 'none', color: '#000000' }
    ],
    pomoSkins: [
        { id: 'default', name: 'Digital (Défaut)', level: 1, class: '', icon: 'ph-timer' },
        { id: 'neon', name: 'Néon Cyan', level: 2, class: 'skin-neon', icon: 'ph-lightning' },
        { id: 'hourglass', name: 'Sablier Abyssal', level: 4, class: 'skin-abyssal', icon: 'ph-hourglass' },
        { id: 'minimal', name: 'Zen Minimal', level: 6, class: 'skin-minimal', icon: 'ph-drop' },
        { id: 'clock', name: 'Horloge Marine', level: 8, class: 'skin-clock', icon: 'ph-clock' },
        { id: 'radar', name: 'Radar Sous-Marin', level: 11, class: 'skin-radar', icon: 'ph-target' },
        { id: 'compass', name: 'Boussole Ancienne', level: 14, class: 'skin-compass', icon: 'ph-compass' },
        { id: 'pearl', name: 'Perle Brillante', level: 17, class: 'skin-pearl', icon: 'ph-circle' },
        { id: 'mechanic', name: 'Mécanique Antique', level: 20, class: 'skin-mechanic', icon: 'ph-gear' },
        { id: 'holo', name: 'Hologramme Atlante', level: 25, class: 'skin-holo', icon: 'ph-projector-screen' },
        { id: 'crystal', name: 'Cristal Temporel', level: 30, class: 'skin-crystal', icon: 'ph-diamond' },
        { id: 'drop', name: 'Compte-Gouttes Cosmique', level: 40, class: 'skin-drop', icon: 'ph-eyedropper' },
        { id: 'relic', name: 'Relique Temporelle', level: 50, class: 'skin-relic', icon: 'ph-crown' }
    ],
    titles: [
        { id: 't1', name: 'Plongeur Novice', level: 1 },
        { id: 't2', name: 'Éclaireur des Eaux', level: 5 },
        { id: 't3', name: 'Maître des Abysses', level: 10 },
        { id: 't4', name: 'Explorateur de la Fosse', level: 15 },
        { id: 't5', name: 'Gardien des Courants', level: 20 },
        { id: 't6', name: 'Chasseur de Trésors', level: 25 },
        { id: 't7', name: 'Empereur des Océans', level: 30 },
        { id: 't8', name: 'Légende Sous-Marine', level: 40 },
        { id: 't9', name: 'Poséidon', level: 50 }
    ],
    fonts: [
        { id: 'default', name: 'Outfit (Défaut)', level: 1, value: "'Outfit', sans-serif" },
        { id: 'mono', name: 'Codeur Abyssal', level: 10, value: "'Roboto Mono', monospace" },
        { id: 'classic', name: 'Littérature Marine', level: 20, value: "'Playfair Display', serif" },
        { id: 'future', name: 'Futuriste', level: 30, value: "'Space Grotesk', sans-serif" },
        { id: 'antique', name: 'Antique', level: 40, value: "'Cinzel', serif" },
        { id: 'script', name: 'Calligraphie', level: 50, value: "'Dancing Script', cursive" }
    ],
    colors: [
        { id: 'default', name: 'Carbone (Défaut)', level: 1, value: '#171717' },
        { id: 'emerald', name: 'Vert Émeraude', level: 8, value: '#10b981' },
        { id: 'violet', name: 'Violet Profond', level: 16, value: '#8b5cf6' },
        { id: 'gold', name: 'Or Atlante', level: 24, value: '#f59e0b' },
        { id: 'magma', name: 'Rouge Magma', level: 32, value: '#ef4444' },
        { id: 'pink', name: 'Rose Bioluminescent', level: 42, value: '#ec4899' },
        { id: 'black', name: 'Noir Abyssal', level: 50, value: '#000000' }
    ]
};

let userSettings = load('userSettings', { wallpaper: 'default', pomoSkin: 'default', font: 'default', color: 'default', gameCredits: 0 });

function applyUserSettings() {
    // Apply wallpaper
    const wp = REWARDS_CONFIG.wallpapers.find(w => w.id === userSettings.wallpaper);
    if (wp) {
        if (wp.id === 'default') {
            document.body.style.backgroundImage = 'none';
            document.body.style.backgroundColor = '#FAFAFA';
            document.body.classList.remove('has-custom-bg');
        } else {
            document.body.classList.add('has-custom-bg');
            if (wp.url && wp.url !== 'none') {
                document.body.style.backgroundImage = `url('${wp.url}')`;
                document.body.style.backgroundColor = wp.color || 'transparent';
            } else {
                document.body.style.backgroundImage = 'none';
                document.body.style.backgroundColor = wp.color || '#0f172a';
            }
        }
    }

    // Apply Pomo Skin
    const skin = REWARDS_CONFIG.pomoSkins.find(s => s.id === userSettings.pomoSkin);
    const timerDisplay = document.getElementById('timerDisplay');
    if (skin && timerDisplay) {
        timerDisplay.className = 'timer-display ' + skin.class;
    }

    // Apply Font
    const font = REWARDS_CONFIG.fonts.find(f => f.id === (userSettings.font || 'default'));
    if (font) {
        document.documentElement.style.setProperty('--font-family', font.value);
    }
    
    // Apply Color
    const color = REWARDS_CONFIG.colors.find(c => c.id === (userSettings.color || 'default'));
    if (color) {
        document.documentElement.style.setProperty('--accent-primary', color.value);
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

    // Fonts
    const fontContainer = document.getElementById('rewards-fonts');
    if (fontContainer) {
        fontContainer.innerHTML = '';
        REWARDS_CONFIG.fonts.forEach(font => {
            const isLocked = level < font.level;
            const isActive = userSettings.font === font.id || (!userSettings.font && font.id === 'default');
            const card = document.createElement('div');
            card.className = `reward-card ${isLocked ? 'locked' : ''} ${isActive ? 'active-reward' : ''}`;
            card.innerHTML = `
                ${isActive ? '<span class="reward-badge-active">Actif</span>' : ''}
                <div class="reward-preview" style="background: var(--panel-bg);">
                    <span style="font-family: ${font.value}; font-size: 2rem; color: var(--text-main);">Aa</span>
                    ${isLocked ? '<i class="ph ph-lock" style="position:absolute; font-size: 1.2rem; bottom: 10px; right: 10px;"></i>' : ''}
                </div>
                <div class="reward-info">
                    <h4>${font.name}</h4>
                    <p>${isLocked ? `Débloqué au Niv. ${font.level}` : 'Débloqué'}</p>
                </div>
            `;
            if (!isLocked) {
                card.onclick = () => {
                    userSettings.font = font.id;
                    save('userSettings', userSettings);
                    applyUserSettings();
                    renderRewards();
                };
            }
            fontContainer.appendChild(card);
        });
    }

    // Colors
    const colorContainer = document.getElementById('rewards-colors');
    if (colorContainer) {
        colorContainer.innerHTML = '';
        REWARDS_CONFIG.colors.forEach(color => {
            const isLocked = level < color.level;
            const isActive = userSettings.color === color.id || (!userSettings.color && color.id === 'default');
            const card = document.createElement('div');
            card.className = `reward-card ${isLocked ? 'locked' : ''} ${isActive ? 'active-reward' : ''}`;
            card.innerHTML = `
                ${isActive ? '<span class="reward-badge-active">Actif</span>' : ''}
                <div class="reward-preview" style="background: var(--panel-bg); display: flex; align-items: center; justify-content: center;">
                    <div style="width: 40px; height: 40px; border-radius: 50%; background-color: ${color.value};"></div>
                    ${isLocked ? '<i class="ph ph-lock" style="position:absolute; font-size: 1.2rem; bottom: 10px; right: 10px;"></i>' : ''}
                </div>
                <div class="reward-info">
                    <h4>${color.name}</h4>
                    <p>${isLocked ? `Débloqué au Niv. ${color.level}` : 'Débloqué'}</p>
                </div>
            `;
            if (!isLocked) {
                card.onclick = () => {
                    userSettings.color = color.id;
                    save('userSettings', userSettings);
                    applyUserSettings();
                    renderRewards();
                };
            }
            colorContainer.appendChild(card);
        });
    }
    
    // Titles
    const titlesContainer = document.getElementById('rewards-titles');
    if (titlesContainer) {
        titlesContainer.innerHTML = '';
        REWARDS_CONFIG.titles.forEach(title => {
            const isLocked = level < title.level;
            const isActive = userSettings.title === title.id;
            const card = document.createElement('div');
            card.className = `reward-card ${isLocked ? 'locked' : ''} ${isActive ? 'active-reward' : ''}`;
            card.innerHTML = `
                ${isActive ? '<span class="reward-badge-active">Actif</span>' : ''}
                <div class="reward-preview" style="background: var(--panel-bg); display: flex; align-items: center; justify-content: center;">
                    <span style="font-weight: 600; font-size: 1.1rem; color: var(--accent-primary);">${title.name}</span>
                    ${isLocked ? '<i class="ph ph-lock" style="position:absolute; font-size: 1.2rem; bottom: 10px; right: 10px;"></i>' : ''}
                </div>
                <div class="reward-info">
                    <h4>${title.name}</h4>
                    <p>${isLocked ? `Débloqué au Niv. ${title.level}` : 'Débloqué'}</p>
                </div>
            `;
            if (!isLocked) {
                card.onclick = () => {
                    userSettings.title = title.id;
                    save('userSettings', userSettings);
                    applyUserSettings();
                    renderRewards();
                };
            }
            titlesContainer.appendChild(card);
        });
    }

    // Minigame access
    const minigameSection = document.getElementById('minigame-section');
    if (minigameSection) {
        if (level >= 10) {
            minigameSection.style.display = 'flex';
            const creditsDisp = document.getElementById('gameCreditsDisplay');
            if(creditsDisp) creditsDisp.textContent = userSettings.gameCredits || 0;
            
            const btnLaunch = document.getElementById('btnLaunchMinigame');
            if (userSettings.gameCredits > 0) {
                btnLaunch.disabled = false;
                btnLaunch.style.opacity = '1';
                btnLaunch.onclick = () => launchMinigame();
            } else {
                btnLaunch.disabled = true;
                btnLaunch.style.opacity = '0.5';
                btnLaunch.onclick = null;
            }
        } else {
            minigameSection.style.display = 'none';
        }
    }

    // Progression / Prochainement
    renderFutureRewards(level);
}

function renderFutureRewards(currentLevel) {
    const futureContainer = document.getElementById('rewards-future');
    if (!futureContainer) return;
    
    // Trouver la prochaine récompense de chaque type
    const nextWp = REWARDS_CONFIG.wallpapers.find(w => w.level > currentLevel);
    const nextSkin = REWARDS_CONFIG.pomoSkins.find(s => s.level > currentLevel);
    const nextFont = REWARDS_CONFIG.fonts.find(f => f.level > currentLevel);
    const nextColor = REWARDS_CONFIG.colors.find(c => c.level > currentLevel);
    
    let html = '<h3>Prochaines étapes de votre voyage</h3><div class="future-rewards-row">';
    if (nextWp) {
        html += `<div class="future-item"><i class="ph ph-image"></i> <span>Niveau ${nextWp.level} : ${nextWp.name}</span></div>`;
    }
    if (nextSkin) {
        html += `<div class="future-item"><i class="ph ph-timer"></i> <span>Niveau ${nextSkin.level} : Horloge ${nextSkin.name}</span></div>`;
    }
    if (nextFont) {
        html += `<div class="future-item"><i class="ph ph-text-t"></i> <span>Niveau ${nextFont.level} : Police ${nextFont.name}</span></div>`;
    }
    if (nextColor) {
        html += `<div class="future-item"><i class="ph ph-palette"></i> <span>Niveau ${nextColor.level} : Couleur ${nextColor.name}</span></div>`;
    }
    html += '</div>';
    futureContainer.innerHTML = html;
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
        const fTab = document.getElementById('rewards-fonts'); if(fTab) fTab.style.display = tab === 'fonts' ? 'grid' : 'none';
        const cTab = document.getElementById('rewards-colors'); if(cTab) cTab.style.display = tab === 'colors' ? 'grid' : 'none';
    });
});

document.getElementById('linkToRewards').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('view-rewards');
    renderRewards();
});

// ===== INITIAL RENDER =====
renderHabits(); renderTaskChecklist(); renderXP(); syncProfile(); renderLeaderboard(); applyUserSettings();

// ===== PWA SERVICE WORKER REGISTRATION & UPDATE SYSTEM =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('Service Worker registered');

            // Vérifie si une mise à jour est déjà prête en arrière-plan
            if (reg.waiting) {
                showUpdateUI(reg.waiting);
            }

            // Détecte si un nouveau SW arrive
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateUI(newWorker);
                    }
                });
            });
        }).catch(err => console.error('SW Registration Error', err));
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload();
        }
    });
}

}

// ============================================
// ABYSSAL DIVER MINI-GAME LOGIC
// ============================================
let mgAnimationId;
let mgGameTimerInterval;
let mgTimeLeft = 300; // 5 minutes (300 seconds)
let mgScore = 0;
let mgIsPlaying = false;
let mgSubmarine;
let mgObstacles = [];
let mgFrameCount = 0;
const canvas = document.getElementById('gameCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

function launchMinigame() {
    if (!userSettings.gameCredits || userSettings.gameCredits <= 0) return;
    
    // Consume credit
    userSettings.gameCredits--;
    save('userSettings', userSettings);
    renderRewards(); // update UI
    
    document.getElementById('minigameModal').style.display = 'flex';
    document.getElementById('mgStartOverlay').style.display = 'block';
    document.getElementById('mgGameOverOverlay').style.display = 'none';
    
    // Reset Game State
    mgTimeLeft = 300;
    mgScore = 0;
    updateMgTimerDisplay();
    document.getElementById('mgScore').textContent = '0';
    document.getElementById('mgBestScore').textContent = userSettings.mgBestScore || 0;
    
    // Draw initial background
    if(ctx) {
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

document.getElementById('btnCloseMinigame').addEventListener('click', () => {
    document.getElementById('minigameModal').style.display = 'none';
    stopMinigame();
});

document.getElementById('mgStartBtn').addEventListener('click', startMinigame);
document.getElementById('mgRestartBtn').addEventListener('click', startMinigame);

function startMinigame() {
    document.getElementById('mgStartOverlay').style.display = 'none';
    document.getElementById('mgGameOverOverlay').style.display = 'none';
    
    mgIsPlaying = true;
    mgScore = 0;
    mgObstacles = [];
    mgFrameCount = 0;
    
    mgSubmarine = {
        x: 100, y: 250, width: 40, height: 20,
        velocity: 0, gravity: 0.25, jump: -5
    };
    
    document.getElementById('mgScore').textContent = mgScore;
    
    // Start countdown
    clearInterval(mgGameTimerInterval);
    mgGameTimerInterval = setInterval(() => {
        mgTimeLeft--;
        updateMgTimerDisplay();
        if(mgTimeLeft <= 0) {
            endMinigame(true);
        }
    }, 1000);
    
    // Game Loop
    cancelAnimationFrame(mgAnimationId);
    mgGameLoop();
}

function stopMinigame() {
    mgIsPlaying = false;
    clearInterval(mgGameTimerInterval);
    cancelAnimationFrame(mgAnimationId);
}

function endMinigame(timeOut = false) {
    stopMinigame();
    
    if (mgScore > (userSettings.mgBestScore || 0)) {
        userSettings.mgBestScore = mgScore;
        save('userSettings', userSettings);
    }
    
    const overOverlay = document.getElementById('mgGameOverOverlay');
    overOverlay.style.display = 'block';
    overOverlay.querySelector('h2').textContent = timeOut ? "Temps écoulé !" : "Collision !";
    overOverlay.querySelector('h2').style.color = timeOut ? "#34D399" : "#EF4444";
    document.getElementById('mgFinalScore').textContent = mgScore;
    
    // They can replay immediately ONLY if they have credits left.
    const restartBtn = document.getElementById('mgRestartBtn');
    if (userSettings.gameCredits > 0) {
        restartBtn.style.display = 'inline-block';
        restartBtn.onclick = () => {
            userSettings.gameCredits--;
            save('userSettings', userSettings);
            renderRewards();
            mgTimeLeft = 300;
            startMinigame();
        };
    } else {
        restartBtn.style.display = 'none';
    }
}

function updateMgTimerDisplay() {
    const disp = document.getElementById('mgTimerDisplay');
    if(!disp) return;
    const m = Math.floor(mgTimeLeft / 60);
    const s = mgTimeLeft % 60;
    disp.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// Input for Game
document.addEventListener('keydown', (e) => {
    if(e.code === 'Space' && mgIsPlaying) mgSubmarine.velocity = mgSubmarine.jump;
});
if(canvas) {
    canvas.addEventListener('mousedown', () => {
        if(mgIsPlaying) mgSubmarine.velocity = mgSubmarine.jump;
    });
}

function mgGameLoop() {
    if(!mgIsPlaying || !ctx) return;
    
    // Clear
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw Submarine
    mgSubmarine.velocity += mgSubmarine.gravity;
    mgSubmarine.y += mgSubmarine.velocity;
    
    ctx.fillStyle = '#FBBF24'; // Yellow submarine
    ctx.beginPath();
    ctx.ellipse(mgSubmarine.x + 20, mgSubmarine.y + 10, 20, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    // Submarine window
    ctx.fillStyle = '#60A5FA';
    ctx.beginPath();
    ctx.arc(mgSubmarine.x + 25, mgSubmarine.y + 8, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Floor/Ceiling collision
    if(mgSubmarine.y + mgSubmarine.height > canvas.height || mgSubmarine.y < 0) {
        endMinigame();
        return;
    }
    
    // Obstacles
    if(mgFrameCount % 90 === 0) {
        const gap = 150;
        const minHeight = 50;
        const topHeight = Math.floor(Math.random() * (canvas.height - gap - minHeight * 2)) + minHeight;
        mgObstacles.push({
            x: canvas.width,
            topHeight: topHeight,
            bottomY: topHeight + gap,
            width: 40,
            passed: false
        });
    }
    
    for(let i=0; i<mgObstacles.length; i++) {
        let obs = mgObstacles[i];
        obs.x -= 3; // speed
        
        ctx.fillStyle = '#334155';
        // Top pillar
        ctx.fillRect(obs.x, 0, obs.width, obs.topHeight);
        // Bottom pillar
        ctx.fillRect(obs.x, obs.bottomY, obs.width, canvas.height - obs.bottomY);
        
        // Mines (red dots on pillars)
        ctx.fillStyle = '#EF4444';
        ctx.beginPath(); ctx.arc(obs.x + 20, obs.topHeight, 8, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(obs.x + 20, obs.bottomY, 8, 0, Math.PI*2); ctx.fill();
        
        // Collision
        if (
            mgSubmarine.x < obs.x + obs.width &&
            mgSubmarine.x + mgSubmarine.width > obs.x &&
            (mgSubmarine.y < obs.topHeight || mgSubmarine.y + mgSubmarine.height > obs.bottomY)
        ) {
            endMinigame();
            return;
        }
        
        // Score
        if(obs.x + obs.width < mgSubmarine.x && !obs.passed) {
            mgScore++;
            document.getElementById('mgScore').textContent = mgScore;
            obs.passed = true;
        }
    }
    
    // Cleanup obstacles
    mgObstacles = mgObstacles.filter(o => o.x + o.width > 0);
    
    mgFrameCount++;
    mgAnimationId = requestAnimationFrame(mgGameLoop);
}

});
