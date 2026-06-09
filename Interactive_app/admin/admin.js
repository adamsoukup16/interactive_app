import { db, storage } from "../shared/firebase-config.js";
import { 
    collection, 
    addDoc, 
    serverTimestamp, 
    onSnapshot, 
    doc, 
    updateDoc, 
    deleteDoc, 
    query, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Lokální proměnné pro správu real-time synchronizace moderování
let unsubscribePhotos = null;
let activePhotoListeners = {}; 

// --- 🌎 NATVRDO GLOBÁLNÍ PROMĚNNÉ PRO MAZÁNÍ A UKLÁDÁNÍ ---
window.selectedLogoFile = null;
window.selectedBgFile = null;
window.currentLogoUrl = "";
window.currentBgUrl = "";

document.addEventListener("DOMContentLoaded", () => {
    
    // --- 🧭 1. PŘEPÍNÁNÍ ZÁLOŽEK V SIDEBARU ---
    const menuItems = document.querySelectorAll(".menu-item");
    const tabs = document.querySelectorAll(".tab-content");
    const pageTitle = document.getElementById("pageTitle");
    const pageSubtitle = document.getElementById("pageSubtitle");

    const tabMeta = {
        "create-tab": { title: "Nový zápas", sub: "Vytvoření nového interaktivního prostředí pro diváky" },
        "list-tab": { title: "Moje eventy", sub: "Kompletní přehled, statistiky a úprava běžících akcí" },
        "moderation-tab": { title: "Moderování obsahu", sub: "Schvalování fotek diváků na živou projekční stěnu" }
    };

    menuItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const targetTab = item.getAttribute("data-tab");

            menuItems.forEach(i => i.classList.remove("active"));
            tabs.forEach(t => t.classList.remove("active"));

            item.classList.add("active");
            document.getElementById(targetTab).classList.add("active");

            pageTitle.textContent = tabMeta[targetTab].title;
            pageSubtitle.textContent = tabMeta[targetTab].sub;
            
            if (targetTab === "create-tab" && e.triggeredByCode !== true) {
                document.getElementById("activeEventZone").style.display = "none";
            }
        });
    });

    // --- 🛠️ 2. REGISTRACE AKCÍ A ZÁKLADNÍ LISTENERY ---
    if (document.getElementById("btnCreateEvent")) document.getElementById("btnCreateEvent").addEventListener("click", createNewEvent);
    if (document.getElementById("btnSaveEdit")) document.getElementById("btnSaveEdit").addEventListener("click", saveEventEdit);
    
    // Hlídání lokálního výběru souborů
    if (document.getElementById("editLogoInput")) document.getElementById("editLogoInput").addEventListener("change", handleLocalLogoSelect);
    if (document.getElementById("editBgInput")) document.getElementById("editBgInput").addEventListener("change", handleLocalBgSelect);
   
    // Synchronizace textových políček barev písma
    if (document.getElementById("editNickColor")) {
        document.getElementById("editNickColor").addEventListener("input", (e) => {
            if (document.getElementById("editNickColorHex")) document.getElementById("editNickColorHex").value = e.target.value.toUpperCase();
            window.updateLivePreview();
        });
    }
    if (document.getElementById("editNickColorHex")) {
        document.getElementById("editNickColorHex").addEventListener("input", (e) => {
            if (document.getElementById("editNickColor")) document.getElementById("editNickColor").value = e.target.value;
            window.updateLivePreview();
        });
    }

    // Synchronizace textových políček barev PROUŽKU POD PÍSMEM
    if (document.getElementById("editNickBgColor")) {
        document.getElementById("editNickBgColor").addEventListener("input", (e) => {
            if (document.getElementById("editNickBgColorHex")) document.getElementById("editNickBgColorHex").value = e.target.value.toUpperCase();
            window.updateLivePreview();
        });
    }
    if (document.getElementById("editNickBgColorHex")) {
        document.getElementById("editNickBgColorHex").addEventListener("input", (e) => {
            if (document.getElementById("editNickBgColor")) document.getElementById("editNickBgColor").value = e.target.value;
            window.updateLivePreview();
        });
    }

    listenToEvents();
});

// --- ➕ 3. VYTVOŘENÍ NOVÉHO EVENTU V DATABÁZI ---
async function createNewEvent() {
    const eventName = document.getElementById("eventName").value.trim();
    const selectedGame = document.getElementById("gameSelect").value;

    if (!eventName) {
        alert("Prosím, zadej název akce/zápasu!");
        return;
    }

    try {
        await addDoc(collection(db, "events"), {
            title: eventName,
            wallTitle: eventName, 
            activeGame: selectedGame,
            status: "active",
            scanCount: 0,
            layoutType: "layout-symmetrical-8",
            rotationInterval: 5,
            logoPosition: "pos-left",
            qrPosition: "qr-right",
            showHeaders: true,
            showNicknames: true,
            maskNicknames: false,
            nickPosition: "nick-bottom",
            nickColor: "#F1F5F9",
            nickBgColor: "#0F172A", 
            bgColor: "#05070f",
            logoUrl: "",
            bgUrl: "",
            showWallQr: true, 
            showShadows: false,
            shadowColor: "#38bdf8",
            showCenterBg: true,
            centerBgColor: "#000000",
            subtitleText: "Naskenujte QR kód a pošlete fotku na plátno!",
            createdAt: serverTimestamp()
        });

        document.getElementById("eventName").value = ""; 

    } catch (error) {
        console.error("Chyba vytvoření akce: ", error);
    }
}

// --- 🗂️ 4. REAL-TIME VÝPIS TABULKY S HISTORIÍ ZÁPASŮ ---
// --- ⚙️ GLOBÁLNÍ FILTR MODULŮ (Přidej na začátek souboru k ostatním let proměnným) ---
window.currentModuleFilter = "all"; 

