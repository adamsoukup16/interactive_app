import { db } from "../shared/firebase-config.js";
import { onSnapshot, query, orderBy, doc, collection } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const eventId = urlParams.get('event');

// Hlavní paměťové pooly pro rotaci
let allApprovedPhotos = []; 
let currentlyDisplayedPhotos = []; // Pole 8 objektů, které aktuálně vidíme na plátně
let rotationTimer = null;
let currentIntervalDuration = 5000; 

// Globální nastavení vzhledu z databáze
let showNicks = true;
let maskNicks = false;
let nickPos = "nick-bottom";
let nickColor = "#F1F5F9";
let nickBgColor = "#0F172A";
let activeConfig = null; // Uložená konfigurace pro real-time změny shadow/proužků

if (!eventId) {
    document.body.innerHTML = "<h1 style='color:white; text-align:center; padding-top:100px;'>❌ Chybí ID eventu v URL.</h1>";
} else {
    listenToEventConfiguration(eventId);
    listenToLivePhotos(eventId);
}

// --- 🧭 A) NASLOUCHÁNÍ GLOBÁLNÍ KONFIGURACE PLÁTNA ---
function listenToEventConfiguration(eventId) {
    onSnapshot(doc(db, "events", eventId), (docSnap) => {
        if (!docSnap.exists()) return;
        const config = docSnap.data();
        activeConfig = config; // Uložíme do globální paměti

        // 1. Detekce a vykreslení pozadí plátna
        if (config.bgUrl) {
            document.body.style.backgroundImage = `url('${config.bgUrl}')`;
            document.body.style.backgroundSize = "cover";
            document.body.style.backgroundPosition = "center";
        } else {
            document.body.style.backgroundImage = "none";
            document.body.style.backgroundColor = config.bgColor || "#05070f";
        }

        // 2. Detekce horní lišty a nezávislého nadpisu wallTitle
        const headerEl = document.getElementById("wallHeader");
        if (headerEl) headerEl.style.display = config.showHeaders !== false ? "flex" : "none";
        if (document.getElementById("wallBrandName")) {
            document.getElementById("wallBrandName").textContent = config.wallTitle || config.title || "ŽIVÁ FOTOSTĚNA";
        }
        if (document.querySelector(".instructions") && config.subtitleText) {
            document.querySelector(".instructions").textContent = config.subtitleText;
        }

        // 3. Parametry přezdívek
        showNicks = config.showNicknames !== false;
        maskNicks = config.maskNicknames === true;
        nickPos = config.nickPosition || "nick-bottom";
        nickColor = config.nickColor || "#F1F5F9";
        nickBgColor = config.nickBgColor || "#0F172A";

        // 4. Inteligentní středová zóna (Prohazování pozic, skrývání, centrování)
        const qrZone = document.getElementById("wallLiveQr");
        const logoZone = document.getElementById("wallLiveLogoContainer");
        const logoImg = document.getElementById("clientLogo");
        const wallCenterZone = document.getElementById("wallCenterZone");
        const showQr = config.showWallQr !== false;

        if (qrZone && logoZone && logoImg && wallCenterZone) {
            const hasLogo = !!config.logoUrl;
            
            if (hasLogo) { 
                logoImg.src = config.logoUrl; 
                logoImg.style.display = "block"; 
                logoZone.style.display = "flex"; 
            } else { 
                logoZone.style.display = "none"; 
                logoImg.style.display = "none"; 
            }

            if (config.qrPosition !== "qr-none" && showQr) {
                qrZone.style.display = "flex";
                if (qrZone.innerHTML === "") {
                    const currentUrl = window.location.origin;
                    qrZone.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(currentUrl + '/public/index.html?event=' + eventId)}" alt="QR">`;
                }
            } else { qrZone.style.display = "none"; }

            // 🔥 ÚPRAVA: Centrování, pokud chybí logo nebo je vypnutý QR
            if (!hasLogo || config.qrPosition === "qr-none" || !showQr) {
                wallCenterZone.style.justifyContent = "center";
            } else {
                wallCenterZone.style.justifyContent = "space-between";
                if (config.logoPosition === "pos-left" || config.qrPosition === "qr-right") { 
                    logoZone.style.order = "1"; qrZone.style.order = "2"; 
                } else { 
                    logoZone.style.order = "2"; qrZone.style.order = "1"; 
                }
            }
        }

        // 5. Styl středového branding panelu
        if (wallCenterZone) {
            if (config.showCenterBg !== false) {
                wallCenterZone.style.backgroundColor = config.centerBgColor || "#000000";
                wallCenterZone.style.border = "2px solid #1e293b";
            } else {
                wallCenterZone.style.backgroundColor = "transparent";
                wallCenterZone.style.border = "none";
            }
        }

        // 6. 🔥 NEPRŮSTŘELNÝ RESTART ČASOVAČE
        const newIntervalMs = (config.rotationInterval || 5) * 1000;
        if (newIntervalMs !== currentIntervalDuration) {
            currentIntervalDuration = newIntervalMs;
            restartRotationEngine();
        }

        // Real-time update vizuálu u běžících karet bez promazání obsahu
        applyLiveStyleUpdates();
    });
}

