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
//     Route สำหรับแสดงหน้า "เบิกทรัพย์สิน" (ฉบับอัปเกรด)
// ==========================================================
router.get('/asset_requests', ifNotLoggedIn, async (req, res) => {
    try {
        const role = req.session.role;
        const userId = req.session.userID;
        const { search, status, startDate, endDate } = req.query;

        let params = [];
        let whereConditions = [];

        if (role !== 'admin') {
            whereConditions.push(`ar.req_user_id = ?`);
            params.push(userId);
        }

        if (search) {
            whereConditions.push(`(ar.req_asset_id LIKE ? OR ar.req_user_name LIKE ?)`);
            params.push(`%${search}%`, `%${search}%`);
        }
        if (status) {
            whereConditions.push(`ar.req_status = ?`);
            params.push(status);
        }
        if (startDate) {
            whereConditions.push(`DATE(ar.req_request_date) >= ?`);
            params.push(startDate);
        }
        if (endDate) {
            whereConditions.push(`DATE(ar.req_request_date) <= ?`);
            params.push(endDate);
        }

        // *** จุดที่แก้ไข: เพิ่ม Subquery เพื่อนับจำนวนใบโอนที่ยัง Active อยู่ ***
        let sqlQuery = `
          SELECT 
            ar.req_asset_id,
            ar.req_user_name,
            ar.req_reason,
            ar.req_status,
            ar.req_request_date,
            (SELECT COUNT(*) FROM asset_request_items WHERE req_asset_id = ar.req_asset_id) AS total_items,
            (SELECT COUNT(*) FROM asset_transfers at WHERE at.req_asset_id = ar.req_asset_id AND at.at_status != 'Cancelled') AS active_transfer_count
          FROM asset_requests ar
        `;
        
        if (whereConditions.length > 0) {
          sqlQuery += ` WHERE ${whereConditions.join(' AND ')}`;
        }
        
        sqlQuery += ` ORDER BY ar.req_id DESC`;

        const [requests] = await dbconnection.execute(sqlQuery, params);

        res.render('asset_requests', {
          requests: requests,
          user_name: req.session.user_name,
          role: req.session.role,
          filters: { search, status, startDate, endDate } 
        });

    } catch (err) {
        console.error("Error fetching asset requests:", err);
        res.status(500).send("Database error");
    }
});


// ==========================================================
//     Route สำหรับแสดงหน้าฟอร์ม "สร้างใบเบิก" (พร้อม DEBUG)
// ==========================================================
router.get('/create_request', ifNotLoggedIn, async (req, res) => {
    try {
        console.log("\n--- DEBUG: กำลังเข้าสู่ Route /create_request ---");
        const sql = "SELECT DISTINCT as_category FROM assets WHERE as_category IS NOT NULL AND as_category != '' ORDER BY as_category";
        console.log("--- DEBUG: กำลังจะรันคำสั่ง SQL:", sql);
        
        // ดึงข้อมูลจากฐานข้อมูล
        const [categories] = await dbconnection.execute(sql);

        console.log("--- DEBUG: รันคำสั่ง SQL สำเร็จ ---");
        console.log("--- DEBUG: จำนวนประเภทที่พบ:", categories.length);
        console.log("--- DEBUG: ข้อมูล Categories ที่ได้จาก DB คือ:", categories);
        console.log("------------------------------------------\n");

        res.render('create_requests', {
            categories: categories,
            user_name: req.session.user_name,
            role: req.session.role
        });
    } catch (err) {
        console.error("--- FATAL ERROR in /create_request route ---");
        console.error(err);
        res.status(500).send("Database Error. Please check the server console for details.");
    }
});