// --- 📊 OPRAVENÁ FUNKCE PRO FILTROVÁNÍ Z MENU (S FIXEM PRO ŘÁDEK 48) ---
window.filterEventsByModule = function(moduleName) {
    window.currentModuleFilter = moduleName;
    
    // 1. Vyčistíme aktivní stavy ze všech hlavních menu položek i podsložek
    document.querySelectorAll(".sidebar-menu .menu-item").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".sidebar-menu .sub-item").forEach(el => {
        el.style.background = "transparent";
        el.style.color = "#94a3b8";
        el.style.fontWeight = "normal";
    });
    
    // Vždy aktivujeme hlavní rodičovskou záložku "Moje eventy (Vše)"
    const mainAllBtn = document.getElementById("menu-sub-all");
    if (mainAllBtn) mainAllBtn.classList.add("active");

    // 2. Rozsvítíme konkrétní podsložku a změníme podnadpis stránky
    if (moduleName === "all") {
        document.getElementById("pageSubtitle").textContent = "Kompletní přehled, statistiky a úprava běžících akcí";
    } else if (moduleName === "social_watch") {
        const subSocial = document.getElementById("menu-sub-social");
        if (subSocial) {
            subSocial.style.background = "#1e293b";
            subSocial.style.color = "#38bdf8";
            subSocial.style.fontWeight = "bold";
        }
        document.getElementById("pageSubtitle").textContent = "Správa aktivních multimediálních fotostěn (Social Wall)";
    } else if (moduleName === "kviz") {
        const subKviz = document.getElementById("menu-sub-kviz");
        if (subKviz) {
            subKviz.style.background = "#1e293b";
            subKviz.style.color = "#8b5cf6";
            subKviz.style.fontWeight = "bold";
        }
        document.getElementById("pageSubtitle").textContent = "Správa interaktivních kvízů a otázek pro diváky";
    } else if (moduleName === "pexeso") {
        const subPexeso = document.getElementById("menu-sub-pexeso");
        if (subPexeso) {
            subPexeso.style.background = "#1e293b";
            subPexeso.style.color = "#ec4899";
            subPexeso.style.fontWeight = "bold";
        }
        document.getElementById("pageSubtitle").textContent = "Správa herních turnajů v digitálním pexesu";
    }

    // 3. Natvrdo schováme ostatní sekce a ROZSVÍTÍME velkou tabulku s eventy
    document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
    
    // Pojistka pro přesné ID tvé sekce s tabulkou
    const eventsTab = document.getElementById("events-tab") || document.getElementById("list-tab") || document.querySelector('[data-tab="events-tab"]');
    if (eventsTab) {
        eventsTab.classList.add("active");
    }

    document.getElementById("pageTitle").textContent = "Moje eventy";

    // 4. Bleskově překreslíme řádky podle nového filtru
    if (typeof window.refreshEventsTable === "function") {
        window.refreshEventsTable();
    }
};

// --- 📋 KORREKTNÍ LISTENTOEVENTS S PODPOROU PODSLOŽEK ---
let globalCachedEvents = []; // Paměť pro bleskové překreslení filtru