// --- 📸 B) NASLOUCHÁNÍ SCHVÁLENÝCH FOTEK (POOL S INTELIGENTNÍ DUPLIKACÍ) ---
// --- 📸 B) NASLOUCHÁNÍ SCHVÁLENÝCH FOTEK (S OKAMŽITÝM VYHAZOVEM PŘI ZAMÍTNUTÍ) ---
function listenToLivePhotos(eventId) {
    onSnapshot(query(collection(db, "events", eventId, "social_wall"), orderBy("createdAt", "desc")), (snapshot) => {
        const newApprovedPool = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const isApproved = data.status === "approved" || data.approved === true;
            if (isApproved) {
                allApprovedPhotos.push({ id: docSnap.id, ...data });
                newApprovedPool.push({ id: docSnap.id, ...data });
            }
        });

        // 🌟 PRIORITIZACE NOVINEK: Nově schválené fotky hodíme na začátek fronty
        newApprovedPool.forEach(newPhoto => {
            const exists = allApprovedPhotos.some(p => p.id === newPhoto.id);
            if (!exists) {
                allApprovedPhotos.unshift(newPhoto);
            }
        });

        // Vyčištění paměti: Ponecháme pouze ty, které jsou stále v databázi schválené
        allApprovedPhotos = allApprovedPhotos.filter(p => newApprovedPool.some(np => np.id === p.id));

        // 🔥 KLÍČOVÁ PODMÍNKA: Pokud moderátor právě v adminu ZAMÍTL fotku, která zrovna VISÍ na plátně,
        // musíme ji okamžitě najít a vyhodit ze slotu, aniž bychom čekali na tiknutí časovače!
        currentlyDisplayedPhotos.forEach((visiblePhoto, slotIndex) => {
            if (visiblePhoto) {
                const isStillApproved = allApprovedPhotos.some(p => p.id === visiblePhoto.id);
                
                // Pokud už fotka není v poolu schválených, okamžitě ji na plátně nahradíme
                if (!isStillApproved) {
                    console.log(`⚠️ Fotka ${visiblePhoto.id} byla zamítnuta moderátorem. Odstraňuji ze slotu ${slotIndex}.`);
                    
                    if (allApprovedPhotos.length > 0) {
                        // Vybereme náhodnou jinou schválenou fotku
                        const replacementPhoto = allApprovedPhotos[Math.floor(Math.random() * allApprovedPhotos.length)];
                        currentlyDisplayedPhotos[slotIndex] = replacementPhoto;

                        // Plynulá blesková animace výměny přímo na plátně
                        const cardToFix = document.querySelector(`[data-slot-index="${slotIndex}"]`);
                        if (cardToFix) {
                            cardToFix.style.opacity = "0";
                            setTimeout(() => {
                                const finalName = maskNicks ? (replacementPhoto.user ? replacementPhoto.user.charAt(0) + "***" : "H***") : (replacementPhoto.user || "Host");
                                const img = cardToFix.querySelector("img");
                                if (img) img.src = replacementPhoto.imageUrl;
                                const badge = cardToFix.querySelector(".user-badge");
                                if (badge) badge.textContent = `👤 ${finalName}`;
                                
                                cardToFix.style.opacity = "1";
                            }, 300); // Rychlejší prolnutí pro nouzový vyhazov
                        }
                    } else {
                        // Pokud nezbyla v databázi vůbec žádná schválená fotka, slot prostě skryjeme
                        currentlyDisplayedPhotos[slotIndex] = null;
                        const cardToHide = document.querySelector(`[data-slot-index="${slotIndex}"]`);
                        if (cardToHide) cardToHide.style.opacity = "0";
                    }
                }
            }
        });

        // Úvodní vykreslení mřížky při úplně prvním startu
        if (currentlyDisplayedPhotos.length === 0 && allApprovedPhotos.length > 0) {
            buildInitialSlots();
            renderInitialGrid();
            restartRotationEngine();
        }
    });
}

