import { db } from './firebase-config.js';
import { 
    collection, 
    onSnapshot, 
    doc, 
    getDoc, 
    updateDoc, 
    deleteDoc, 
    query, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- ฟังก์ชันจัดการหน้าจอที่ปลอดภัยขึ้น ---
function showScreen(screenId) {
    const lobby = document.getElementById('lobby-screen');
    const setup = document.getElementById('setup-screen');
    const mainGame = document.getElementById('main-game-area');

    if (lobby) lobby.style.setProperty('display', 'none', 'important');
    if (setup) setup.style.setProperty('display', 'none', 'important');
    if (mainGame) mainGame.style.display = 'none';
    
    const target = document.getElementById(screenId);
    if (target) {
        if (screenId === 'game' || screenId === 'main-game-area') {
            target.style.display = 'block';
        } else {
            target.style.setProperty('display', 'flex', 'important');
        }
    }
}

// --- ฟังก์ชันดึงข้อมูลแบบ Real-time และจัดการสถานะให้ตรงกับความจริง ---
function loadStudents() {
    const tableBody = document.getElementById("admin-table-body");
    const totalCountEl = document.getElementById("total-count");
    
    const q = query(collection(db, "students"), orderBy("points", "desc"));

    onSnapshot(q, (snapshot) => {
        if (!tableBody) return;
        
        tableBody.innerHTML = ""; 
        
        if (totalCountEl) {
            totalCountEl.innerText = snapshot.size; 
        }

        if (snapshot.empty) {
            tableBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding: 40px; color: #999;'>ยังไม่มีนิสิตในระบบ</td></tr>";
            return;
        }

        snapshot.forEach((studentDoc) => {
            const data = studentDoc.data();
            const sId = studentDoc.id; 
            const studentName = data.name || data.fullName || "ไม่ระบุชื่อ"; 
            const points = data.points || 0;
            const avatar = data.avatar || "girl"; 
            
            // ✨ [ปรับปรุง Logic การแสดงผลสถานะใหม่] ✨
            const lastSeen = data.lastSeen || 0;
            const currentTime = Date.now();
            const isOffline = (currentTime - lastSeen) > 90000; // หายไปเกิน 1.5 นาทีถือว่า Offline

            let statusHTML = "";
            if (isOffline) {
                // กรณีปิดเว็บไปแล้ว
                statusHTML = `<div class="status-pill" style="background: #eceff1; color: #90a4ae; border: 1px solid #cfd8dc;"><span>ออฟไลน์</span></div>`;
            } else {
                // ตรวจสอบสถานะ Online/Away จากฝั่งนิสิต
                if (data.status === 'online') {
                    // "online" = นิสิตเปิดหน้าเว็บค้างไว้ (รวมถึงตอนดับจอแล้วระบบยังทำงานอยู่)
                    statusHTML = `<div class="status-pill status-online" style="background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9;"><span>กำลังจดจ่อ (เปิดหน้าแอป)</span></div>`;
                } else {
                    // "away" = นิสิตกดปุ่ม Home หรือสลับไปแอปอื่นจริง ๆ
                    statusHTML = `<div class="status-pill status-away" style="background: #fff3e0; color: #ef6c00; border: 1px solid #ffe0b2;"><span>สลับไปแอปอื่น</span></div>`;
                }
            }

            const row = document.createElement("tr");
            row.setAttribute("data-sid", sId); 
            
            row.innerHTML = `
                <td>
                    <div class="student-info">
                        <img src="images/${avatar}_1.png" alt="avatar" onerror="this.src='images/girl_1.png'">
                        <div>
                            <strong>${studentName}</strong><br>
                            <small style="color: #999; font-size: 0.8em;">ID: ${sId}</small>
                        </div>
                    </div>
                </td>
                <td class="pts-badge">${points.toLocaleString()} 💎</td>
                <td>${statusHTML}</td>
                <td>
                    <div class="action-group">
                        <button class="btn-cut btn-cut-small" onclick="handleRedeem('${sId}', 50, 'รางวัลย่อย')">
                            ✂️ 50
                        </button>
                        <button class="btn-cut" onclick="handleRedeem('${sId}', 100, 'รางวัลใหญ่')">
                            ✂️ 100
                        </button>
                        <button class="btn-bonus" onclick="modifyPoints('${sId}', 10)">
                            ✨ +10
                        </button>
                        <button class="btn-delete-admin" onclick="deleteStudent('${sId}', '${studentName}')">
                            🗑️ ลบ
                        </button>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);
        });
    });
}

// --- ฟังก์ชันลบผู้ใช้ ---
window.deleteStudent = async (id, name) => {
    if (!id || id === "undefined" || id.trim() === "") {
        alert("❌ ไม่สามารถลบได้: ID ผิดพลาด");
        return;
    }

    const confirmDelete = confirm(`⚠️ ยืนยันการลบคุณ "${name}"?`);
    if (confirmDelete) {
        const row = document.querySelector(`tr[data-sid="${id}"]`);
        if (row) row.style.opacity = "0.3";

        try {
            await deleteDoc(doc(db, "students", id));
            alert(`ลบคุณ "${name}" เรียบร้อยแล้ว`);
        } catch (error) {
            if (row) row.style.opacity = "1";
            alert("❌ เกิดข้อผิดพลาด: " + error.message);
        }
    }
};

// --- ฟังก์ชันหักแต้ม (Redeem) ---
window.handleRedeem = async (id, amount, typeName) => {
    if (!id || id === "undefined") return;
    const studentRef = doc(db, "students", id);
    try {
        const snap = await getDoc(studentRef);
        if (snap.exists()) {
            const currentPoints = snap.data().points || 0;
            const studentName = snap.data().name || "นิสิต";
            
            if (currentPoints >= amount) {
                if (confirm(`แลก [${typeName}] หัก ${amount} แต้ม จากคุณ ${studentName}?`)) {
                    await updateDoc(studentRef, { points: currentPoints - amount });
                }
            } else {
                alert(`แต้มไม่พอ! มี ${currentPoints} แต้ม`);
            }
        }
    } catch (error) {
        console.error("Redeem Error:", error);
    }
};

// --- ฟังก์ชันเพิ่ม/ลดแต้มพิเศษ ---
window.modifyPoints = async (id, amount) => {
    if (!id || id === "undefined") return;
    const studentRef = doc(db, "students", id);
    try {
        const snap = await getDoc(studentRef);
        if (snap.exists()) {
            const currentPoints = snap.data().points || 0;
            await updateDoc(studentRef, { points: Math.max(0, currentPoints + amount) });
        }
    } catch (error) {
        console.error("Modify points error:", error);
    }
};

// --- ระบบค้นหาชื่อนิสิต ---
const searchInput = document.getElementById('search-input');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        const rows = document.querySelectorAll('#admin-table-body tr');
        rows.forEach(row => {
            const nameText = row.querySelector('strong')?.innerText.toLowerCase() || "";
            row.style.display = nameText.includes(term) ? "" : "none";
        });
    });
}

// --- เริ่มต้นทำงาน ---
window.initAdmin = () => {
    console.log("🛠️ Admin Dashboard Initialized");
    loadStudents();
};

initAdmin();