function listenToEvents() {
    onSnapshot(collection(db, "events"), (snapshot) => {
        globalCachedEvents = [];
        snapshot.forEach((docSnap) => {
            globalCachedEvents.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        // Zavoláme vykreslení tabulky
        window.refreshEventsTable();
    });
}

// --- ⚙️ GLOBÁLNÍ PAMĚŤ PRO STATISTIKY (Vlož na začátek souboru k ostatním let/window proměnným) ---
window.cachedStats = {}; 

// --- 📋 UPRAVENÁ FUNKCE PRO VYKRESLENÍ ŘÁDKŮ (S OKAMŽITÝM PLNĚNÍM STATISTIK) ---
window.refreshEventsTable = function() {
    const tbody = document.getElementById("eventsTableBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    let visibleRowsCount = 0;

    globalCachedEvents.forEach((event) => {
        const id = event.id;
        
        // Filtr podsložek
        if (window.currentModuleFilter !== "all" && event.activeGame !== window.currentModuleFilter) {
            return; 
        }

        visibleRowsCount++;

        // 🔥 TADY JE TA ZMĚNA:
        const pathSegments = window.location.pathname.split('/');
        const adminIndex = pathSegments.indexOf('admin');
        const repoPath = adminIndex > 0 ? pathSegments.slice(0, adminIndex).join('/') : '';
        const projectBaseUrl = `${window.location.origin}${repoPath}`;

        const publicUrl = `${projectBaseUrl}/public/index.html?event=${id}`;
        const wallUrl = `${projectBaseUrl}/wall/index.html?event=${id}`;
        const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(publicUrl)}`;
        const scans = event.scanCount || 0;

        // Načteme si statistiky z paměti, pokud už je máme stažené
        const stats = window.cachedStats[id] || { total: 0, approved: 0, pending: 0, rejected: 0 };

        let actionButtons = "";
        if (event.activeGame === "social_watch") {
            actionButtons = `
                <button class="btn-action btn-qr" onclick="window.showExistingQR('${id}', '${event.title.replace(/'/g, "\\'")}')" style="background:#0284c7; color:#fff; border:none; padding:6px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer; margin-right:4px;">👁️ Moderovat</button>
                <button class="btn-action btn-edit" onclick="window.openEditModal('${id}', '${event.title.replace(/'/g, "\\'")}', '${event.activeGame}')" style="background:#1e293b; color:#fff; border:1px solid #334155; padding:6px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer; margin-right:4px;">✏️ Nastavení</button>
            `;
        } else if (event.activeGame === "kviz") {
            actionButtons = `
                <button class="btn-action btn-kviz-control" onclick="window.openKvizControl('${id}', '${event.title.replace(/'/g, "\\'")}')" style="background:#8b5cf6; color:#fff; border:none; padding:6px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer; margin-right:4px;">🎮 Řídit kvíz</button>
                <button class="btn-action btn-kviz-questions" onclick="window.openKvizQuestions('${id}', '${event.title.replace(/'/g, "\\'")}')" style="background:#1e293b; color:#fff; border:1px solid #334155; padding:6px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer; margin-right:4px;">📝 Otázky</button>
            `;
        } else if (event.activeGame === "pexeso") {
            actionButtons = `
                <button class="btn-action btn-pexeso-control" onclick="window.openPexesoControl('${id}', '${event.title.replace(/'/g, "\\'")}')" style="background:#ec4899; color:#fff; border:none; padding:6px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer; margin-right:4px;">🎲 Spravovat hru</button>
                <button class="btn-action btn-pexeso-deck" onclick="window.openPexesoDeck('${id}', '${event.title.replace(/'/g, "\\'")}')" style="background:#1e293b; color:#fff; border:1px solid #334155; padding:6px 12px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer; margin-right:4px;">🃏 Balíček karet</button>
            `;
        }

        const tr = document.createElement("tr");
        tr.id = `row-${id}`;
        tr.innerHTML = `
            <td><strong>${event.title}</strong><br><small style="color:#64748b;">ID: ${id}</small></td>
            <td><span class="badge" style="background:#1e293b; color:#38bdf8; border:1px solid #334155; padding:3px 8px; border-radius:6px; font-size:0.75rem;">${event.activeGame}</span></td>
            <td>
                <div id="live-status-box-${id}" style="background: #020617; border: 1px solid #1e293b; padding: 10px; border-radius: 10px; min-width: 155px; transition: all 0.4s ease;">
                    <div style="font-size: 0.7rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">📱 Připojení diváci</div>
                    <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin: 2px 0;">Celkem: <span id="scan-text-${id}">${scans}x</span></div>
                    <div id="live-pulse-${id}" style="display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #10b981; font-weight: 600; margin-top: 4px;">
                        <span style="display:inline-block; width: 6px; height: 6px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981;"></span> Klidový stav
                    </div>
                </div>
            </td>
            <td>
                <div class="stats-container" id="stats-${id}" style="display:flex; flex-direction:column; gap:4px; font-size:0.8rem;">
                    <div class="stat-line" style="color:#fff;"><span class="stat-dot total" style="display:inline-block; width:8px; height:8px; background:#94a3b8; border-radius:50%; margin-right:6px;"></span> Celkem: <span id="total-${id}" style="font-weight:700;">${stats.total}</span></div>
                    <div class="stat-line" style="color:#10b981;"><span class="stat-dot approved" style="display:inline-block; width:8px; height:8px; background:#10b981; border-radius:50%; margin-right:6px;"></span> Schválené: <span id="approved-${id}" style="font-weight:700;">${stats.approved}</span></div>
                    <div class="stat-line" style="color:#eab308;"><span class="stat-dot pending" style="display:inline-block; width:8px; height:8px; background:#eab308; border-radius:50%; margin-right:6px;"></span> Čeká: <span id="pending-${id}" style="font-weight:700;">${stats.pending}</span></div>
                    <div class="stat-line" style="color:#ef4444;"><span class="stat-dot rejected" style="display:inline-block; width:8px; height:8px; background:#ef4444; border-radius:50%; margin-right:6px;"></span> Zamítnuté: <span id="rejected-${id}" style="font-weight:700;">${stats.rejected}</span></div>
                </div>
            </td>
            <td>
                <div class="access-cell" style="display:flex; align-items:center; gap:10px;">
                    <div class="mini-qr-trigger" onclick="window.openQrModal('${id}', '${event.title.replace(/'/g, "\\'")}', '${publicUrl}')" style="width:38px; height:38px; background:#fff; padding:3px; border-radius:6px; cursor:pointer;">
                        <img src="${qrApiUrl}" alt="QR" style="width:100%; height:100%; object-fit:contain;">
                    </div>
                    <a href="${wallUrl}" target="_blank" class="btn-live-wall" style="background:#1e293b; color:#fff; border:1px solid #334155; padding:6px 12px; border-radius:6px; font-size:0.8rem; text-decoration:none; font-weight:600;">LIVE</a>
                </div>
            </td>
            <td style="text-align: right; white-space: nowrap;">
                ${actionButtons}
                <button class="btn-action btn-delete" onclick="window.deleteEvent('${id}')" style="background:transparent; border:none; color:#ef4444; font-size:1.1rem; cursor:pointer; padding:4px 8px; margin-left:10px;">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);

        // Vždy bezpečně nastartujeme nebo obnovíme napojení na Firebase live sledování
        if (!activePhotoListeners[id]) {
            startIndividualPhotoListener(id); 
        }
    });

    if (visibleRowsCount === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b; font-style:italic; padding:30px;">V této sekci momentálně nemáš vytvořené žádné zápasy.</td></tr>`;
    }
};

