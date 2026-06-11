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
        // 1. Výpočet základní URL adresy projektu (pro lokál i GitHub)
        // 1. Výpočet základní URL adresy projektu (pro lokál i GitHub)
        const pathSegments = window.location.pathname.split('/');
        const adminIndex = pathSegments.indexOf('admin');
        const repoPath = adminIndex > 0 ? pathSegments.slice(0, adminIndex).join('/') : '';
        const projectBaseUrl = `${window.location.origin}${repoPath}`;

        // 2. 🔥 DEFINICE VŠECH CEST (Oprava smazaných proměnných)
        const publicUrl = `${projectBaseUrl}/public/index.html?event=${id}`;
        const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(publicUrl)}`;
        const scans = event.scanCount || 0;

        // Výběr správné složky pro plátno podle aktivní hry
        let wallUrl = `${projectBaseUrl}/wall/index.html?event=${id}`;
        if (event.activeGame === "pexeso") {
            wallUrl = `${projectBaseUrl}/wall_pexeso/index.html?event=${id}`;
        }

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













// =========================================================================
// 🧩 MODUL: DIGITÁLNÍ PEXESO (100% ODDĚLENÁ HRA)
// =========================================================================

window.openPexesoControl = async function(eventId, eventTitle) {
    // 1. Nastavení textů v hlavní hlavičce CorePanelu
    document.getElementById("pageTitle").textContent = `Pexeso: ${eventTitle}`;
    document.getElementById("pageSubtitle").textContent = "Správa herního turnaje, nastavení e-mailů a výsledky diváků";

    const container = document.getElementById("pendingPhotos");
    if (!container) return;

    // 🔥 NEPRŮSTŘELNÝ FIX SKRÝVÁNÍ:
    // Najdeme ten otravný vnitřní header fotostěny, který je přímo v zóně moderování a schováme ho
    const moderationZone = document.getElementById("moderationZone");
    if (moderationZone) {
        moderationZone.style.background = "transparent"; // Odstraníme tmavé pozadí z fotostěny, ať pexeso sedí čistě
        moderationZone.style.border = "none";
        moderationZone.style.padding = "0";

        // Vyhledáme první vnitřní div (to bývá ta lišta s LIVE MODERACE a vysvětlivkami) a schováme je
        const badHeader = moderationZone.querySelector("div");
        if (badHeader) badHeader.style.display = "none";
        
        const badParagraph = moderationZone.querySelector(".subtitle-desc") || moderationZone.querySelector("p");
        if (badParagraph) badParagraph.style.display = "none";
    }

    // Vynutíme, aby náš pexeso kontejner byl stoprocentně vidět hned nahoře!
    container.style.display = "block";
    container.style.width = "100%";
    container.style.maxWidth = "1100px";
    container.style.margin = "0 auto";
    container.style.opacity = "1"; // Pojistka proti skrytí
    
    // Vygenerujeme čisté herní manažerské prostředí
    container.innerHTML = `
        <div class="pexeso-manager-panel" style="background: #020617; padding: 25px; border-radius: 16px; border: 1px solid #1e293b; color: #fff; font-family: sans-serif;">
            
            <div style="background: #0f172a; padding: 20px; border-radius: 12px; border: 1px solid #1e293b; margin-bottom: 25px;">
                <h3 style="margin: 0 0 5px 0; color: #38bdf8; font-size: 1.1rem;">Nastavení turnaje</h3>
                <p style="margin: 0 0 15px 0; font-size: 0.8rem; color: #94a3b8;">Ovlivňuje chování hry na mobilech diváků.</p>
                
                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-weight: 600; font-size: 0.95rem;">
                    <input type="checkbox" id="chkRequireEmail" style="width: 18px; height: 18px; cursor: pointer;">
                    Vyžadovat e-mail před spuštěním hry
                </label>
            </div>

            <div style="background: #0f172a; padding: 20px; border-radius: 12px; border: 1px solid #1e293b;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #1e293b; padding-bottom: 10px;">
                    <h3 style="margin: 0; font-size: 1.1rem; color: #a78bfa;">🏆 Průběžný žebříček turnaje (TOP 20)</h3>
                    <span style="font-size: 0.75rem; background: #1e293b; padding: 4px 10px; border-radius: 20px; color: #94a3b8; font-weight: 600;">Real-time synchronizace</span>
                </div>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                        <thead>
                            <tr style="border-bottom: 2px solid #1e293b; color: #94a3b8; font-weight: 700; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px;">
                                <th style="padding: 10px;">Pořadí</th>
                                <th style="padding: 10px;">Přezdívka</th>
                                <th style="padding: 10px;">E-mail</th>
                                <th style="padding: 10px; text-align: right;">Výsledný čas</th>
                                <th style="padding: 10px; text-align: right;">Otočení</th>
                                <th style="padding: 10px; text-align: center;">Akce</th>
                            </tr>
                        </thead>
                        <tbody id="pexesoLeaderboardRows">
                            <tr><td colspan="6" style="padding: 20px; text-align: center; color: #64748b;">Načítám výsledky z databáze...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    `;

    // Přepnutí záložky
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    document.getElementById("moderation-tab").classList.add("active");

    // Načtení stavu checkboxu z Firebase
    const checkbox = document.getElementById("chkRequireEmail");
    try {
        const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const eventSnap = await getDoc(doc(db, "events", eventId));
        if (eventSnap.exists()) {
            const eventData = eventSnap.data();
            if (eventData.pexesoSettings && checkbox) {
                checkbox.checked = eventData.pexesoSettings.requireEmail === true;
            }
        }
    } catch (e) { console.error(e); }

    if (checkbox) {
        checkbox.addEventListener("change", async (e) => {
            const { updateDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            await updateDoc(doc(db, "events", eventId), {
                "pexesoSettings.requireEmail": e.target.checked
            });
        });
    }

    // LIVE SLEDOVÁNÍ TURNAJE
    if (window.unsubscribePexesoLeaderboard) window.unsubscribePexesoLeaderboard();

    const { query, collection, orderBy, onSnapshot } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    const leaderboardQuery = query(collection(db, "events", eventId, "pexeso_leaderboard"), orderBy("time", "asc"));

    window.unsubscribePexesoLeaderboard = onSnapshot(leaderboardQuery, (snapshot) => {
        const tbody = document.getElementById("pexesoLeaderboardRows");
        if (!tbody) return;

        tbody.innerHTML = "";
        let position = 0;

        if (snapshot.empty) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 30px; font-style: italic;">Zatím nikdo nedokončil hru. Buďte první!</td></tr>`;
            return;
        }

        snapshot.forEach((docSnap) => {
            position++;
            if (position > 20) return;

            const score = docSnap.data();
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid #1e293b";
            tr.style.background = position <= 3 ? "rgba(236, 72, 153, 0.03)" : "transparent";

            let medal = `${position}.`;
            if (position === 1) medal = "🥇 1.";
            if (position === 2) medal = "🥈 2.";
            if (position === 3) medal = "🥉 3.";

            tr.innerHTML = `
                <td style="padding: 12px; font-weight: 700; color: ${position <= 3 ? '#ec4899' : '#94a3b8'};">${medal}</td>
                <td style="padding: 12px; font-weight: 600; color: #fff;">${score.user}</td>
                <td style="padding: 12px; color: #64748b;">${score.email || "---"}</td>
                <td style="padding: 12px; font-weight: 700; color: #38bdf8; font-family: monospace; font-size: 0.95rem; text-align: right;">${score.time.toFixed(2)}s</td>
                <td style="padding: 12px; color: #94a3b8; text-align: right;">${score.clicks || "---"}x</td>
                <td style="padding: 12px; text-align: center;">
                    <button onclick="window.deletePexesoScore('${eventId}', '${docSnap.id}')" style="background: transparent; border: none; color: #ef4444; cursor: pointer; font-size: 1rem; padding: 2px 8px;" title="Smazat výsledek">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
};

window.deletePexesoScore = async function(eventId, scoreId) {
    if (confirm("Chcete tento výsledek trvale smazat ze žebříčku?")) {
        try {
            const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            await deleteDoc(doc(db, "events", eventId, "pexeso_leaderboard", scoreId));
        } catch (e) { console.error(e); }
    }
};

// =========================================================================
// 🃏 PEXESO: SPRÁVA BALÍČKU KARET (RUB A 10 DVOJIC)
// =========================================================================

window.openPexesoDeck = async function(eventId, eventTitle) {
    document.getElementById("pageTitle").textContent = `Balíček karet: ${eventTitle}`;
    document.getElementById("pageSubtitle").textContent = "Nahrávání rubu (zadní strany) a 10 unikátních obrázků pro dvojice kartiček";

    const container = document.getElementById("pendingPhotos");
    if (!container) return;

    // 🔥 NEPRŮSTŘELNÝ FIX SKRÝVÁNÍ PRO BALÍČEK:
    const moderationZone = document.getElementById("moderationZone");
    if (moderationZone) {
        moderationZone.style.background = "transparent";
        moderationZone.style.border = "none";
        moderationZone.style.padding = "0";

        const badHeader = moderationZone.querySelector("div");
        if (badHeader) badHeader.style.display = "none";
        
        const badParagraph = moderationZone.querySelector(".subtitle-desc") || moderationZone.querySelector("p");
        if (badParagraph) badParagraph.style.display = "none";
    }

    container.style.display = "block";
    container.style.width = "100%";
    container.style.maxWidth = "900px";
    container.style.margin = "0 auto";
    container.style.opacity = "1";

    container.innerHTML = `
        <div class="pexeso-deck-panel" style="background: #020617; padding: 25px; border-radius: 16px; border: 1px solid #1e293b; color: #fff; font-family: sans-serif; margin-top: 20px;">
            
            <div style="margin-bottom: 25px; border-bottom: 1px solid #1e293b; padding-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0 0 5px 0; font-size: 1.2rem; color: #38bdf8;">Konfigurace balíčku (Mřížka 4x5)</h3>
                    <p style="margin: 0; font-size: 0.8rem; color: #94a3b8;">Nahrajte celkem 11 obrázků. Systém z nich automaticky vygeneruje dvojice.</p>
                </div>
                <button id="btnSavePexesoDeck" style="background: #ec4899; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 0.9rem; cursor: pointer; box-shadow: 0 4px 14px rgba(236, 72, 153, 0.3); transition: all 0.2s;">💾 Uložit balíček karet</button>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 2.5fr; gap: 25px;">
                
                <div style="background: #0f172a; padding: 15px; border-radius: 12px; border: 1px solid #1e293b; text-align: center; display: flex; flex-direction: column; justify-content: space-between; height: 260px;">
                    <span style="font-size: 0.8rem; color: #ec4899; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">ZADNÍ STRANA (RUB)</span>
                    <div style="width: 120px; height: 150px; background: #020617; border: 2px dashed #334155; border-radius: 8px; margin: 10px auto; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative;">
                        <img id="prev-pexeso-back" src="" style="width: 100%; height: 100%; object-fit: cover; display: none;">
                        <span id="label-pexeso-back" style="font-size: 0.7rem; color: #64748b;">Nahrát rub</span>
                    </div>
                    <input type="file" id="file-pexeso-back" accept="image/*" style="display: none;">
                    <button onclick="document.getElementById('file-pexeso-back').click()" style="background: #1e293b; color: #fff; border: none; padding: 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; width: 100%;">Vybrat obrázek</button>
                </div>

                <div style="background: #0f172a; padding: 20px; border-radius: 12px; border: 1px solid #1e293b;">
                    <span style="font-size: 0.8rem; color: #38bdf8; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; display: block; margin-bottom: 15px;">OBRÁZKY DVOJIC (LÍC - 10 KARTIČEK)</span>
                    
                    <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;">
                        ${Array.from({ length: 10 }).map((_, i) => `
                            <div style="text-align: center; background: #020617; padding: 8px; border-radius: 8px; border: 1px solid #1e293b;">
                                <span style="font-size: 0.65rem; color: #64748b; display: block; margin-bottom: 4px;">Karta ${i + 1}</span>
                                <div style="width: 100%; aspect-ratio: 1/1; background: #090d16; border: 1px dashed #334155; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 6px;">
                                    <img id="prev-pexeso-front-${i}" src="" style="width: 100%; height: 100%; object-fit: cover; display: none;">
                                    <span id="label-pexeso-front-${i}" style="font-size: 1.2rem;">🖼️</span>
                                </div>
                                <input type="file" id="file-pexeso-front-${i}" accept="image/*" style="display: none;" class="pexeso-front-input" data-card-index="${i}">
                                <button onclick="document.getElementById('file-pexeso-front-${i}').click()" style="background: #1e293b; color: #94a3b8; border: none; padding: 4px; border-radius: 4px; font-size: 0.65rem; cursor: pointer; width: 100%;">Nahrát</button>
                            </div>
                        `).join('')}
                    </div>
                </div>

            </div>
        </div>
    `;

    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    document.getElementById("moderation-tab").classList.add("active");

    let localFiles = { back: null, fronts: Array(10).fill(null) };
    let remoteUrls = { back: "", fronts: Array(10).fill("") };

    document.getElementById("file-pexeso-back").addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            localFiles.back = e.target.files[0];
            document.getElementById("prev-pexeso-back").src = URL.createObjectURL(localFiles.back);
            document.getElementById("prev-pexeso-back").style.display = "block";
            document.getElementById("label-pexeso-back").style.display = "none";
        }
    });

    document.querySelectorAll(".pexeso-front-input").forEach(input => {
        input.addEventListener("change", (e) => {
            const index = parseInt(input.dataset.cardIndex);
            if (e.target.files && e.target.files[0]) {
                localFiles.fronts[index] = e.target.files[0];
                document.getElementById(`prev-pexeso-front-${index}`).src = URL.createObjectURL(localFiles.fronts[index]);
                document.getElementById(`prev-pexeso-front-${index}`).style.display = "block";
                document.getElementById(`label-pexeso-front-${index}`).style.display = "none";
            }
        });
    });

    try {
        const { getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const eventSnap = await getDoc(doc(db, "events", eventId));
        if (eventSnap.exists()) {
            const eventData = eventSnap.data();
            if (eventData.pexesoSettings) {
                const settings = eventData.pexesoSettings;
                if (settings.backOfCardUrl) {
                    remoteUrls.back = settings.backOfCardUrl;
                    document.getElementById("prev-pexeso-back").src = settings.backOfCardUrl;
                    document.getElementById("prev-pexeso-back").style.display = "block";
                    document.getElementById("label-pexeso-back").style.display = "none";
                }
                if (settings.frontImages && Array.isArray(settings.frontImages)) {
                    settings.frontImages.forEach((url, i) => {
                        if (url && i < 10) {
                            remoteUrls.fronts[i] = url;
                            document.getElementById(`prev-pexeso-front-${i}`).src = url;
                            document.getElementById(`prev-pexeso-front-${i}`).style.display = "block";
                            document.getElementById(`label-pexeso-front-${i}`).style.display = "none";
                        }
                    });
                }
            }
        }
    } catch (e) { console.error("Chyba při načítání balíčku:", e); }

    document.getElementById("btnSavePexesoDeck").addEventListener("click", async () => {
        const btn = document.getElementById("btnSavePexesoDeck");
        btn.textContent = "⏳ Optimalizace a nahrávání...";
        btn.disabled = true;

        try {
            const { ref, uploadBytes, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js");
            const { updateDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

            const compressEngine = async function(file) {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = (ev) => {
                        const img = new Image();
                        img.src = ev.target.result;
                        img.onload = () => {
                            const canvas = document.createElement("canvas");
                            canvas.width = 500; canvas.height = 500;
                            const ctx = canvas.getContext("2d");
                            const size = Math.min(img.width, img.height);
                            const sx = (img.width - size) / 2; const sy = (img.height - size) / 2;
                            ctx.drawImage(img, sx, sy, size, size, 0, 0, 500, 500);
                            canvas.toBlob((blob) => {
                                resolve(new File([blob], file.name, { type: "image/jpeg" }));
                            }, "image/jpeg", 0.80);
                        };
                    };
                });
            };

            if (localFiles.back) {
                const optimizedBack = await compressEngine(localFiles.back);
                const ext = optimizedBack.name.split('.').pop();
                const snap = await uploadBytes(ref(storage, `pexeso/${eventId}/back_${Date.now()}.${ext}`), optimizedBack);
                remoteUrls.back = await getDownloadURL(snap.ref);
            }

            for (let i = 0; i < 10; i++) {
                if (localFiles.fronts[i]) {
                    const optimizedFront = await compressEngine(localFiles.fronts[i]);
                    const ext = optimizedFront.name.split('.').pop();
                    const snap = await uploadBytes(ref(storage, `pexeso/${eventId}/card_${i}_${Date.now()}.${ext}`), optimizedFront);
                    remoteUrls.fronts[i] = await getDownloadURL(snap.ref);
                }
            }

            await updateDoc(doc(db, "events", eventId), {
                "pexesoSettings.backOfCardUrl": remoteUrls.back,
                "pexesoSettings.frontImages": remoteUrls.fronts
            });

            alert("🎉 Balíček byl bleskově zkomprimován na 500x500px a úspěšně uložen!");
            window.filterEventsByModule('pexeso');

        } catch (err) {
            console.error(err);
            alert("Chyba při nahrávání balíčku: " + err.message);
        } finally {
            btn.textContent = "💾 Uložit balíček karet";
            btn.disabled = false;
        }
    });
};