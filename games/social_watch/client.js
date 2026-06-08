import { db, storage } from "../../shared/firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

let videoStream = null;
let currentFacingMode = "environment"; // Výchozí je zadní kamera

export function init(eventId) {
    const gameZone = document.getElementById("gameZone");
    
    gameZone.innerHTML = `
        <div class="app-interface animate-fade" style="max-width: 420px; margin: 0 auto; padding: 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc; display: flex; flex-direction: column; min-height: 80vh; justify-content: space-between;">
            
            <div class="info-panel" style="text-align: center; margin-bottom: 15px;">
                <span style="font-size: 0.65rem; color: #38bdf8; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; display: block; margin-bottom: 6px;">Live multimediální přenos</span>
                <p style="font-size: 0.85rem; color: #94a3b8; margin: 0; font-weight: 400; line-height: 1.4;">Váš snímek se po schválení moderátorem okamžitě zobrazí na hlavní projekční LED stěně.</p>
            </div>

            <div class="identity-zone" style="margin-bottom: 20px;">
                <div style="position: relative; width: 100%; max-width: 320px; margin: 0 auto;">
                    <input type="text" id="userName" placeholder="Zadejte svou přezdívku (povinné)" maxlength="20" 
                        style="width: 100%; padding: 14px 16px; background: #0f172a; border: 1px solid #1e293b; color: #fff; border-radius: 12px; text-align: center; font-size: 0.9rem; font-weight: 500; outline: none; transition: all 0.3s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
                </div>
            </div>

            <div class="camera-module" style="position: relative; width: 320px; height: 320px; margin: 0 auto 25px auto;">
                <div class="camera-viewport" style="position: relative; width: 100%; height: 100%; border-radius: 24px; overflow: hidden; background: #020617; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
                    <video id="webcamVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover; transition: filter 0.1s;"></video>
                    
                    <div id="cameraFlashOverlay" style="position: absolute; inset: 0; background: #ffffff; opacity: 0; pointer-events: none; transition: opacity 0.05s ease-out; z-index: 5;"></div>
                    
                    <div id="cameraPlaceholder" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #64748b; font-size: 0.8rem; letter-spacing: 0.5px; background: #020617; font-weight: 500; z-index: 4;">
                        <div style="width: 24px; height: 24px; border: 2px solid #334155; border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px;"></div>
                        Spouštění optického snímače
                    </div>
                </div>

                <div style="position: absolute; top: 20px; left: 20px; width: 16px; height: 16px; border-top: 2px solid rgba(56, 189, 248, 0.5); border-left: 2px solid rgba(56, 189, 248, 0.5); border-top-left-radius: 4px; pointer-events: none; z-index: 6;"></div>
                <div style="position: absolute; top: 20px; right: 20px; width: 16px; height: 16px; border-top: 2px solid rgba(56, 189, 248, 0.5); border-right: 2px solid rgba(56, 189, 248, 0.5); border-top-right-radius: 4px; pointer-events: none; z-index: 6;"></div>
                <div style="position: absolute; bottom: 20px; left: 20px; width: 16px; height: 16px; border-bottom: 2px solid rgba(56, 189, 248, 0.5); border-left: 2px solid rgba(56, 189, 248, 0.5); border-bottom-left-radius: 4px; pointer-events: none; z-index: 6;"></div>
                <div style="position: absolute; bottom: 20px; right: 20px; width: 16px; height: 16px; border-bottom: 2px solid rgba(56, 189, 248, 0.5); border-right: 2px solid rgba(56, 189, 248, 0.5); border-bottom-right-radius: 4px; pointer-events: none; z-index: 6;"></div>
            </div>
            
            <div class="control-zone" style="text-align: center; margin-bottom: 15px; display: flex; flex-direction: column; align-items: center; gap: 12px;">
                <div style="display: flex; align-items: center; justify-content: center; gap: 15px; width: 100%; max-width: 320px;">
                    
                    <button id="btnCapturePhoto" class="btn-shutter" style="background: #ffffff; color: #020617; border: none; padding: 16px 30px; border-radius: 14px; font-weight: 700; font-size: 0.9rem; cursor: pointer; letter-spacing: 0.5px; transition: all 0.2s ease; flex-grow: 1; box-shadow: 0 10px 15px -3px rgba(255,255,255,0.1); text-transform: uppercase;">
                        Odeslat momentku
                    </button>
                    
                    <button id="btnFlipCamera" style="background: #0f172a; border: 1px solid #1e293b; color: #fff; width: 52px; height: 52px; border-radius: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; transition: background 0.2s;" title="Otočit kameru">
                        🔄
                    </button>
                </div>
                <div id="uploadStatus" class="status-msg" style="font-size: 0.8rem; font-weight: 600; letter-spacing: 0.3px; min-height: 18px;"></div>
            </div>
            
            <div class="partner-footer" style="text-align: center; border-top: 1px solid #1e293b; padding-top: 15px; margin-top: auto;">
                <span style="font-size: 0.55rem; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px; display: block; margin-bottom: 8px;">Partner živého vysílání</span>
                <img src="../../shared/logo-placeholder.png" alt="Partner Logo" onerror="this.style.display='none'; document.getElementById('partner-fallback').style.display='block';" style="height: 28px; max-width: 160px; object-fit: contain; filter: brightness(0) invert(1) opacity(0.55);">
                <div id="partner-fallback" style="display: none; font-size: 0.8rem; font-weight: 700; color: #475569; letter-spacing: 1px;">CORE PANEL DIGITAL</div>
            </div>

            <canvas id="cropCanvas" style="display:none;"></canvas>
        </div>
    `;

    // CSS styly
    if (!document.getElementById("camera-dynamic-styles")) {
        const style = document.createElement("style");
        style.id = "camera-dynamic-styles";
        style.innerHTML = `
            @keyframes spin { to { transform: rotate(360deg); } }
            .btn-shutter:active { transform: scale(0.96); background: #f1f5f9; }
            #userName:focus { border-color: #38bdf8 !important; }
            .input-error { border-color: #ef4444 !important; animation: shake 0.3s ease-in-out; background: #7f1d1d20 !important; }
            @keyframes shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-6px); }
                75% { transform: translateX(6px); }
            }
        `;
        document.head.appendChild(style);
    }

    // Inicializace kamery
    startLiveCamera();

    // Event Listenery
    document.getElementById("btnCapturePhoto").addEventListener("click", () => {
        captureAndUpload(eventId);
    });

    document.getElementById("btnFlipCamera").addEventListener("click", () => {
        flipCamera();
    });
}