// --- ⚙️ OPRAVENÝ REAL-TIME POSLUCHAČ STATISTIK S UKLÁDÁNÍM DO CACHE ---
function startIndividualPhotoListener(id) {
    const photosQuery = collection(db, "events", id, "social_wall");
    activePhotoListeners[id] = onSnapshot(photosQuery, (photoSnapshot) => {
        let total = 0, approved = 0, pending = 0, rejected = 0;
        
        photoSnapshot.forEach((pSnap) => {
            const pData = pSnap.data(); total++;
            let status = pData.status || (pData.approved === true ? "approved" : "pending");
            if (status === "approved") approved++;
            else if (status === "rejected") rejected++;
            else pending++;
        });

        // 🔥 KLÍČOVÝ FIX: Výsledky sčítání ihned uzamkneme do globální paměti
        window.cachedStats[id] = { total, approved, pending, rejected };

        // Okamžitě propíšeme do HTML prvků na webu, pokud zrovna existují
        if (document.getElementById(`total-${id}`)) document.getElementById(`total-${id}`).textContent = total;
        if (document.getElementById(`approved-${id}`)) document.getElementById(`approved-${id}`).textContent = approved;
        if (document.getElementById(`pending-${id}`)) document.getElementById(`pending-${id}`).textContent = pending;
        if (document.getElementById(`rejected-${id}`)) document.getElementById(`rejected-${id}`).textContent = rejected;
    });
}

// --- 🖼️ 5. LOKÁLNÍ VÝBĚR SOUBORŮ DO PROXY NÁHLEDU ---
function handleLocalLogoSelect(e) {
    const file = e.target.files[0]; if (!file) return;
    window.selectedLogoFile = file;
    
    document.getElementById("editLogoPreview").src = URL.createObjectURL(file);
    document.getElementById("editLogoPreviewContainer").style.display = "block";
    document.getElementById("editLogoStatus").textContent = "Vybráno (neuloženo)";
    document.getElementById("editLogoStatus").style.color = "#ef4444";
    
    window.updateLivePreview();
}

function handleLocalBgSelect(e) {
    const file = e.target.files[0]; if (!file) return;
    window.selectedBgFile = file;
    
    document.getElementById("editBgPreview").src = URL.createObjectURL(file);
    document.getElementById("editBgPreviewContainer").style.display = "block";
    document.getElementById("editBgStatus").textContent = "Vybráno (neuloženo)";
    document.getElementById("editBgStatus").style.color = "#ef4444";
    
    window.updateLivePreview();
}

// --- 📺 6. ŽIVÝ NÁHLED SIMULÁTORU (PLNĚ OPRAVENÝ A DYNAMICKÝ) ---
window.updateLivePreview = function() {
    const getV = (id) => document.getElementById(id) ? document.getElementById(id).value : "";
    const getC = (id) => document.getElementById(id) ? document.getElementById(id).checked : true;

    const layout = getV("editLayoutSelect"), logoPos = getV("editLogoPosition"), qrPos = getV("editQrPosition");
    const showHeader = getC("editShowHeaders"), showNicks = getC("editShowNicknames"), maskNicks = getC("editMaskNicknames");
    const nickPos = getV("editNickPosition"), nickColor = getV("editNickColor"), bgColor = getV("editBgColor");
    const subText = getV("editEventSub"), id = getV("editEventId"), showQr = getC("editShowWallQr");
    
    const showShadows = getC("editShowShadows"), shadowColor = getV("editShadowColor");
    const showCenterBg = getC("editShowCenterBg"), centerBgColor = getV("editCenterBgColor");
    const nickBgColor = getV("editNickBgColor");

    if (document.getElementById("simTitleText")) {
        document.getElementById("simTitleText").textContent = getV("editWallTitle") || "NÁZEV NA PLÁTNĚ";
    }
    if (document.getElementById("simSubText")) document.getElementById("simSubText").textContent = subText || "Naskenuj QR...";
    if (document.getElementById("colorHexText")) document.getElementById("colorHexText").textContent = bgColor.toUpperCase();
    if (document.getElementById("shadowHexText")) document.getElementById("shadowHexText").textContent = shadowColor.toUpperCase();
    if (document.getElementById("centerBgHexText")) document.getElementById("centerBgHexText").textContent = centerBgColor.toUpperCase();

    // Vykreslení a fix lokálního/vzdáleného obrázku pozadí
    const canvasSim = document.getElementById("canvasSimulator");
    if (canvasSim) {
        if (window.selectedBgFile) {
            canvasSim.style.backgroundImage = `url('${document.getElementById("editBgPreview").src}')`;
            canvasSim.style.backgroundSize = "cover";
            canvasSim.style.backgroundPosition = "center";
        } else if (window.currentBgUrl) {
            canvasSim.style.backgroundImage = `url('${window.currentBgUrl}')`;
            canvasSim.style.backgroundSize = "cover";
            canvasSim.style.backgroundPosition = "center";
        } else {
            canvasSim.style.backgroundImage = "none";
            canvasSim.style.backgroundColor = bgColor;
        }
    }

    // Inteligentní zarovnání středu podle přítomnosti loga
    const simCenter = document.querySelector(".sim-center-zone");
    if (simCenter) {
        simCenter.style.backgroundColor = showCenterBg ? centerBgColor : "transparent";
        simCenter.style.borderStyle = showCenterBg ? "solid" : "dashed";
        
        const hasLogo = (window.selectedLogoFile || window.currentLogoUrl);
        if (!hasLogo || qrPos === "qr-none" || !showQr) {
            simCenter.style.justifyContent = "center";
        } else {
            simCenter.style.justifyContent = "space-between";
        }
    }

    const simLogo = document.getElementById("simLogoPlace"), simQr = document.getElementById("simQr");
    if (simLogo && simQr) {
        if (qrPos === "qr-none" || !showQr) { 
            simQr.style.display = "none"; 
            simLogo.style.width = "100%"; 
        } else {
            simQr.style.display = "flex"; 
            const hasLogo = (window.selectedLogoFile || window.currentLogoUrl);
            simQr.style.width = hasLogo ? "44%" : "60wn%";
            
            if (id && (simQr.innerHTML === "QR KÓD" || simQr.innerHTML === "")) {
                simQr.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(window.location.origin+'/public/index.html?event='+id)}" style="max-height:100%;">`;
            }
            if (logoPos === "pos-left" || qrPos === "qr-right") { simLogo.style.order = "1"; simQr.style.order = "2"; }
            else { simLogo.style.order = "2"; simQr.style.order = "1"; }
        }

        if (window.selectedLogoFile) {
            simLogo.innerHTML = `<img src="${document.getElementById("editLogoPreview").src}" style="max-height:100%; max-width:100%; object-fit:contain; display:block; margin:0 auto;">`;
            simLogo.style.display = "flex";
        } else if (window.currentLogoUrl) {
            simLogo.innerHTML = `<img src="${window.currentLogoUrl}" style="max-height:100%; max-width:100%; object-fit:contain; display:block; margin:0 auto;">`;
            simLogo.style.display = "flex";
        } else {
            simLogo.innerHTML = "LOGO";
            simLogo.style.display = "none"; 
        }
    }

    // Vykreslení slotů, neonu a barvy proužku v simulátoru
    document.querySelectorAll(".sim-slot-sq").forEach(slot => {
        slot.className = "sim-slot-sq " + nickPos;
        slot.style.boxShadow = showShadows ? `0 0 10px ${shadowColor}` : "none";
        slot.style.borderColor = showShadows ? shadowColor : "#1e293b";
        
        const txt = slot.querySelector(".sim-nick-placeholder");
        if (txt) { 
            txt.style.display = showNicks ? "block" : "none"; 
            txt.style.color = nickColor; 
            txt.style.backgroundColor = nickBgColor; 
            txt.textContent = maskNicks ? "H***" : "👤 Host"; 
        }
    });

    // Zobrazení a skrytí reset tlačítek v dlaždicích
    if (document.getElementById("btnResetLogo")) {
        document.getElementById("btnResetLogo").style.display = (window.currentLogoUrl || window.selectedLogoFile) ? "inline-block" : "none";
    }
    if (document.getElementById("btnResetBg")) {
        document.getElementById("btnResetBg").style.display = (window.currentBgUrl || window.selectedBgFile) ? "inline-block" : "none";
    }
}

