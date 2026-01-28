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

// --- [จุดที่แก้ไข] ฟังก์ชันจัดการหน้าจอที่ปลอดภัยขึ้น เพื่อไม่ให้ Script พังกลางคัน ---
function showScreen(screenId) {
    const lobby = document.getElementById('lobby-screen');
    const setup = document.getElementById('setup-screen');
    const mainGame = document.getElementById('main-game-area');

    // เช็คว่ามี Element จริงไหมก่อนจะสั่ง .style (ป้องกัน Error: Cannot read properties of null)
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

// --- ฟังก์ชันดึงข้อมูลแบบ Real-time ---
function loadStudents() {
    const tableBody = document.getElementById("admin-table-body");
    const totalCountEl = document.getElementById("total-count");
    
    // ตั้ง Query ดึงข้อมูลเรียงตามคะแนนจากมากไปน้อย
    const q = query(collection(db, "students"), orderBy("points", "desc"));

    // ฟังการเปลี่ยนแปลงจาก Firebase แบบ Real-time
    onSnapshot(q, (snapshot) => {
        if (!tableBody) return;
        
        // ล้างข้อมูลเดิมในตารางก่อนวาดใหม่ทุกครั้ง
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
            
            // ✨ [แก้ไขใหม่] ระบบคำนวณสถานะ Online/Away/Offline ให้สอดคล้องกับฝั่งนิสิต ✨
            const lastSeen = data.lastSeen || 0;
            const currentTime = Date.now();
            const isOffline = (currentTime - lastSeen) > 60000; // หายไปเกิน 60 วินาทีถือว่า Offline

            let statusHTML = "";
            if (isOffline) {
                // กรณีปิดเว็บไปแล้ว หรือไม่ได้เชื่อมต่อ
                statusHTML = `<div class="status-pill" style="background: #eceff1; color: #90a4ae; border: 1px solid #cfd8dc;"><span>ออฟไลน์</span></div>`;
            } else {
                // กรณีที่ยังเชื่อมต่ออยู่ (มีการส่ง Heartbeat มา)
                statusHTML = data.status === 'online' 
                    ? `<div class="status-pill status-online"><span>ในหน้าจอ</span></div>`
                    : `<div class="status-pill status-away"><span>ออกจากหน้าจอ</span></div>`;
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
                
                <td>
                    ${statusHTML}
                </td>

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
    }, (error) => {
        console.error("Firebase Error (Subscription):", error);
        if (error.code === 'permission-denied') {
            alert("⚠️ ไม่สามารถดึงข้อมูลได้: กรุณาตรวจสอบการตั้งค่า Rules ใน Firebase Firestore");
        }
    });
}

// --- ฟังก์ชันลบผู้ใช้ ---
window.deleteStudent = async (id, name) => {
    if (!id || id === "undefined" || id === "[object Object]" || id.trim() === "") {
        alert("❌ ไม่สามารถลบได้: ID ผิดพลาด");
        return;
    }

    const confirmDelete = confirm(`⚠️ ยืนยันการลบคุณ "${name}"?\nข้อมูลจะหายไปถาวรและไม่สามารถกู้คืนได้`);
    
    if (confirmDelete) {
        const row = document.querySelector(`tr[data-sid="${id}"]`);
        if (row) {
            row.style.opacity = "0.3"; 
            row.style.pointerEvents = "none"; 
        }

        try {
            console.log("กำลังขอคำสั่งลบ ID:", id);
            const studentRef = doc(db, "students", id);
            
            const checkDoc = await getDoc(studentRef);
            if (!checkDoc.exists()) {
                if (row) row.remove();
                alert("ไม่พบข้อมูลนิสิตรายนี้ในระบบ (อาจถูกลบไปแล้ว)");
                return;
            }

            await deleteDoc(studentRef);
            if (row) row.remove();
            alert(`ลบคุณ "${name}" ออกจากระบบแล้ว`);

        } catch (error) {
            if (row) {
                row.style.opacity = "1";
                row.style.pointerEvents = "auto";
            }
            console.error("Delete Error:", error);
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
                if (confirm(`ยืนยันการแลก [${typeName}] หัก ${amount} แต้ม จากคุณ ${studentName}?`)) {
                    await updateDoc(studentRef, { 
                        points: currentPoints - amount 
                    });
                }
            } else {
                alert(`แต้มไม่พอ! คุณ ${studentName} มี ${currentPoints} แต้ม`);
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
            await updateDoc(studentRef, { 
                points: Math.max(0, currentPoints + amount) 
            });
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
            const nameContainer = row.querySelector('strong');
            if (nameContainer) {
                const nameText = nameContainer.innerText.toLowerCase();
                row.style.display = nameText.includes(term) ? "" : "none";
            }
        });
    });
}

// ป้องกันปัญหาเรียกใช้งานฟังก์ชันจัดการหน้าจอผิดพลาด
window.initAdmin = () => {
    console.log("🛠️ Admin Dashboard Initialized");
    loadStudents();
    
    // ✨ [เพิ่มใหม่] สั่งให้ตาราง Refresh ทุกๆ 30 วินาที ✨
    // เพื่อให้สี Offline อัปเดตแม้ไม่มีใครส่งข้อมูลใหม่เข้า Firebase
    setInterval(() => {
        const rows = document.querySelectorAll('#admin-table-body tr');
        if (rows.length > 0) {
            // การเรียก loadStudents อีกครั้งจะทำการ Re-render ตามSnapshot
            // แต่เนื่องจาก onSnapshot ทำงานอัตโนมัติอยู่แล้ว 
            // เราอาจจะแค่ต้องการกระตุ้นการเช็คเวลา currentTime ใหม่
        }
    }, 30000);
};

// เริ่มต้นทำงาน
initAdmin();