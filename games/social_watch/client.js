import { db, storage } from "../../shared/firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

export function init(eventId) {
    const gameZone = document.getElementById("gameZone");
    
    gameZone.innerHTML = `
        <div class="photo-upload-box animate-fade">
            <div class="camera-icon-header">📸</div>
            <h2>Živá fotostěna</h2>
            <p>Vyfoťte momentku. Systém ji automaticky ořízne na čtverec a zkomprimuje pro bleskové zobrazení na LED stěně.</p>
            
            <div class="input-wrapper">
                <input type="text" id="userName" placeholder="Vaše jméno / přezdívka" maxlength="20">
            </div>
            
            <input type="file" id="photoInput" accept="image/*" capture="camera" style="display:none;">
            
            <button id="btnSelectPhoto" class="btn-trigger-camera">📷 SPUSTIT FOTOAPARÁT</button>
            
            <div id="uploadStatus" class="status-msg"></div>
            <canvas id="cropCanvas" style="display:none;"></canvas>
        </div>
    `;

    document.getElementById("btnSelectPhoto").addEventListener("click", () => {
        document.getElementById("photoInput").click();
    });

    document.getElementById("photoInput").addEventListener("change", (e) => {
        processAndUploadSquarePhoto(e, eventId);
    });
}

async function processAndUploadSquarePhoto(e, eventId) {
    const originalFile = e.target.files[0];
    const userName = document.getElementById("userName").value.trim() || "Host";
    const statusDiv = document.getElementById("uploadStatus");
    const canvas = document.getElementById("cropCanvas");
    const ctx = canvas.getContext("2d");

    if (!originalFile) return;

    statusDiv.textContent = "⏳ Optimalizuji a komprimuji fotografii...";
    statusDiv.style.color = "#38bdf8";

    try {
        // 🔥 KROK 1: Pustíme globální před-kompresi z public.js (Zabrání pádu RAM u mobilů)
        const compressedFile = await window.resizeAndCompressImage(originalFile);

        // KROK 2: Vytvoříme Image objekt z již odlehčeného souboru
        const img = new Image();
        img.src = URL.createObjectURL(compressedFile);
        
        img.onload = async () => {
            // Výpočet středového ořezu na dokonalý čtverec 1:1
            const size = Math.min(img.width, img.height);
            const sourceX = (img.width - size) / 2;
            const sourceY = (img.height - size) / 2;

            // Nastavení fixních rozměrů výsledného čtverce
            canvas.width = 500;
            canvas.height = 500;

            // Vyrenderování čistého ořezu do Canvasu
            ctx.drawImage(img, sourceX, sourceY, size, size, 0, 0, 500, 500);

            statusDiv.textContent = "⏳ Odesílám lehký čtverec na server...";

            canvas.toBlob(async (blob) => {
                try {
                    const uniqueFileName = `photos/${eventId}/${Date.now()}_500x500.jpg`;
                    const storageRef = ref(storage, uniqueFileName);

                    // Nahráváme finální vyčištěný blob do Storage
                    const snapshot = await uploadBytes(storageRef, blob);
                    const downloadURL = await getDownloadURL(snapshot.ref);

                    // Zapíšeme metadata do databáze zápasu (status "pending" ladí s novou moderací!)
                    await addDoc(collection(db, "events", eventId, "social_wall"), {
                        imageUrl: downloadURL,
                        user: userName,
                        approved: false, 
                        status: "pending", // 🔥 Kompatibilita s novým Enterprise moderováním
                        createdAt: serverTimestamp()
                    });

                    statusDiv.textContent = "✅ Odesláno! Fotka čeká na schválení.";
                    statusDiv.style.color = "#4ade80";
                    document.getElementById("photoInput").value = "";

                    // Uvolníme objekt z paměti telefonu
                    URL.revokeObjectURL(img.src);

                } catch (error) {
                    console.error("Chyba při uploadu blobu:", error);
                    statusDiv.textContent = "❌ Nepodařilo se odeslat.";
                    statusDiv.style.color = "#f43f5e";
                }
            }, "image/jpeg", 0.80); // 80% finální kvalita pro optimální JPEG kompresi
        };

    } catch (compressError) {
        console.error("Chyba při před-kompresi:", compressError);
        statusDiv.textContent = "❌ Selhala optimalizace snímku.";
        statusDiv.style.color = "#f43f5e";
    }
}