// --- ✏️ 7. OTEVŘENÍ KONFIGURAČNÍHO MODALU Z TABULKY ---
window.openEditModal = async function(id, title, game) {
    const setVal = (idEl, val) => { const el = document.getElementById(idEl); if (el) el.value = val; };
    const setCheck = (idEl, bool) => { const el = document.getElementById(idEl); if (el) el.checked = bool; };

    setVal("editEventId", id);
    setVal("editEventName", title);
    setVal("editGameSelect", game);
    
    window.selectedLogoFile = null;
    window.selectedBgFile = null;
    window.currentLogoUrl = "";
    window.currentBgUrl = "";
    
    if (document.getElementById("editLogoStatus")) document.getElementById("editLogoStatus").textContent = "Nezměněno";
    if (document.getElementById("editBgStatus")) document.getElementById("editBgStatus").textContent = "Výchozí barva";
    if (document.getElementById("editLogoPreviewContainer")) document.getElementById("editLogoPreviewContainer").style.display = "none";
    if (document.getElementById("editBgPreviewContainer")) document.getElementById("editBgPreviewContainer").style.display = "none";

    try {
        const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const eventSnap = await getDoc(doc(db, "events", id));
        
        if (eventSnap.exists()) {
            const data = eventSnap.data();
            
            setVal("editLayoutSelect", data.layoutType || "layout-symmetrical-8");
            setVal("editRotationInterval", data.rotationInterval || 5);
            setVal("editLogoPosition", data.logoPosition || "pos-left");
            setVal("editQrPosition", data.qrPosition || "qr-right");
            setVal("editEventSub", data.subtitleText || "Naskenujte QR kód a pošlete fotku na plátno!");
            setVal("editWallTitle", data.wallTitle || data.title || title);
            
            setCheck("editShowHeaders", data.showHeaders !== false); 
            setCheck("editShowNicknames", data.showNicknames !== false);   
            setCheck("editMaskNicknames", data.maskNicknames === true);   
            setCheck("editShowWallQr", data.showWallQr !== false); 
            setVal("editNickPosition", data.nickPosition || "nick-bottom");
            setVal("editNickColor", data.nickColor || "#F1F5F9");
            setVal("editNickBgColor", data.nickBgColor || "#0F172A");
            setVal("editBgColor", data.bgColor || "#05070f");

            setCheck("editShowShadows", data.showShadows === true);
            setVal("editShadowColor", data.shadowColor || "#38bdf8");
            setCheck("editShowCenterBg", data.showCenterBg !== false);
            setVal("editCenterBgColor", data.centerBgColor || "#000000");
            
            if (data.logoUrl) {
                window.currentLogoUrl = data.logoUrl;
                document.getElementById("editLogoPreview").src = data.logoUrl;
                document.getElementById("editLogoPreviewContainer").style.display = "block";
                document.getElementById("editLogoStatus").textContent = "Logo v cloudu";
            }
            
            if (data.bgUrl) {
                window.currentBgUrl = data.bgUrl;
                document.getElementById("editBgPreview").src = data.bgUrl;
                document.getElementById("editBgPreviewContainer").style.display = "block";
                document.getElementById("editBgStatus").textContent = "Tapeta v cloudu";
            }
        }
    } catch (e) { console.error(e); }

    window.updateLivePreview();
    document.getElementById("editModal").style.display = "flex";
}

// Zavření okna
window.closeEditModal = function() {
    document.getElementById("editModal").style.display = "none";
}

