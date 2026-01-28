import { db, userId, userName, userAvatar } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// นำเข้าโมดูลกราฟที่เราแยกไฟล์ไว้
import { renderStatsModal } from './stats-module.js';

// --- [Asset & Sound Settings - ปรับปรุงใหม่] ---
const sounds = {
    tap: new Audio('sounds/tap.mp3'),
    confirm: new Audio('sounds/confirm.mp3'),
    denied: new Audio('sounds/denied.mp3'),
    click: new Audio('https://actions.google.com/sounds/v1/foley/button_click.ogg'),
    win: new Audio('https://actions.google.com/sounds/v1/cartoon/clime_up_the_ladder.ogg'),
    fail: new Audio('https://actions.google.com/sounds/v1/human_voices/fart.ogg'),
    break: new Audio('https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg'),
    levelup: new Audio('https://actions.google.com/sounds/v1/cartoon/conga_drum_accent.ogg')
};

const unlockAudio = () => {
    Object.values(sounds).forEach(s => {
        s.play().then(() => { s.pause(); s.currentTime = 0; }).catch(() => { });
    });
    document.removeEventListener('click', unlockAudio);
    console.log("🔊 Sound System Unlocked");
};
document.addEventListener('click', unlockAudio);

const playSound = (soundKey) => {
    const s = sounds[soundKey];
    if (s) {
        s.currentTime = 0;
        const playPromise = s.play();
        if (playPromise !== undefined) {
            playPromise.catch(e => {
                console.warn(`[Sound System] ${soundKey} play blocked:`, e.message);
            });
        }
    }
};

// --- 1. ตัวแปรสถานะ game ---
export let score = 0;
export let currentSkin = "default";
export let currentBG = "classroom.jpg";
let isSleeping = false;
let periodEnergy = 100;
let hasFailedPeriod = false;

// --- 2. ตัวแปรระบบช่วงเวลา ---
let currentPeriod = 1;
let totalPeriods = 6;
let isBreakMode = false;
let timeLeft = 1800;
let periodScores = [];
let tabSwitchCount = 0;
let totalFocusSeconds = 0;
let gameInterval = null;

// ✨ [อัปเดตสถานะ Online/Away ไปยัง Firebase] ✨
async function updateOnlineStatus(status) {
    if (!userId) return;
    try {
        const userRef = doc(db, "students", userId);
        await updateDoc(userRef, {
            status: status,
            lastSeen: Date.now()
        });
    } catch (error) {
        console.error("Error updating status:", error);
    }
}

// --- [ฟังก์ชันเสริม: ระบบคำนวณพลังงานย้อนหลัง] ---
function handleBackgroundTime() {
    if (hasFailedPeriod || isBreakMode || !gameInterval) return;

    const lastExit = localStorage.getItem("lastExitTime");
    if (lastExit && lastExit !== "undefined") {
        const currentTime = Date.now();
        const diffSeconds = Math.floor((currentTime - parseFloat(lastExit)) / 1000);

        if (diffSeconds > 0) {
            timeLeft = Math.max(0, timeLeft - diffSeconds);
            
            // 🎁 ปรับปรุงใหม่: ถ้าหายไปไม่เกิน 60 วินาที (กรณีจอดับแป๊บเดียว) จะไม่หักพลังงาน
            if (diffSeconds > 60) {
                const energyLost = diffSeconds * 0.8;
                periodEnergy = Math.max(0, periodEnergy - energyLost);
                console.log(`[Sync Success] หายไปนานเกินไป (${diffSeconds} วินาที) หักพลังงาน ${energyLost.toFixed(1)}`);
            } else {
                console.log(`[Sync Success] กลับมาทันเวลา! (หายไป ${diffSeconds} วินาที) ไม่มีการลงโทษหักพลังงาน`);
            }

            updateUI();
            updateImage();

            if (periodEnergy <= 0) {
                periodEnergy = 0;
                handleEnergyDepleted();
            }
        }
        localStorage.removeItem("lastExitTime");
    }
}

// --- 3. ระบบจัดการเลเวล ---
function getCurrentLevel() {
    if (score >= 100) return 'grad';
    if (score >= 50) return '3';
    if (score >= 20) return '2';
    return '1';
}