// --- 🎥 1. ZAPNUTÍ A RESTART KAMERY ---
async function startLiveCamera() {
    const video = document.getElementById("webcamVideo");
    const placeholder = document.getElementById("cameraPlaceholder");
    if (!video) return;

    // Pokud už nějaký stream běží, bezpečně ho vypneme před startem nového (nutné pro přepínání!)
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }

    try {
        if (placeholder) placeholder.style.display = "flex";

        const constraints = {
            video: { 
                facingMode: currentFacingMode,
                width: { ideal: 1080 },
                height: { ideal: 1080 }
            },
            audio: false
        };

        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = videoStream;
        
        video.onloadedmetadata = () => {
            if (placeholder) placeholder.style.display = "none";
            // Pokud fotíme selfie přední kamerou, obraz zrcadlově otočíme, aby se lidi viděli přirozeně
            video.style.transform = currentFacingMode === "user" ? "scaleX(-1)" : "scaleX(1)";
        };
    } catch (err) {
        console.error(err);
        if (placeholder) {
            placeholder.innerHTML = "<span style='color:#ef4444;'>Fotoaparát nelze načíst</span>";
        }
    }
}

// --- 🔄 2. PŘEPÍNAČ PŘEDNÍ / ZADNÍ KAMERA ---
function flipCamera() {
    currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
    startLiveCamera();
}

// --- 🔊 3. SYNTETICKÝ ZVUK CVAKNUTÍ ZÁVĚRKY (Bez nutnosti stahovat MP3) ---
function playShutterSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = "triangle";
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        
        gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {
        console.log("Audio not allowed yet");
    }
}

// --- 📸 4. SPOUŠŤ A VALIDACE ---
async function captureAndUpload(eventId) {
    const video = document.getElementById("webcamVideo");
    const canvas = document.getElementById("cropCanvas");
    const nameInput = document.getElementById("userName");
    const statusDiv = document.getElementById("uploadStatus");
    const flash = document.getElementById("cameraFlashOverlay");

    if (!video || !videoStream || !canvas || !nameInput) return;

    const userName = nameInput.value.trim();

    // 🔥 VALIDACE: Přezdívka musí být vyplněná
    if (!userName) {
        nameInput.classList.add("input-error");
        statusDiv.textContent = "⚠️ Vyplňte prosím nejdříve svou přezdívku.";
        statusDiv.style.color = "#ef4444";
        setTimeout(() => nameInput.classList.remove("input-error"), 500);
        return;
    }

    // 🎬 FOTOGRAFICKÝ EFEKT: Spustíme záblesk a zvuk cvaknutí
    playShutterSound();
    if (flash) {
        flash.style.opacity = "1";
        setTimeout(() => flash.style.opacity = "0", 60);
    }

    statusDiv.textContent = "Zpracování digitálního otisku...";
    statusDiv.style.color = "#38bdf8";

    const ctx = canvas.getContext("2d");
    
    // Podpora zrcadlení pro přední kameru při ukládání finální fotky
    canvas.width = 500;
    canvas.height = 500;
    
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = (video.videoWidth - size) / 2;
    const sourceY = (video.videoHeight - size) / 2;

    ctx.save();
    if (currentFacingMode === "user") {
        ctx.translate(500, 0);
        ctx.scale(-1, 1);
    }
    
    ctx.drawImage(video, sourceX, sourceY, size, size, 0, 0, 500, 500);
    ctx.restore();

    canvas.toBlob(async (blob) => {
        try {
            const uniqueFileName = `photos/${eventId}/${Date.now()}_camera_500x500.jpg`;
            const storageRef = ref(storage, uniqueFileName);

            const snapshot = await uploadBytes(storageRef, blob);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(db, "events", eventId, "social_wall"), {
                imageUrl: downloadURL,
                user: userName,
                approved: false,
                status: "pending",
                createdAt: serverTimestamp()
            });

            statusDiv.textContent = "✓ Snímek byl úspěšně odeslán moderátorovi";
            statusDiv.style.color = "#10b981";

        } catch (error) {
            console.error(error);
            statusDiv.textContent = "Chyba sítě. Zkuste to znovu.";
            statusDiv.style.color = "#ef4444";
        }
    }, "image/jpeg", 0.85);
}