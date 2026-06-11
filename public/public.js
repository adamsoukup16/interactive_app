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
    // Pokud v odkazu chybí ID zápasu, zobrazíme uživateli chybu
    document.body.innerHTML = `
        <div style="color:#f43f5e; text-align:center; padding:50px; font-family:sans-serif;">
            <h1>❌ Neplatný QR kód</h1>
            <p style="color:#94a3b8; margin-top:10px;">V odkazu chybí unikátní identifikační číslo zápasu.</p>
        </div>
    `;
} else {
    // Pokud ID máme, nastartujeme klientskou zónu
    initClient();
}

async function initClient() {
    try {
        // 2. Anonymní přihlášení uživatele ve Firebase (nutné pro bezpečné nahrávání fotek a zápis bodů)
        await signInAnonymously(auth);
        console.log("👤 Uživatel byl úspěšně anonymně přihlášen.");

        // Definice odkazu na konkrétní dokument eventu v databázi
        const eventRef = doc(db, "events", eventId);
        
        // 3. Načtení aktuálních dat o eventu z Firestore
        const eventSnap = await getDoc(eventRef);

        if (eventSnap.exists()) {
            const eventData = eventSnap.data();
            console.log("📄 Data eventu úspěšně načtena:", eventData);
            
            // 4. ZAPOČÍTÁNÍ PŘIPOJENÍ: Přičteme +1 k počtu naskenování pro admin tabulku
            await updateDoc(eventRef, {
                scanCount: increment(1)
            });
            console.log("📈 Počítadlo připojení aktualizováno (+1).");

            // Nahoře v hlavičce mobilní stránky necháme POUZE čisté jméno eventu
            document.getElementById("eventTitle").textContent = eventData.title;
            
            // 🔥 FIX: Odstraněno "🟢 Jste připojeni k zápasu" pro modernější, čistší design
            document.getElementById("eventStatus").innerHTML = ""; 

            // 5. DYNAMICKÝ IMPORT HRY: Načteme herní modul podle toho, co vybral admin (např. social_watch)
            loadGameModule(eventData.activeGame, eventId);

        } else {
            // Pokud dokument s tímto ID ve Firebase neexistuje
            document.getElementById("eventTitle").textContent = "Zápas nenalezen 😢";
            document.getElementById("eventStatus").textContent = "Tento event už pravděpodobně neexistuje nebo byl smazán.";
            document.getElementById("gameZone").innerHTML = "";
        }
    } catch (error) {
        console.error("❌ Chyba při inicializaci mobilního klienta:", error);
        document.getElementById("eventStatus").textContent = "🔴 Chyba připojení k Firebase.";
    }
}

// Pomocná funkce, která dynamicky naimportuje JS soubor konkrétní hry ze složky /games/
async function loadGameModule(gameType, eventId) {
    try {
        console.log(`Načítám modul hry: ${gameType}...`);
        
        // Cesta k client.js dané hry (např. ../games/social_watch/client.js)
        const modulePath = `../games/${gameType}/client.js`;
        const gameModule = await import(modulePath);
        
        // Každá naše hra má v client.js exportovanou funkci init(), kterou teď předáme ID eventu a spustíme ji
        gameModule.init(eventId);
        console.log(`✅ Modul ${gameType} byl úspěšně inicializován.`);
        
    } catch (error) {
        console.error(`❌ Nelze načíst herní modul pro typ: ${gameType}`, error);
        document.getElementById("gameZone").innerHTML = `
            <div style="color:#f43f5e; padding: 20px;">
                <p><strong>Chyba:</strong> Tento herní modul (${gameType}) zatím nebyl naprogramován nebo chybí soubor client.js.</p>
            </div>
        `;
    }
}

// --- ⚡ 6. EXKLUZIVNÍ GLOBÁLNÍ FUNKCE PRO HARDWAROVÝ RESIZE FOTEK (MAX 1MB / ~200KB) ---
// Tuto funkcionalitu volá modul z games/social_watch/client.js pomocí window.resizeAndCompressImage()
window.resizeAndCompressImage = function(file, maxWidth = 1200, maxHeight = 1200, quality = 0.75) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                
                // Přepočet rozměrů tak, aby delší strana nepřekročila 1200px
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }
                
                // Vytvoření skrytého HTML5 Canvasu pro bleskový hardwarový render
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                
                // Zabalení vyrenderovaného plátna do úsporného formátu JPEG s optimalizovanou kvalitou
                canvas.toBlob((blob) => {
                    if (blob) {
                        const resizedFile = new File([blob], file.name, {
                            type: "image/jpeg",
                            lastModified: Date.now()
                        });
                        
                        console.log(`⚡ [Resize Engine] Původní: ${(file.size / 1024 / 1024).toFixed(2)} MB -> Komprimováno: ${(resizedFile.size / 1024).toFixed(0)} KB`);
                        resolve(resizedFile);
                    } else {
                        reject(new Error("Selhalo vygenerování binárního Blobu z Canvasu."));
                    }
                }, "image/jpeg", quality);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};