// --- 4. ระบบจัดการรูปภาพตัวละคร ---
export function updateImage() {
    const img = document.getElementById('main-character-img');
    if (!img) return;

    img.classList.add('character-breathing');
    const lv = getCurrentLevel();
    let fileName = "";

    if (hasFailedPeriod) {
        fileName = (lv === '1') ? `${userAvatar}_fail1.png` : `${userAvatar}_${lv}_fail.png`;
    }
    else if (isSleeping || periodEnergy <= 30) {
        fileName = `${userAvatar}_sleep${lv}.png`;
    }
    else if (isBreakMode) {
        fileName = (currentSkin !== "default" && currentSkin !== "")
            ? currentSkin.replace('.png', '') + "_idle.png"
            : `${userAvatar}_${lv}.png`;
    }
    else {
        if (currentSkin !== "default" && currentSkin !== "") {
            fileName = currentSkin;
        } else {
            fileName = `${userAvatar}_${lv}.png`;
        }
    }

    if (!fileName.endsWith('.png')) fileName += ".png";
    const newSrc = `images/${fileName}`;
    
    if (img.getAttribute('src') !== newSrc) {
        img.src = newSrc;
    }

    img.onerror = () => {
        if (hasFailedPeriod) {
            img.src = `images/${userAvatar}_fail1.png`;
        } else if (isSleeping || periodEnergy <= 30) {
            img.src = `images/${userAvatar}_sleep1.png`;
        } else {
            img.src = `images/${userAvatar}_1.png`;
        }
    };
}

// --- 5. ระบบจัดการพื้นหลัง ---
export function updateBackground() {
    const gameBody = document.querySelector('.game-body');
    if (gameBody) {
        const bgFile = currentBG || "classroom.jpg";
        gameBody.style.backgroundImage = `url('images/${bgFile}')`;
    }
}

// --- 6. ระบบบันทึกข้อมูลไป Firebase ---
async function saveUserData() {
    if (!userId) return;
    try {
        const timestamp = Date.now();
        const userRef = doc(db, "students", userId);

        await updateDoc(userRef, {
            name: userName,
            avatar: userAvatar,
            points: score,
            currentSkin: currentSkin,
            currentBG: currentBG,
            status: isSleeping ? "away" : "online",
            lastSeen: timestamp,
            stats: {
                focusSeconds: totalFocusSeconds,
                switches: tabSwitchCount,
                history: periodScores
            },
            lastUpdate: timestamp
        }).catch(async (error) => {
            if (error.code === 'not-found') {
                console.warn("⚠️ บัญชีนี้ไม่มีอยู่ในระบบแล้ว");
            }
        });

        localStorage.setItem("localLastUpdate", timestamp.toString());
    } catch (error) {
        console.error("Firebase Save Error:", error);
    }
}

// --- 7. ฟังก์ชันจัดการหน้าจอ ---
function showScreen(screenId) {
    document.getElementById('lobby-screen').style.setProperty('display', 'none', 'important');
    document.getElementById('setup-screen').style.setProperty('display', 'none', 'important');
    document.getElementById('main-game-area').style.display = 'none';

    if (screenId === 'game') {
        document.getElementById('main-game-area').style.display = 'block';
    } else {
        const target = document.getElementById(screenId);
        if (target) target.style.setProperty('display', 'flex', 'important');
    }
}

window.showSetup = () => {
    playSound('tap');
    showScreen('setup-screen');
};

window.hideSetup = () => {
    playSound('tap');
    showScreen('lobby-screen');
};

window.logout = () => {
    if (confirm("ออกจากระบบใช่หรือไม่?")) window.location.href = 'index.html';
};

window.selectDuration = (totalMinutes) => {
    playSound('confirm');
    totalPeriods = totalMinutes / 30;
    currentPeriod = 1;
    timeLeft = 1800;
    periodEnergy = 100;
    hasFailedPeriod = false;

    alert(`เริ่มคาบเรียน ${totalMinutes / 60} ชั่วโมง (แบ่งเป็น ${totalPeriods} ช่วง ช่วงละ 30 นาที)`);
    showScreen('game');
    startGameLoop();
    updateUI();
};