// Vygeneruje fixní pole 8 pozic a inteligentně do nich nasype fotky (i duplikovaně, pokud jich je málo)
function buildInitialSlots() {
    currentlyDisplayedPhotos = [];
    for (let i = 0; i < 8; i++) {
        if (allApprovedPhotos[i]) {
            currentlyDisplayedPhotos.push(allApprovedPhotos[i]);
        } else if (allApprovedPhotos.length > 0) {
            // Fallback při nedostatku: toč dokola to, co je dostupné
            currentlyDisplayedPhotos.push(allApprovedPhotos[i % allApprovedPhotos.length]);
        }
    }
}

// Postaví domovskou kostru mřížky (Spustí se pouze jednou na začátku!)
function renderInitialGrid() {
    const grid = document.getElementById("wallGrid");
    const centerZone = document.getElementById("wallCenterZone");
    if (!grid) return;

    // Kompletně vyčistíme staré karty před prvním sestavením
    document.querySelectorAll(".wall-card").forEach(el => el.remove());

    // Prvních 4 slotů (před středový panel)
    for (let i = 0; i < 4; i++) {
        const photo = currentlyDisplayedPhotos[i]; if (!photo) continue;
        const card = createPhotoCardElement(photo, i);
        grid.insertBefore(card, centerZone);
    }
    // Zbylých 4 slotů (za středový panel)
    for (let i = 4; i < 8; i++) {
        const photo = currentlyDisplayedPhotos[i]; if (!photo) continue;
        const card = createPhotoCardElement(photo, i);
        grid.appendChild(card);
    }
}

// Vytvoří čistý HTML element karty s aktuální barvou proužku z paměti
function createPhotoCardElement(photo, index) {
    const card = document.createElement("div");
    const finalName = maskNicks ? (photo.user ? photo.user.charAt(0) + "***" : "H***") : (photo.user || "Host");
    
    card.className = `wall-card ${nickPos}`;
    card.setAttribute("data-slot-index", index);
    
    if (activeConfig && activeConfig.showShadows === true) {
        const sColor = activeConfig.shadowColor || "#38bdf8";
        card.style.boxShadow = `0 0 20px ${sColor}`;
        card.style.borderColor = sColor;
    }

    // 🔥 PŘESNÁ PODMÍNKA: Pokud je zapnuté skrytí jména, display je natvrdo 'none'
    const isAnonymized = photo.hideNickname === true;
    const shouldShowFooter = showNicks && !isAnonymized;
    const footerHtml = `<div class="wall-footer" style="background-color: ${nickBgColor}; ${shouldShowFooter ? '' : 'display:none;'}"><span class="user-badge" style="color:${nickColor};">👤 ${finalName}</span></div>`;
    
    card.innerHTML = `
        ${nickPos === 'nick-top' ? footerHtml : ''}
        <div class="square-image-container"><img src="${photo.imageUrl}"></div>
        ${nickPos === 'nick-bottom' ? footerHtml : ''}
    `;
    return card;
}

// Rychlý real-time update stylů bez nutnosti překreslovat fotky (při změně barev v adminu)
function applyLiveStyleUpdates() {
    document.querySelectorAll(".wall-card").forEach(card => {
        card.className = `wall-card ${nickPos}`;
        
        if (activeConfig && activeConfig.showShadows === true) {
            const sColor = activeConfig.shadowColor || "#38bdf8";
            card.style.boxShadow = `0 0 20px ${sColor}`;
            card.style.borderColor = sColor;
        } else {
            card.style.boxShadow = "none";
            card.style.borderColor = "#1e293b";
        }

        const footer = card.querySelector(".wall-footer");
        if (footer) {
            footer.style.display = showNicks ? "block" : "none";
            footer.style.backgroundColor = nickBgColor;
            
            const badge = footer.querySelector(".user-badge");
            if (badge) badge.style.color = nickColor;
        }
    });
}

// --- ⚙️ NOVÁ GLOBÁLNÍ HISTORIE PROUTÉKANÝCH SLOTŮ (Přidej klidně pod ostatní let proměnné nahoře) ---
let recentSlotsQueue = []; 

