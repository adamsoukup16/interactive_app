import { db, auth } from "../shared/firebase-config.js";
import { 
    doc, 
    getDoc, 
    updateDoc, 
    increment 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// 1. Získání Event ID z URL adresy (?event=XYZ)
const urlParams = new URLSearchParams(window.location.search);
const eventId = urlParams.get('event');

if (!eventId) {
    document.body.innerHTML = `
        <div style="color:#f43f5e; text-align:center; padding:50px; font-family:sans-serif;">
            <h1>❌ Neplatný QR kód</h1>
            <p style="color:#94a3b8; margin-top:10px;">V odkazu chybí unikátní identifikační číslo zápasu.</p>
        </div>
    `;
} else {
    initClient();
}

async function initClient() {
    // 🔥 NASTARTOVÁNÍ DIGITÁLNÍHO 0-100% SPINNERU DO GAME ZONE
    const gameZoneEl = document.getElementById("gameZone");
    if (gameZoneEl) {
        gameZoneEl.innerHTML = `
            <div id="globalPreloader" style="text-align:center; padding:60px 20px; font-family:sans-serif; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:15px;">
                <div style="position:relative; width:80px; height:80px;">
                    <div style="box-sizing:border-box; width:80px; height:80px; border:6px solid rgba(255,255,255,0.1); border-top:6px solid #38bdf8; border-radius:50%; animation:globalSpin 1s linear infinite;"></div>
                    <div id="preloaderPercent" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:1.1rem; font-weight:800; font-family:monospace; color:#38bdf8;">0%</div>
                </div>
                <div style="font-size:0.9rem; color:#94a3b8; font-weight:600; letter-spacing:0.5px;" id="preloaderText">Připojování k serveru...</div>
                
                <style>
                    @keyframes globalSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
            </div>
        `;
    }

    const updateProgress = (percent, text) => {
        const pEl = document.getElementById("preloaderPercent");
        const tEl = document.getElementById("preloaderText");
        if (pEl) pEl.textContent = `${percent}%`;
        if (tEl) tEl.textContent = text;
    };

    try {
        // 2. Anonymní přihlášení
        updateProgress(20, "Ověřuji anonymní přístup...");
        await signInAnonymously(auth);
        console.log("👤 Uživatel byl úspěšně anonymně přihlášen.");

        const eventRef = doc(db, "events", eventId);
        
        // 3. Načtení dat z Firestore
        updateProgress(50, "Loading...");
        const eventSnap = await getDoc(eventRef);

        if (eventSnap.exists()) {
            const eventData = eventSnap.data();
            console.log("100%:", eventData);
            
            // 4. ZAPOČÍTÁNÍ PŘIPOJENÍ (+1)
            updateProgress(75, "Zapisuji návštěvu...");
            await updateDoc(eventRef, { scanCount: increment(1) });
            console.log("📈 Počítadlo připojení aktualizováno (+1).");

            const activeGame = eventData.activeGame || "social_watch";

            // 🔥 INTELIGENTNÍ FILTR PRO ROZDĚLENÍ DESIGNU (PEXESO vs SOCIAL WALL)
            const headerTitleBox = document.getElementById("eventTitle") ? document.getElementById("eventTitle").parentElement : null;
            
            if (activeGame === "pexeso") {
                // Pro pexeso kompletně schováme celý horní obalový panel s názvem "TEST"
                if (headerTitleBox) {
                    headerTitleBox.style.setProperty("display", "none", "important");
                }
                // Schováme i staré statusy, pokud v HTML nějaké zbyly
                const statusEl = document.getElementById("eventStatus");
                if (statusEl) statusEl.style.setProperty("display", "none", "important");
            } else {
                // Pro Social Wall nebo jiné moduly panel nahoře necháme bezpečně zapnutý
                if (headerTitleBox) {
                    headerTitleBox.style.setProperty("display", "block", "important");
                }
                const titleEl = document.getElementById("eventTitle");
                if (titleEl) titleEl.textContent = eventData.title;
                const statusEl = document.getElementById("eventStatus");
                if (statusEl) {
                    statusEl.style.setProperty("display", "block", "important");
                    statusEl.innerHTML = "";
                }
            }

            // 5. SPUŠTĚNÍ SAMOTNÉHO IMPORTU MODULU HRY
            updateProgress(90, "Spouštím herní zónu...");
            await loadGameModule(activeGame, eventId);

        } else {
            // Event neexistuje
            if (document.getElementById("eventTitle")) document.getElementById("eventTitle").textContent = "Zápas nenalezen 😢";
            if (document.getElementById("eventStatus")) document.getElementById("eventStatus").textContent = "Tento event už neexistuje.";
            if (gameZoneEl) gameZoneEl.innerHTML = "";
        }
    } catch (error) {
        console.error("❌ Chyba při inicializaci mobilního klienta:", error);
        const statusEl = document.getElementById("eventStatus");
        if (statusEl) statusEl.textContent = "🔴 Chyba připojení k Firebase.";
    }
}

async function loadGameModule(gameType, eventId) {
    try {
        console.log(`Načítám modul hry: ${gameType}...`);
        const modulePath = `../games/${gameType}/client.js`;
        const gameModule = await import(modulePath);
        
        // Spustíme hru a počkáme, až projdou i její vnitřní preloadingy obrázků (přibyl await)
        await gameModule.init(eventId);
        console.log(`✅ Modul ${gameType} byl úspěšně inicializován.`);
        
        // Teprve teď dáváme 100 % a preloader plynule mažeme
        const pEl = document.getElementById("preloaderPercent");
        if (pEl) pEl.textContent = "100%";
        
        const preloader = document.getElementById("globalPreloader");
        if (preloader) {
            // Malý trik: schováme ho bleskově až teď, kdy je pod ním vše stoprocentně vykreslené
            preloader.remove();
        }
        
    } catch (error) {
        console.error(`❌ Nelze načíst herní modul pro typ: ${gameType}`, error);
        const gameZoneEl = document.getElementById("gameZone");
        if (gameZoneEl) {
            gameZoneEl.innerHTML = `
                <div style="color:#f43f5e; padding: 20px; text-align:center; font-family:sans-serif;">
                    <p><strong>Chyba:</strong> Modul (${gameType}) selhal při spouštění.</p>
                </div>
            `;
        }
    }
}

// --- GLOBÁLNÍ FUNKCE PRO RESIZE FOTEK (Ponecháno netknuté pro Social Wall) ---
window.resizeAndCompressImage = function(file, maxWidth = 1200, maxHeight = 1200, quality = 0.75) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image(); img.src = event.target.result;
            img.onload = () => {
                let width = img.width; let height = img.height;
                if (width > height) { if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; } } 
                else { if (height > maxHeight) { width = Math.round((width * maxHeight) / height); height = maxHeight; } }
                const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) {
                        const resizedFile = new File([blob], file.name, { type: "image/jpeg", lastModified: Date.now() });
                        resolve(resizedFile);
                    } else { reject(new Error("Blob error")); }
                }, "image/jpeg", quality);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};