// --- 8. ลูปเกมและการจัดการ UI ---
export async function initGame() {
    if (!userId) { window.location.href = 'index.html'; return; }

    updateOnlineStatus("online");

    onSnapshot(doc(db, "students", userId), (docSnap) => {
        if (!docSnap.exists()) {
            console.error("🚫 ข้อมูลถูกลบโดยแอดมิน");
            localStorage.clear();
            alert("บัญชีของคุณถูกรีเซ็ตหรือถูกลบ กรุณาล็อกอินใหม่เพื่อเริ่มรอบใหม่");
            window.location.href = 'index.html';
            return;
        }

        const data = docSnap.data();
        score = data.points || 0;

        const serverTime = data.lastUpdate || 0;
        const localTime = parseInt(localStorage.getItem("localLastUpdate") || "0");

        if (serverTime > localTime) {
            currentSkin = data.currentSkin || "default";
            currentBG = data.currentBG || "classroom.jpg";
            totalFocusSeconds = data.stats?.focusSeconds || 0;
            tabSwitchCount = data.stats?.switches || 0;
            periodScores = data.stats?.history || [];

            localStorage.setItem("localLastUpdate", serverTime.toString());
        }

        const lobbyNameEl = document.getElementById('lobby-name');
        const userDisplayEl = document.getElementById('user-display');

        if (lobbyNameEl) lobbyNameEl.innerText = data.name || userName;
        if (userDisplayEl) userDisplayEl.innerText = data.name || userName;

        updatePointsUI();
        updateImage();
        updateBackground();
    });

    showScreen('lobby-screen');
    requestAnimationFrame(checkFocus);
}

function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval);
    gameInterval = setInterval(async () => {
        if (hasFailedPeriod) return;

        if (timeLeft > 0) {
            timeLeft--;
            if (!isBreakMode) {
                if (isSleeping) {
                    periodEnergy -= 1.5;
                    if (periodEnergy <= 0) {
                        periodEnergy = 0;
                        await handleEnergyDepleted();
                    }
                } else {
                    totalFocusSeconds++;
                    if (periodEnergy < 100) periodEnergy += 0.3;
                }
            }
            updateUI();
        } else {
            await handlePeriodEnd();
        }
    }, 1000);
}

// --- [ส่วนที่แก้ไขใหม่: จอดับ = ไม่เปลี่ยนสถานะ, สลับแอป = Away ทันที] ---

// 1. ตรวจจับการ "สลับแอป/เปิดแท็บใหม่" (Window Focus/Blur)
window.addEventListener('blur', () => {
    if (!isBreakMode && gameInterval && !hasFailedPeriod) {
        isSleeping = true;
        tabSwitchCount++; 
        updateImage();
        updateOnlineStatus("away"); // ฟ้องแอดมินว่าหนีไปแอปอื่น
        console.log("🚫 สลับแอป: แจ้งแอดมินว่า Away");
    }
});

window.addEventListener('focus', () => {
    if (isSleeping) {
        isSleeping = false;
        handleBackgroundTime();
        updateImage();
        updateOnlineStatus("online"); // กลับมาแจ้งว่า Online
        console.log("✅ กลับมาที่เกม: แจ้งแอดมินว่า Online");
    }
});

// 2. ตรวจจับการ "ปิดหน้าจอ/จอดับ/ล็อคจอ" (Visibility Change)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // บันทึกเวลาไว้เฉยๆ เพื่อคำนวณพลังงานย้อนหลัง
        localStorage.setItem("lastExitTime", Date.now().toString());
        // --- ไม่ต้องสั่ง updateOnlineStatus("away") ตรงนี้ เพื่อให้แอดมินเห็นว่า Online อยู่ตอนจอดับ ---
        console.log("💤 จอดับ/ล็อคจอ: บันทึกเวลาไว้แต่ไม่ฟ้องแอดมิน");
    } else {
        // กลับมาเปิดหน้าจอ (เช็คกรณีที่ไม่ได้โดน blur ไปแอปอื่น)
        if (!isSleeping) {
            handleBackgroundTime();
            console.log("🌞 เปิดจอปกติ: เช็คเวลาจอดับ");
        }
    }
});

// 3. ปรับฟังก์ชัน checkFocus
function checkFocus() {
    requestAnimationFrame(checkFocus);
}

async function handleEnergyDepleted() {
    if (!hasFailedPeriod && !isBreakMode) {
        playSound('denied');
        hasFailedPeriod = true;
        const msg = document.getElementById('status-msg');
        if (msg) {
            msg.innerText = "หลุดโฟกัสจนพลังหมด! ⚡";
            msg.style.color = "#f44336";
        }

        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) resetBtn.style.display = "block";

        if (score >= 5) score -= 5; else score = 0;
        await saveUserData();
        updatePointsUI();
        updateImage();
    }
}

