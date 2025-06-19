const express = require('express');
const router = express.Router();
const dbconnection = require('../database'); // ตรวจสอบว่า path นี้ถูกต้อง

// Middleware ตรวจสอบการล็อกอิน
function ifNotLoggedIn(req, res, next) {
  if (!req.session || !req.session.userID) {
    return res.redirect('/login');
  }
  next();
}

// ==========================================================
//     Route สำหรับแสดงหน้า "ทรัพย์สินของฉัน"
//     (หน้าที่ User จะเข้ามาเพื่อเริ่มทำเรื่องคืน)
// ==========================================================
router.get('/my-assets', ifNotLoggedIn, async (req, res) => {
    try {
        const userLocation = req.session.user_name; // ดึงชื่อผู้ใช้จาก session

        // ดึงทรัพย์สินทั้งหมดที่อยู่ในความครอบครองของผู้ใช้คนนี้
        const [userAssets] = await dbconnection.execute(
            `SELECT as_asset_number, as_name, as_category, as_serial_number 
             FROM assets 
             WHERE as_location = ?`,
            [userLocation]
        );

        res.render('my_assets', { // เราจะสร้างไฟล์ my_assets.ejs ต่อไป
            assets: userAssets,
            user_name: req.session.user_name,
            role: req.session.role
        });
    } catch (err) {
        console.error("Error fetching user assets:", err);
        res.status(500).send("Server Error");
    }
});


// ==========================================================
//     Route สำหรับ "สร้างใบโอนคืน"
// ==========================================================
router.post('/api/create-return', ifNotLoggedIn, async (req, res) => {
    const { selected_assets, reason } = req.body;
    const createdBy = req.session.userID;

    // --- Validation ---
    if (!reason || reason.trim() === '') {
        return res.status(400).json({ success: false, message: 'กรุณาระบุเหตุผลการคืน' });
    }
    if (!selected_assets || !Array.isArray(selected_assets) || selected_assets.length === 0) {
        return res.status(400).json({ success: false, message: 'กรุณาเลือกทรัพย์สินที่ต้องการคืนอย่างน้อย 1 รายการ' });
    }
    
    // --- เริ่ม Transaction ---
    try {
        await dbconnection.beginTransaction();

        // 1. ตรวจสอบว่าทรัพย์สินที่เลือกมานั้น ไม่มีรายการคืนที่ค้างอยู่ (Pending)
        const placeholders = selected_assets.map(() => '?').join(',');
        const [pendingReturns] = await dbconnection.execute(
            `SELECT as_asset_number FROM asset_transfers 
             WHERE as_asset_number IN (${placeholders}) AND transfer_type = 'return' AND at_status = 'Pending'`,
            selected_assets
        );

        if (pendingReturns.length > 0) {
            const pendingList = pendingReturns.map(p => p.as_asset_number).join(', ');
            await dbconnection.rollback();
            return res.status(400).json({ success: false, message: `ทรัพย์สินบางรายการมีเรื่องขอคืนค้างอยู่แล้ว: ${pendingList}` });
        }

        // 2. สร้างเลขที่ใบโอนใหม่ (ATxxxxx)
        const [lastTransfer] = await dbconnection.execute(
            "SELECT transfer_number FROM asset_transfers ORDER BY transfer_id DESC LIMIT 1"
        );
        let nextNum = 1;
        if (lastTransfer.length > 0) {
            nextNum = parseInt(lastTransfer[0].transfer_number.replace('AT', '')) + 1;
        }
        const newTransferNumber = `AT${String(nextNum).padStart(5, '0')}`;

        // 3. เตรียมข้อมูลสำหรับ INSERT
        const valuesToInsert = selected_assets.map(assetNumber => [
            newTransferNumber,
            null, // req_asset_id เป็น NULL เพราะเป็นการคืน
            assetNumber,
            reason,
            'return', // transfer_type
            'Pending', // at_status
            createdBy
        ]);

        await dbconnection.query(
            `INSERT INTO asset_transfers (transfer_number, req_asset_id, as_asset_number, transfer_reason, transfer_type, at_status, created_by) VALUES ?`,
            [valuesToInsert]
        );
        
        // --- ยืนยัน Transaction ---
        await dbconnection.commit();
        res.status(201).json({ success: true, message: `สร้างใบโอนคืน ${newTransferNumber} สำเร็จ!` });

    } catch (err) {
        await dbconnection.rollback();
        console.error("Error creating return request:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
    }
});

module.exports = router;