// --- 🔄 C) NEKONEČNÝ ROTAČNÍ MOTOR (S OCHRANOU PROTI OPAKOVÁNÍ SLOTŮ A POMALÝM FADEM) ---
function restartRotationEngine() {
    if (rotationTimer) clearInterval(rotationTimer);
    if (allApprovedPhotos.length === 0) return;

    rotationTimer = setInterval(() => {
        if (allApprovedPhotos.length === 0) return;

        // 1. Vybereme náhodný slot na plátně (s ochranou, aby to nebyl ten samý jako minule)
        let slotToReplaceIndex = Math.floor(Math.random() * 8);
        let slotAttempts = 0;
        while (recentSlotsQueue.includes(slotToReplaceIndex) && slotAttempts < 30) {
            slotToReplaceIndex = Math.floor(Math.random() * 8);
            slotAttempts++;
        }
        recentSlotsQueue.push(slotToReplaceIndex);
        if (recentSlotsQueue.length > 4) recentSlotsQueue.shift();

        // 2. 🔥 FILTROVÁNÍ DUPLIKÁTŮ A SPRAVEDLIVÝ VÝBĚR Z FRONTY
        let nextPhoto = null;
        let photoIndexInPool = 0;

        // Máme dostatek fotek na to, abychom zaručili unikalitu na plátně? (Potřebujeme aspoň víc než 8 fotek celkem)
        const totalUniquePhotos = allApprovedPhotos.length;
        
        if (totalUniquePhotos > 8) {
            // Procházíme balíček odshora dolů a hledáme první fotku, která ZROVNA NEVISÍ v žádném jiném slotu
            for (let i = 0; i < allApprovedPhotos.length; i++) {
                const candidate = allApprovedPhotos[i];
                const isAlreadyVisible = currentlyDisplayedPhotos.some(p => p && p.id === candidate.id);
                
                if (!isAlreadyVisible) {
                    nextPhoto = candidate;
                    photoIndexInPool = i;
                    break;
                }
            }
        }

        // Fallback: Pokud je fotek extrémně málo (pod 8) nebo filtr nenašel vhodnou, vezmeme prostě první z vrchu balíčku
        if (!nextPhoto) {
            nextPhoto = allApprovedPhotos[0];
            photoIndexInPool = 0;
        }

        if (!nextPhoto) return; // Pojistka proti prázdné databázi

        // 3. 🔥 ROTACE BALÍČKU (Round-Robin): 
        // Vybranou fotku vyjmeme z vrchu fronty a ta stará fotka, která opouští plátno, se zařadí na úplný konec!
        allApprovedPhotos.splice(photoIndexInPool, 1); // Vyjmout
        const oldPhotoOfSlot = currentlyDisplayedPhotos[slotToReplaceIndex];
        if (oldPhotoOfSlot) {
            allApprovedPhotos.push(oldPhotoOfSlot); // Stará fotka skočí na konec fronty a počká si, až na ni zase přijde řada
        }

        // Aktualizujeme registr aktuálně zobrazených fotek
        currentlyDisplayedPhotos[slotToReplaceIndex] = nextPhoto;

        // 4. Spuštění plynulého filmového transitionu (1.2s fade)
        const cardToAnimate = document.querySelector(`[data-slot-index="${slotToReplaceIndex}"]`);
        if (cardToAnimate) {
            cardToAnimate.style.opacity = "0";
            cardToAnimate.style.transform = "scale(0.95)";
            
            setTimeout(() => {
                const isAnonymized = nextPhoto.hideNickname === true;
                const finalName = maskNicks ? (nextPhoto.user ? nextPhoto.user.charAt(0) + "***" : "H***") : (nextPhoto.user || "Host");
                
                const img = cardToAnimate.querySelector("img");
                if (img) img.src = nextPhoto.imageUrl;
                
                // 🔥 PŘESNÁ PODMÍNKA PRO ROTACI: Schová/ukáže proužek real-time při výměně fotky
                const footer = cardToAnimate.querySelector(".wall-footer");
                if (footer) {
                    footer.style.display = (showNicks && !isAnonymized) ? "block" : "none";
                    const badge = footer.querySelector(".user-badge");
                    if (badge) badge.textContent = `👤 ${finalName}`;
                }

                cardToAnimate.style.opacity = "1";
                cardToAnimate.style.transform = "scale(1)";
            }, 1100); // lícování s CSS transition 1.2s
        }
    }, currentIntervalDuration);
}