// ==========================================================
//     Route สำหรับ "บันทึก" ใบเบิกใหม่ลงฐานข้อมูล
// ==========================================================
router.post('/create_request', ifNotLoggedIn, async (req, res) => {
    const { reason, items } = req.body;
    const userId = req.session.userID;
    const userName = req.session.user_name;

    if (!reason) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุเหตุผลการเบิก' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'กรุณาเพิ่มรายการที่ต้องการเบิกอย่างน้อย 1 รายการ' });
    }
    for (const item of items) {
        if (!item.name || !item.quantity || parseInt(item.quantity, 10) <= 0) {
            return res.status(400).json({ success: false, message: 'ข้อมูลรายการไม่ถูกต้อง' });
        }
    }
    
    try {
        await dbconnection.beginTransaction();

        const [lastRequest] = await dbconnection.execute(
            "SELECT req_asset_id FROM asset_requests ORDER BY req_id DESC LIMIT 1"
        );
        let nextNum = 1;
        if (lastRequest.length > 0) {
            nextNum = parseInt(lastRequest[0].req_asset_id.replace('AR', '')) + 1;
        }
        const newReqAssetId = `AR${String(nextNum).padStart(5, '0')}`;

        await dbconnection.execute(
            `INSERT INTO asset_requests (req_asset_id, req_user_id, req_user_name, req_reason, req_status) VALUES (?, ?, ?, ?, ?)`,
            [newReqAssetId, userId, userName, reason, 'Pending']
        );

        const itemValues = items.map(item => [
            newReqAssetId,
            item.name,
            parseInt(item.quantity, 10)
        ]);

        await dbconnection.query(
            `INSERT INTO asset_request_items (req_asset_id, item_name, item_quantity) VALUES ?`,
            [itemValues]
        );

        await dbconnection.commit();
        res.status(201).json({ success: true, message: `สร้างใบเบิก ${newReqAssetId} สำเร็จ!` });

    } catch (err) {
        await dbconnection.rollback();
        console.error("Error creating asset request:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
    }
});


// ==========================================================
//     Route สำหรับ "ยกเลิกใบเบิก"
// ==========================================================
router.post('/api/asset_requests/:req_asset_id/cancel', ifNotLoggedIn, async (req, res) => {
    const { req_asset_id } = req.params;
    const { role, userID } = req.session;

    try {
        // 1. ดึงข้อมูลใบเบิกปัจจุบันเพื่อตรวจสอบ
        const [requests] = await dbconnection.execute(
            "SELECT req_status, req_user_id FROM asset_requests WHERE req_asset_id = ?",
            [req_asset_id]
        );

        if (requests.length === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบใบเบิกนี้' });
        }
        const request = requests[0];

        // --- Logic การตรวจสอบเงื่อนไข ---
        if (role === 'admin') {
            // Admin สามารถยกเลิกได้ ตราบใดที่ยังไม่มีการสร้างใบโอนที่ Active อยู่
            const [activeTransfers] = await dbconnection.execute(
                "SELECT COUNT(*) as count FROM asset_transfers WHERE req_asset_id = ? AND at_status != 'Cancelled'",
                [req_asset_id]
            );

            if (activeTransfers[0].count > 0) {
                return res.status(403).json({ success: false, message: 'ไม่สามารถยกเลิกได้ เนื่องจากมีการสร้างใบโอนสำหรับใบเบิกนี้แล้ว' });
            }
        } else { // กรณีเป็น User
            // User สามารถยกเลิกได้เฉพาะใบเบิกของตัวเอง และต้องมีสถานะเป็น 'Pending' เท่านั้น
            if (request.req_user_id !== userID) {
                return res.status(403).json({ success: false, message: 'คุณไม่มีสิทธิ์ยกเลิกใบเบิกนี้' });
            }
            if (request.req_status !== 'Pending') {
                return res.status(403).json({ success: false, message: `ไม่สามารถยกเลิกได้ เนื่องจากใบเบิกอยู่ในสถานะ '${request.req_status}'` });
            }
        }

        // 2. ถ้าผ่านเงื่อนไขทั้งหมด ให้อัปเดตสถานะเป็น 'Cancelled'
        await dbconnection.execute(
            "UPDATE asset_requests SET req_status = 'Cancelled' WHERE req_asset_id = ?",
            [req_asset_id]
        );

        res.status(200).json({ success: true, message: `ยกเลิกใบเบิก ${req_asset_id} สำเร็จ` });

    } catch (err) {
        console.error(`Error cancelling request ${req_asset_id}:`, err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
    }
});


module.exports = router;