// --- 💾 8. UKLÁDÁNÍ PRODUKČNÍ KONFIGURACE DO FIREBASE ---
async function saveEventEdit() {
    const id = document.getElementById("editEventId") ? document.getElementById("editEventId").value : null;
    const saveBtn = document.getElementById("btnSaveEdit");
    const oldBtnText = saveBtn ? saveBtn.textContent : "Uložit";

    if (!id) return;
    if (saveBtn) { saveBtn.textContent = "⏳ Odesílám data..."; saveBtn.disabled = true; }

    const getVal = (idEl, fallback) => { const el = document.getElementById(idEl); return el ? el.value : fallback; };
    const getCheck = (idEl, fallback) => { const el = document.getElementById(idEl); return el ? el.checked : fallback; };

    try {
        if (window.selectedLogoFile) {
            const ext = window.selectedLogoFile.name.split('.').pop();
            const snap = await uploadBytes(ref(storage, `logos/${id}/brand_${Date.now()}.${ext}`), window.selectedLogoFile);
            window.currentLogoUrl = await getDownloadURL(snap.ref);
        }
        if (window.selectedBgFile) {
            const ext = window.selectedBgFile.name.split('.').pop();
            const snap = await uploadBytes(ref(storage, `backgrounds/${id}/wall_${Date.now()}.${ext}`), window.selectedBgFile);
            window.currentBgUrl = await getDownloadURL(snap.ref);
        }

        const updateData = {
            title: getVal("editEventName", "Zápas").trim(),
            wallTitle: getVal("editWallTitle", "ŽIVÁ FOTOSTĚNA").trim(), 
            activeGame: getVal("editGameSelect", "social_watch"),
            layoutType: getVal("editLayoutSelect", "layout-symmetrical-8"),
            rotationInterval: parseInt(getVal("editRotationInterval", 5)) || 5,
            logoPosition: getVal("editLogoPosition", "pos-left"),
            qrPosition: getVal("editQrPosition", "qr-right"),
            subtitleText: getVal("editEventSub", "Naskenujte QR kód...").trim(),
            showHeaders: getCheck("editShowHeaders", true),
            showWallQr: getCheck("editShowWallQr", true), 
            showNicknames: getCheck("editShowNicknames", true),
            maskNicknames: getCheck("editMaskNicknames", false),
            nickPosition: getVal("editNickPosition", "nick-bottom"),
            nickColor: getVal("editNickColor", "#F1F5F9"),
            nickBgColor: getVal("editNickBgColor", "#0F172A"), 
            bgColor: getVal("editBgColor", "#05070f"),
            showShadows: getCheck("editShowShadows", false),
            shadowColor: getVal("editShadowColor", "#38bdf8"),
            showCenterBg: getCheck("editShowCenterBg", true),
            centerBgColor: getVal("editCenterBgColor", "#000000"),
            logoUrl: window.currentLogoUrl,
            bgUrl: window.currentBgUrl
        };

        await updateDoc(doc(db, "events", id), updateData);
        window.closeEditModal();

    } catch (error) { console.error(error); alert("Chyba při ukládání: " + error.message); } 
    finally { if (saveBtn) { saveBtn.textContent = oldBtnText; saveBtn.disabled = false; } }
}

// --- MAZÁNÍ EVENTU ---
window.deleteEvent = async function(id) { 
    if (confirm("Smazat zápas trvale?")) {
        await deleteDoc(doc(db, "events", id)); 
    }
}