async function handlePeriodEnd() {
    if (!isBreakMode) {
        periodScores.push(Math.floor(periodEnergy));

        if (periodEnergy > 50) {
            playSound('confirm');
            score += 10;
            await saveUserData();
            updatePointsUI();
        }

        if (currentPeriod < totalPeriods) {
            isBreakMode = true;
            timeLeft = 300;
            playSound('break');
            alert(`🌟 จบช่วงที่ ${currentPeriod} แล้ว! พักผ่อนได้ 5 นาที`);
        } else {
            showFinalSummary();
            clearInterval(gameInterval);
            showScreen('lobby-screen');
        }
    } else {
        isBreakMode = false;
        currentPeriod++;
        timeLeft = 1800;
        periodEnergy = 100;
        hasFailedPeriod = false;
        playSound('tap');
        alert(`🔔 เริ่มช่วงที่ ${currentPeriod}! กลับมาโฟกัสกันเถอะ`);
    }
    updateImage();
    updateBackground();
    updateUI();
}

window.restartSession = function () {
    playSound('tap');
    hasFailedPeriod = false;
    periodEnergy = 100;
    timeLeft = 1800;

    const msg = document.getElementById('status-msg');
    if (msg) {
        msg.innerText = "กำลังใช้สมาธิ... ✨";
        msg.style.color = "#4db6ac";
    }

    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) resetBtn.style.display = "none";

    updateImage();
    updateUI();
};

function updateUI() {
    let m = Math.floor(timeLeft / 60);
    let s = timeLeft % 60;
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;

    const energyFill = document.getElementById('energy-fill');
    const mainGameArea = document.getElementById('main-game-area');

    if (energyFill) {
        energyFill.style.width = `${periodEnergy}%`;
        energyFill.style.background = isBreakMode ? "#4fc3f7" : "linear-gradient(90deg, #4db6ac, #81c784)";
    }

    if (isBreakMode) {
        mainGameArea.style.backgroundColor = "rgba(79, 195, 247, 0.15)";
    } else {
        mainGameArea.style.backgroundColor = "transparent";
    }

    const statusMsg = document.getElementById('status-msg');
    if (statusMsg && !hasFailedPeriod) {
        statusMsg.innerText = isBreakMode
            ? `☕ ช่วงพักผ่อน (${currentPeriod}/${totalPeriods})`
            : `📚 ช่วงโฟกัส (${currentPeriod}/${totalPeriods})`;
    }
}

window.showStatistics = () => {
    playSound('tap');
    renderStatsModal(
        periodScores,
        totalFocusSeconds,
        tabSwitchCount,
        userName,
        getCurrentLevel()
    );
};

function showFinalSummary() {
    const avgFocus = periodScores.length > 0 ? (periodScores.reduce((a, b) => a + b, 0) / periodScores.length) : 0;
    alert(`🏁 จบการเรียนวันนี้!\n- โฟกัสเฉลี่ย: ${avgFocus.toFixed(2)}%\n- สลับหน้าจอรวม: ${tabSwitchCount} ครั้ง\n- แต้มปัจจุบัน: ${score} 💎`);
}

window.openShop = () => {
    playSound('tap');
    updatePointsUI();
    document.getElementById('shop-modal').style.display = 'flex';
    switchShopTab('skins');
};

window.closeShop = () => {
    playSound('tap');
    document.getElementById('shop-modal').style.display = 'none';
};

