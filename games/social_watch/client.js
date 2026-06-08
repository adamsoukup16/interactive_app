import { db, storage } from "../../shared/firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

let videoStream = null;

export function init(eventId) {
    const gameZone = document.getElementById("gameZone");
    
    gameZone.innerHTML = `
        <div class="app-interface animate-fade" style="max-width: 420px; margin: 0 auto; padding: 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc; display: flex; flex-direction: column; min-height: 80vh; justify-content: space-between;">
            
            <div class="info-panel" style="text-align: center; margin-bottom: 20px;">
                <span style="font-size: 0.65rem; color: #38bdf8; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; display: block; margin-bottom: 6px;">Live multimediální přenos</span>
                <p style="font-size: 0.85rem; color: #94a3b8; margin: 0; font-weight: 400; line-height: 1.4;">Váš snímek se po schválení moderátorem okamžitě zobrazí na hlavní projekční LED stěně.</p>
            </div>

            <div class="identity-zone" style="margin-bottom: 25px;">
                <div style="position: relative; width: 100%; max-width: 320px; margin: 0 auto;">
                    <input type="text" id="userName" placeholder="Přezdívka nebo jméno autora" maxlength="20" 
                        style="width: 100%; padding: 14px 16px; background: #0f172a; border: 1px solid #1e293b; color: #fff; border-radius: 12px; text-align: center; font-size: 0.9rem; font-weight: 500; outline: none; transition: border 0.3s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);">
                </div>
            </div>

            <div class="camera-module" style="position: relative; width: 320px; height: 320px; margin: 0 auto 30px auto;">
                
                <div class="camera-viewport" style="position: relative; width: 100%; height: 100%; border-radius: 24px; overflow: hidden; background: #020617; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
                    <video id="webcamVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
                    
                    <div id="cameraPlaceholder" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #64748b; font-size: 0.8rem; letter-spacing: 0.5px; background: #020617; font-weight: 500;">
                        <div style="width: 24px; height: 24px; border: 2px solid #334155; border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px;"></div>
                        Spouštění optického snímače
                    </div>
                </div>

                <div style="position: absolute; top: 20px; left: 20px; width: 16px; height: 16px; border-top: 2px solid rgba(56, 189, 248, 0.6); border-left: 2px solid rgba(56, 189, 248, 0.6); border-top-left-radius: 4px; pointer-events: none;"></div>
                <div style="position: absolute; top: 20px; right: 20px; width: 16px; height: 16px; border-top: 2px solid rgba(56, 189, 248, 0.6); border-right: 2px solid rgba(56, 189, 248, 0.6); border-top-right-radius: 4px; pointer-events: none;"></div>
                <div style="position: absolute; bottom: 20px; left: 20px; width: 16px; height: 16px; border-bottom: 2px solid rgba(56, 189, 248, 0.6); border-left: 2px solid rgba(56, 189, 248, 0.6); border-bottom-left-radius: 4px; pointer-events: none;"></div>
                <div style="position: absolute; bottom: 20px; right: 20px; width: 16px; height: 16px; border-bottom: 2px solid rgba(56, 189, 248, 0.6); border-right: 2px solid rgba(56, 189, 248, 0.6); border-bottom-right-radius: 4px; pointer-events: none;"></div>
            </div>
            
            <div class="control-zone" style="text-align: center; margin-bottom: 20px;">
                <button id="btnCapturePhoto" class="btn-shutter" style="background: #ffffff; color: #020617; border: none; padding: 16px 36px; border-radius: 14px; font-weight: 700; font-size: 0.9rem; cursor: pointer; letter-spacing: 0.5px; transition: all 0.2s ease; width: 100%; max-width: 280px; box-shadow: 0 10px 15px -3px rgba(255,255,255,0.1); text-transform: uppercase;">
                    Odeslat momentku
                </button>
                <div id="uploadStatus" class="status-msg" style="margin-top: 15px; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.3px;"></div>
            </div>
            
            <div class="partner-footer" style="text-align: center; border-top: 1px solid #1e293b; padding-top: 20px; margin-top: auto; opacity: 0.75;">
                <span style="font-size: 0.55rem; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px; display: block; margin-bottom: 8px;">Partner živého vysílání</span>
                <img src="https://adamsoukup16.github.io/interactive_app/shared/logo-placeholder.png" alt="Partner Logo" onerror="this.style.display='none'; document.getElementById('partner-fallback').style.display='block';" style="height: 24px; max-width: 140px; object-fit: contain; filter: brightness(0) invert(1) opacity(0.6);">
                <div id="partner-fallback" style="display: none; font-size: 0.8rem; font-weight: 700; color: #475569; letter-spacing: 1px;">CORE PANEL DIGITAL</div>
            </div>

            <canvas id="cropCanvas" style="display:none;"></canvas>
        </div>
    `;

    // Přidáme základní CSS pro čistou animaci spinneru přímo do DOMu
    if (!document.getElementById("camera-dynamic-styles")) {
        const style = document.createElement("style");
        style.id = "camera-dynamic-styles";
        style.innerHTML = `
            @keyframes spin { to { transform: rotate(360deg); } }
            .btn-shutter:active { transform: scale(0.97); background: #f1f5f9; }
            #userName:focus { border-color: #38bdf8 !important; }
        `;
        document.head.appendChild(style);
    }

    startLiveCamera();

    document.getElementById("btnCapturePhoto").addEventListener("click", () => {
        captureAndUpload(eventId);
    });
}