// --- MODÁLNÍ STAŽENÍ QR KÓDU ---
window.openQrModal = function(id, title, url) { 
    document.getElementById("qrModalTitle").textContent = title; 
    document.getElementById("qrModalImg").src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`; 
    document.getElementById("qrModal").style.display = "flex"; 
};
window.closeQrModal = function() { document.getElementById("qrModal").style.display = "none"; };

// --- SPOUŠTĚNÍ LIVE MODEROVÁNÍ PRO EVENT ---
// --- 👁️ 1. SPOUŠTĚNÍ LIVE MODEROVÁNÍ A FIX PŘEPNUTÍ DO MENU V MODERACI ---
window.showExistingQR = function(id, title) {
    // Zapamatujeme si název a ID vybraného eventu do elementů
    document.getElementById("activeEventTitle").textContent = title;
    document.getElementById("moderationEventTitle").textContent = title;
    
    // Vygenerujeme QR kód pro velkou zónu (pokud ji používáš)
    generateQRCode(`${window.location.origin}/public/index.html?event=${id}`);

    // 🔥 FIX: Odznačíme aktivní třídy ze všech tabů a položek menu
    document.querySelectorAll(".menu-item").forEach(i => i.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    
    // 🔥 FIX: Aktivujeme na tvrdo položku moderování v levém menu a její sekci
    const modMenuItem = document.getElementById("menuModeraion") || document.querySelector('[data-tab="moderation-tab"]');
    if (modMenuItem) {
        modMenuItem.style.display = "flex"; // Ukážeme položku v menu, pokud byla skrytá
        modMenuItem.classList.add("active");
    }
    document.getElementById("moderation-tab").classList.add("active");

    // Změníme hlavní texty v headeru administrace
    document.getElementById("pageTitle").textContent = "Moderování obsahu";
    document.getElementById("pageSubtitle").textContent = "Schvalování fotek diváků na živou projekční stěnu";

    // Nastartujeme real-time stahování VŠECH fotek pro tento konkrétní zápas
    listenToPhotosForModeration(id);
};

// --- 📸 2. REAL-TIME ČTENÍ VŠECH FOTEK (S FILTREM STAVŮ A CENZUROU) ---
function listenToPhotosForModeration(eventId) {
    if (unsubscribePhotos) unsubscribePhotos();
    
    // Stahujeme kompletně všechny fotky seřazené od nejnovějších
    const photosQuery = query(collection(db, "events", eventId, "social_wall"), orderBy("createdAt", "desc"));
    
    unsubscribePhotos = onSnapshot(photosQuery, (snapshot) => {
        const container = document.getElementById("pendingPhotos"); 
        if (!container) return;
        
        // 🔥 FIX MŘÍŽKY: Natvrdo aplikujeme ultra-moderní 5-sloupcový grid s menšími rozestupy
        container.style.display = "grid";
        container.style.gridTemplateColumns = "repeat(5, minmax(0, 1fr))";
        container.style.gap = "12px";
        container.style.padding = "10px 0";
        
        container.innerHTML = "";
        let pendingCount = 0;

        if (snapshot.empty) {
            container.innerHTML = "<p style='color:#64748b; font-style:italic; padding: 20px; grid-column: span 3; text-align:center;'>Zatím nebyly nahrány žádné fotky z mobilních telefonů.</p>";
            document.getElementById("modBadge").textContent = "0";
            return;
        }

        snapshot.forEach((docSnap) => {
            const photoData = docSnap.data();
            const pId = docSnap.id;
            
            // Kompatibilita: Pokud fotka nemá stav z dřívějška, určíme ho podle approved booleanu
            let currentStatus = photoData.status;
            if (!currentStatus) {
                currentStatus = photoData.approved === true ? "approved" : "pending";
            }

            if (currentStatus === "pending" || photoData.approved === false) {
                pendingCount++;
            }

            // Nastavení vizuálních stylů podle stavu karty 🟡 🟢 🔴
         
            let borderStyle = ""; 
            let statusBadge = "";
            let imageOverlay = ""; 
            let cardOpacity = "opacity: 1;";
            let imageFilter = "";

            if (currentStatus === "pending") {
                // 🟡 ČEKÁ NA SCHVÁLENÍ - Výrazná žlutá, která bije do očí
                borderStyle = "border: 2px solid #eab308; background: #1c1917;"; 
                statusBadge = `<span style="background:#fef9c3; color:#a16207; padding:4px 10px; border-radius:6px; font-size:0.7rem; font-weight:800; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">🟡 ČEKÁ VE FRONTĚ</span>`;
                imageOverlay = `
                    <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(234, 179, 8, 0.05); pointer-events: none;">
                        <span style="color: #eab308; font-weight: 800; font-size: 0.9rem; letter-spacing: 1px; text-transform: uppercase; background: #000; padding: 4px 12px; border-radius: 6px; border: 1px solid #eab308; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">⏳ NOVÁ FOTKA</span>
                    </div>
                `;
            } else if (currentStatus === "approved") {
                // 🟢 SCHVÁLENO NA PLÁTNĚ - Čistá, zářivá prémiová zelená
                borderStyle = "border: 2px solid #10b981; background: #064e3b; box-shadow: 0 0 15px rgba(16, 185, 129, 0.2);"; 
                statusBadge = `<span style="background:#d1fae5; color:#065f46; padding:4px 10px; border-radius:6px; font-size:0.7rem; font-weight:800; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">🟢 VYŠÍLÁ SE</span>`;
                imageOverlay = `
                    <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(16, 185, 129, 0.1); pointer-events: none;">
                        <span style="color: #10b981; font-weight: 900; font-size: 1rem; letter-spacing: 1px; text-transform: uppercase; background: #020617; padding: 6px 14px; border-radius: 8px; border: 1px solid #10b981; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">✅ NA PLÁTNĚ</span>
                    </div>
                `;
            } else if (currentStatus === "rejected") {
                // 🔴 ZAMÍTNUTO / SKRYTO - Zhasnutá šedá s červeným stopem
                borderStyle = "border: 2px solid #7f1d1d; background: #180505;"; 
                cardOpacity = "opacity: 0.55;";
                imageFilter = "filter: grayscale(90%) brightness(35%);";
                statusBadge = `<span style="background:#fee2e2; color:#991b1b; padding:4px 10px; border-radius:6px; font-size:0.7rem; font-weight:800; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">🔴 SKRYTO</span>`;
                imageOverlay = `
                    <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(127, 29, 29, 0.2); pointer-events: none;">
                        <span style="color: #ef4444; font-weight: 900; font-size: 1rem; letter-spacing: 2px; text-transform: uppercase; background: #000; padding: 6px 14px; border-radius: 8px; border: 1px solid #ef4444; box-shadow: 0 4px 12px rgba(0,0,0,0.7);">⛔ ZAMÍTNUTO</span>
                    </div>
                `;
            }

            // Výpočet času doručení fotky
            let formattedTime = "Neznámý čas";
            if (photoData.createdAt) {
                const dateObj = photoData.createdAt.toDate ? photoData.createdAt.toDate() : new Date(photoData.createdAt);
                formattedTime = dateObj.toLocaleDateString("cs-CZ") + " v " + dateObj.toLocaleTimeString("cs-CZ", {hour: '2-digit', minute:'2-digit', second:'2-digit'});
            }

            // Sestavení a renderování upravené karty fotky
            const card = document.createElement("div");
            card.className = "photo-card-admin";
            card.style = `${borderStyle} ${cardOpacity} border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.4); transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);`;
            
            card.innerHTML = `
                <div style="position: relative; width: 100%; aspect-ratio: 1/1; background: #000; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    <img src="${photoData.imageUrl}" 
                         loading="lazy" 
                         decoding="async" 
                         style="width:100%; height:100%; object-fit:cover; ${imageFilter} transition: all 0.25s ease;">
                    
                    <div style="position: absolute; top: 8px; left: 8px; z-index: 10;">
                        ${statusBadge}
                    </div>

                    ${imageOverlay}
                </div>

                <div style="padding: 10px; flex-grow: 1; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid rgba(255,255,255,0.05);">
                    <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 500;">⏱️ Doručeno: <span style="color:#cbd5e1; font-family: monospace;">${formattedTime}</span></div>
                    
                    <div>
                        <label style="font-size: 0.65rem; color: #94a3b8; display:block; margin-bottom: 3px; font-weight: 600;">👤 Přezdívka autora:</label>
                        <div style="display: flex; gap: 4px;">
                            <input type="text" id="nickInput-${pId}" value="${photoData.user || ''}" placeholder="Host" style="background:#020617; border:1px solid #334155; color:#fff; font-size:0.75rem; padding:5px 10px; border-radius:6px; flex-grow:1; font-weight: 600;">
                            <button onclick="window.updatePhotoNickname('${eventId}', '${pId}')" style="background:#1e293b; color:#38bdf8; border:1px solid #334155; padding:0 12px; border-radius:6px; font-size:0.7rem; font-weight:700; cursor:pointer; transition: all 0.2s;">Uložit</button>
                        </div>
                    </div>

                    <label style="display: flex; align-items: center; gap: 6px; color: #e2e8f0; font-size: 0.7rem; cursor: pointer; margin: 2px 0 5px 0; font-weight: 500;">
                        <input type="checkbox" id="hideNickCheck-${pId}" ${photoData.hideNickname === true ? 'checked' : ''} onchange="window.togglePhotoNicknameVisibility('${eventId}', '${pId}', this.checked)" style="width:13px; height:13px; accent-color:#38bdf8; cursor:pointer;"> Skrýt jméno u této fotky
                    </label>

                    <div style="display: flex; gap: 6px; margin-top: auto; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 12px;">
                        <button onclick="window.setPhotoStatus('${eventId}', '${pId}', 'approved')" style="background: #10b981; color: #fff; border: none; padding: 8px; border-radius: 6px; font-size: 0.75rem; font-weight:800; cursor: pointer; flex-grow: 1; display: ${currentStatus === 'approved' ? 'none' : 'block'}; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">✅ Schválit</button>
                        <button onclick="window.setPhotoStatus('${eventId}', '${pId}', 'rejected')" style="background: #ef4444; color: #fff; border: none; padding: 8px; border-radius: 6px; font-size: 0.75rem; font-weight:800; cursor: pointer; flex-grow: 1; display: ${currentStatus === 'rejected' ? 'none' : 'block'}; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">❌ Zamítnout</button>
                        <button onclick="window.setPhotoStatus('${eventId}', '${pId}', 'pending')" style="background: #1e293b; color: #e2e8f0; border: 1px solid #475569; padding: 8px; border-radius: 6px; font-size: 0.75rem; font-weight:800; cursor: pointer; flex-grow: 1; display: ${currentStatus === 'pending' ? 'none' : 'block'};">🔄 Obnovit</button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });

        // Aktualizujeme badge čítače v levém menu
        document.getElementById("modBadge").textContent = pendingCount;
    });
}