window.switchShopTab = (tab) => {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const itemsList = document.querySelector('.items-list');
    if (itemsList) itemsList.innerHTML = "";

    let lv = getCurrentLevel();
    let shopLv = (lv === 'grad') ? '3' : lv;

    if (tab === 'skins') {
        itemsList.innerHTML = `
            <div class="item-card" onclick="selectItem('ชุดเริ่มต้น', 0, 'images/${userAvatar}_${lv}.png', 'skin')"><span>🎓 ชุดพื้นฐาน (Lv.${lv})</span><span class="price free">ฟรี</span></div>
            <div class="item-card" onclick="selectItem('ชุดแฟชั่น 1', 20, 'images/${userAvatar}_${shopLv}_shop1.png', 'skin')"><span>🌟 ชุดแฟชั่น 1</span><span class="price">20 💎</span></div>
            <div class="item-card" onclick="selectItem('ชุดแฟชั่น 2', 40, 'images/${userAvatar}_${shopLv}_shop2.png', 'skin')"><span>✨ ชุดแฟชั่น 2</span><span class="price">40 💎</span></div>
            <div class="item-card" onclick="selectItem('ชุดแฟชั่น 3', 60, 'images/${userAvatar}_${shopLv}_shop3.png', 'skin')"><span>🔥 ชุดแฟชั่น 3</span><span class="price">60 💎</span></div>`;
    } else {
        itemsList.innerHTML = `
            <div class="item-card" onclick="selectItem('ห้องเรียนหลัก', 0, 'images/classroom.jpg', 'bg')"><span>🏫 ห้องเรียนหลัก</span><span class="price free">ฟรี</span></div>
            <div class="item-card" onclick="selectItem('ห้องเรียนสีเขียว', 20, 'images/classroom1.jpg', 'bg')"><span>📘 ห้องเรียนสีเขียว</span><span class="price">20 💎</span></div>
            <div class="item-card" onclick="selectItem('ห้องเรียนยามเย็น', 40, 'images/classroom3.jpg', 'bg')"><span>🌇 ห้องเรียนยามเย็น</span><span class="price">40 💎</span></div>
            <div class="item-card" onclick = "selectItem('ห้องเรียนสีฟ้าสดใส', 60, 'images/classroom2.jpg', 'bg')" ><span>🩵 ห้องเรียนสีฟ้าสดใส</span><span class="price">60 💎</span></div> `;

    }
};

window.selectItem = (name, price, imgSrc, type) => {
    playSound('tap');
    const previewImg = document.getElementById('shop-preview-img');
    const previewName = document.getElementById('preview-item-name');
    const confirmBtn = document.getElementById('confirm-buy-btn');
    if (previewImg) previewImg.src = imgSrc;
    if (previewName) previewName.innerText = `${ name } (${ price === 0 ? 'ฟรี' : price + ' 💎' })`;
    
    confirmBtn.onclick = async () => {
        if (score >= price) {
            if (price > 0 && !confirm(`ใช้ ${ price } แต้มเพื่อเลือก ${ name }?`)) return;
            score -= price;
            const fileName = imgSrc.split('/').pop(); 
            if (type === 'skin') currentSkin = fileName; else currentBG = fileName;
            await saveUserData();
            updatePointsUI();
            if (type === 'skin') updateImage(); else updateBackground();
            playSound('confirm');
            alert("อัปเดตเรียบร้อย!");
            window.closeShop();
        } else { 
            playSound('denied');
            alert("แต้มไม่พอ!"); 
        }
    };
};

window.processRedeem = async (cost) => {
    playSound('tap');
    if (score >= cost) {
        if(!confirm(`ต้องการใช้ ${ cost } แต้ม เพื่อแลกรางวัลใช่หรือไม่ ? `)) return;
        score -= cost; 
        try {
            await saveUserData();
            updatePointsUI(); 
            playSound('confirm');
            alert(`แลกรางวัลสำเร็จ! หักไป ${ cost } แต้ม(คงเหลือ ${ score } แต้ม)`);
        } catch (error) {
            console.error("Redeem Error:", error);
            alert("เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล");
        }
    } else {
        playSound('denied');
        alert("แต้มของคุณไม่เพียงพอสำหรับการแลกรางวัลนี้");
    }
}

export function updatePointsUI() {
    const ptsEl = document.getElementById('pts');
    const lobbyPtsEl = document.getElementById('lobby-pts'); 
    const shopPtsEl = document.getElementById('shop-pts-balance');
    const currentPointsModal = document.getElementById('current-points');
    const pointsDisplayHUD = document.getElementById('points-display');
    
    if (ptsEl) ptsEl.innerText = score;
    if (lobbyPtsEl) lobbyPtsEl.innerText = score; 
    if (shopPtsEl) shopPtsEl.innerText = score;
    if (currentPointsModal) currentPointsModal.innerText = score;
    if (pointsDisplayHUD) pointsDisplayHUD.innerText = score;

    const btn50 = document.querySelector('.btn-redeem-small');
    const btn100 = document.querySelector('.btn-redeem-large');
    
    if(btn50) btn50.disabled = (score < 50);
    if(btn100) btn100.disabled = (score < 100);
}

initGame();