// --- 🎥 1. ZAPNUTÍ LIVE STREAMU ---
async function startLiveCamera() {
    const video = document.getElementById("webcamVideo");
    const placeholder = document.getElementById("cameraPlaceholder");

    if (!video) return;

    try {
        const constraints = {
            video: { 
                facingMode: "environment",
                width: { ideal: 1080 },
                height: { ideal: 1080 }
            },
            audio: false
        };

        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = videoStream;
        
        video.onloadedmetadata = () => {
            if (placeholder) placeholder.style.display = "none";
        };
    } catch (err) {
        console.error(err);
        if (placeholder) {
            placeholder.innerHTML = "<span style='color:#ef4444;'>Prvek fotoaparátu nelze inicializovat</span><br><span style='color:#475569; font-size:0.7rem; margin-top:4px;'>Povolte přístup ke kameře v prohlížeči.</span>";
        }
    }
}

// --- 📸 2. SPOUŠŤ ---
async function captureAndUpload(eventId) {
    const video = document.getElementById("webcamVideo");
    const canvas = document.getElementById("cropCanvas");
    const userName = document.getElementById("userName").value.trim() || "Host";
    const statusDiv = document.getElementById("uploadStatus");

    if (!video || !videoStream || !canvas) return;

    statusDiv.textContent = "Zpracování digitálního otisku...";
    statusDiv.style.color = "#38bdf8";

    const ctx = canvas.getContext("2d");
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
    const size = Math.min(videoWidth, videoHeight);
    const sourceX = (videoWidth - size) / 2;
    const sourceY = (videoHeight - size) / 2;

    canvas.width = 500;
    canvas.height = 500;

    ctx.drawImage(video, sourceX, sourceY, size, size, 0, 0, 500, 500);
    statusDiv.textContent = "Zápis dat do cloudu...";

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

            statusDiv.textContent = "Fotografie byla odeslána ke schválení";
            statusDiv.style.color = "#10b981";

            video.style.opacity = "0.2";
            setTimeout(() => video.style.opacity = "1", 100);

        } catch (error) {
            console.error(error);
            statusDiv.textContent = "Chyba sítě. Zkuste to znovu.";
            statusDiv.style.color = "#ef4444";
        }
    }, "image/jpeg", 0.85);
}