// --- 🛠️ 3. GLOBÁLNÍ FUNKCE PRO PŘEPÍNÁNÍ STAVŮ (ŽÁDNÉ MAZÁNÍ) ---
window.setPhotoStatus = async function(eventId, photoId, statusValue) {
    try {
        // Správný import / odkaz na firestore reference
        // Použijeme přímo importovanou db a funkce z Firebase SDK
        const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        
        const isApprovedBoolean = (statusValue === "approved");
        const photoRef = doc(db, "events", eventId, "social_wall", photoId);

        // Zapíšeme změnu natvrdo do cloudu
        await updateDoc(photoRef, { 
            status: statusValue,
            approved: isApprovedBoolean
        });
        
        console.log(`✅ Stav fotky ${photoId} úspěšně synchronizován do Firebase jako: ${statusValue}`);
    } catch (err) {
        console.error("❌ Kritická chyba při zápisu stavu do Firebase:", err);
        alert("Nepodařilo se uložit stav do databáze. Zkontroluj konzoli (F12).");
    }
};

// --- ✏️ 4. EXKLUZIVNÍ ÚPRAVA PŘEZDÍVKY (CENZURA SPORSTÝCH SLOV) ---
window.updatePhotoNickname = async function(eventId, photoId) {
    const inputEl = document.getElementById(`nickInput-${photoId}`);
    if (!inputEl) return;
    
    const newName = inputEl.value.trim();
    try {
        await updateDoc(doc(db, "events", eventId, "social_wall", photoId), {
            user: newName || "Host"
        });
        alert("Přezdívka byla úspěšně přepsána na: " + (newName || "Host"));
    } catch (err) {
        console.error("Chyba úpravy jména fotky:", err);
    }
};

// --- 👁️ 5. EXKLUZIVNÍ SCHOVÁNÍ JEDNOTLIVÉHO JMÉNA ---
window.togglePhotoNicknameVisibility = async function(eventId, photoId, shouldHide) {
    try {
        await updateDoc(doc(db, "events", eventId, "social_wall", photoId), {
            hideNickname: shouldHide
        });
        console.log(`Skrytí jména pro fotku ${photoId} nastaveno na: ${shouldHide}`);
    } catch (err) {
        console.error("Chyba nastavení anonymity fotky:", err);
    }
};
window.approvePhoto = async function(eId, pId) { await updateDoc(doc(db, "events", eId, "social_wall", pId), { approved: true }); }
window.rejectPhoto = async function(eId, pId) { if (confirm("Smazat fotku?")) await deleteDoc(doc(db, "events", eId, "social_wall", pId)); }
function generateQRCode(text) { document.getElementById("qrcode").innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(text)}"><br><a href="${text}" target="_blank">🔗 Otevřít odkaz</a>`; }