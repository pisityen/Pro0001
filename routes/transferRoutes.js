const express = require('express');
const router = express.Router();
const dbconnection = require('../database');

// Middleware (ควรมีอยู่แล้ว)
function ifNotLoggedIn(req, res, next) {
  if (!req.session || !req.session.userID) {
    return res.redirect('/login');
  }
  next();
}

function isAdmin(req, res, next) {
    if (req.session && req.session.role === 'admin') {
      return next();
    }
    res.status(403).send('Access denied. Admins only.');
}




// ==========================================================
//     Route สำหรับแสดงหน้า "ทำใบโอน" (ฉบับอัปเกรด)
// ==========================================================
router.get('/asset_transfers/:req_asset_id', ifNotLoggedIn, isAdmin, async (req, res) => {
  try {
    const { req_asset_id } = req.params;

    // *** ส่วนที่เพิ่มเข้ามา: ตรวจสอบว่ามีใบโอนที่ยังไม่เสร็จสิ้นอยู่หรือไม่ ***
    const [existingTransfers] = await dbconnection.execute(
      `SELECT transfer_number, at_status FROM asset_transfers WHERE req_asset_id = ? AND at_status != 'Cancelled'`,
      [req_asset_id]
    );

    if (existingTransfers.length > 0) {
        // หากมีใบโอนค้างอยู่ ให้แสดงหน้า Error พร้อมข้อความแจ้งเตือน
        return res.status(403).render('error_page', {
            title: 'ไม่สามารถดำเนินการได้',
            message: `ไม่สามารถสร้างใบโอนใหม่ได้ เนื่องจากใบเบิก ${req_asset_id} มีใบโอนที่ยังไม่เสร็จสิ้นอยู่แล้ว (เลขที่: ${existingTransfers[0].transfer_number}, สถานะ: ${existingTransfers[0].at_status})`
        });
    }

    // ถ้าไม่พบใบโอนค้างอยู่ ให้ทำงานต่อไปตามปกติ
    const [requestRows] = await dbconnection.execute("SELECT * FROM asset_requests WHERE req_asset_id = ?", [req_asset_id]);
    if (requestRows.length === 0) return res.status(404).send("ไม่พบใบเบิก");

    const [approvedItems] = await dbconnection.execute(
      `SELECT item_id, item_name, item_quantity_approved FROM asset_request_items WHERE req_asset_id = ? AND item_status IN ('Approved', 'Partially Approved') AND item_quantity_approved > 0`,
      [req_asset_id]
    );

    res.render('asset_transfers', {
      request: requestRows[0],
      items: approvedItems,
      user_name: req.session.user_name,
      role: req.session.role,
      req_asset_id: req_asset_id
    });

  } catch (err) {
    console.error("Error fetching transfer page data:", err);
    res.status(500).send("Database error on transfer page");
  }
});



// ==========================================================
//     Route สำหรับ "Admin" ยกเลิกใบโอน
// ==========================================================
router.post('/api/asset_transfers/:transfer_number/cancel', ifNotLoggedIn, isAdmin, async (req, res) => {
    const { transfer_number } = req.params;

    if (!transfer_number) {
        return res.status(400).json({ success: false, message: 'ไม่พบหมายเลขใบโอน' });
    }

    try {
        // อัปเดตสถานะของทุกรายการในใบโอนนี้ให้เป็น 'Cancelled'
        // โดยมีเงื่อนไขว่าจะต้องเป็นสถานะ 'Pending' เท่านั้น เพื่อป้องกันการยกเลิกใบที่เสร็จสิ้นไปแล้ว
        const [result] = await dbconnection.execute(
            `UPDATE asset_transfers SET at_status = 'Cancelled' WHERE transfer_number = ? AND at_status = 'Pending'`,
            [transfer_number]
        );

        // ตรวจสอบว่ามีการอัปเดตแถวข้อมูลหรือไม่
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'ไม่พบใบโอนที่อยู่ในสถานะ Pending หรือใบโอนนี้อาจถูกจัดการไปแล้ว' });
        }

        res.status(200).json({ success: true, message: `ยกเลิกใบโอน ${transfer_number} สำเร็จ` });

    } catch (err) {
        console.error("Error cancelling transfer:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
    }
});


router.post('/api/asset_transfers/multiple', async (req, res) => {
  try {
    const { req_asset_id, reason, items } = req.body;
    const createdBy = req.session.userID;

    if (!req_asset_id || !items || Object.keys(items).length === 0) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
    }

    const allScannedAssets = Object.values(items).flat();
    if (allScannedAssets.length === 0) {
        return res.status(400).json({ error: 'กรุณาสแกนทรัพย์สินอย่างน้อย 1 รายการ' });
    }
    
    const uniqueAssets = new Set(allScannedAssets);
    if (uniqueAssets.size !== allScannedAssets.length) {
      return res.status(400).json({ error: 'มีหมายเลขทรัพย์สินซ้ำกันในใบโอน' });
    }

    const [approvedItemsFromDB] = await dbconnection.execute(`
      SELECT item_id, item_name, item_quantity_approved 
      FROM asset_request_items 
      WHERE req_asset_id = ? AND item_status IN ('Approved', 'Partially Approved')`, [req_asset_id]);

    for (const itemId in items) {
        const correspondingItem = approvedItemsFromDB.find(dbItem => dbItem.item_id == itemId);
        if (!correspondingItem) {
            return res.status(400).json({ error: `ไม่พบรายการที่อนุมัติสำหรับ Item ID ${itemId} ในใบเบิกนี้` });
        }
        if (items[itemId].length !== correspondingItem.item_quantity_approved) {
            return res.status(400).json({ error: `จำนวนที่สแกนสำหรับ ${correspondingItem.item_name} ไม่ตรงกับจำนวนที่อนุมัติ` });
        }
    }

    const placeholders = allScannedAssets.map(() => '?').join(',');
    const [assetsFromDB] = await dbconnection.execute(
        `SELECT as_asset_number, as_location, as_status FROM assets WHERE as_asset_number IN (${placeholders})`,
        allScannedAssets
    );

    const unavailableAssets = assetsFromDB.filter(asset => asset.as_location !== null || asset.as_status !== 'active');

    if (unavailableAssets.length > 0) {
        const unavailableList = unavailableAssets.map(a => {
            const reason = a.as_status !== 'active' ? `สถานะ: ${a.as_status}` : `อยู่ที่: ${a.as_location}`;
            return `${a.as_asset_number} (${reason})`;
        }).join(', ');
        return res.status(400).json({ error: `ทรัพย์สินบางรายการไม่พร้อมใช้งาน: ${unavailableList}` });
    }

    const [inUseAssets] = await dbconnection.execute(
      `SELECT as_asset_number FROM asset_transfers WHERE as_asset_number IN (${placeholders}) AND at_status NOT IN ('Completed', 'Cancelled')`,
      allScannedAssets
    );

    if (inUseAssets.length > 0) {
      const usedAssetNumbers = inUseAssets.map(r => r.as_asset_number).join(', ');
      return res.status(400).json({ error: `ทรัพย์สินหมายเลข: ${usedAssetNumbers} กำลังถูกใช้งานในใบโอนอื่น` });
    }

    await dbconnection.beginTransaction();

    try {
        // *** จุดที่แก้ไข: เปลี่ยนวิธีการสร้าง Transfer Number ใหม่ทั้งหมด ***
        // 1. ดึง "transfer_number" ล่าสุดออกมาโดยเรียงจาก ID มากไปน้อย
        const [lastTransferRows] = await dbconnection.execute(
            'SELECT transfer_number FROM asset_transfers ORDER BY transfer_id DESC LIMIT 1'
        );

        let nextNumber = 1;
        // 2. ถ้ามีใบโอนก่อนหน้าอยู่แล้ว
        if (lastTransferRows.length > 0) {
            const lastTransferNumber = lastTransferRows[0].transfer_number; // e.g., "AT00001"
            const lastNumberInt = parseInt(lastTransferNumber.replace('AT', ''), 10); // 1
            nextNumber = lastNumberInt + 1; // 2
        }
        
        // 3. สร้างเลขใหม่พร้อมกับ Padding ศูนย์ข้างหน้า
        const newTransferNumber = `AT${String(nextNumber).padStart(5, '0')}`; // "AT00002"

        const transferInsertValues = allScannedAssets.map(assetNumber => [
            newTransferNumber,
            req_asset_id,
            assetNumber,
            reason || null,
            'Request',
            'Pending',
            createdBy
        ]);
        
        await dbconnection.query(
            `INSERT INTO asset_transfers 
            (transfer_number, req_asset_id, as_asset_number, transfer_reason, transfer_type, at_status, created_by) 
            VALUES ?`, [transferInsertValues]
        );

        await dbconnection.commit();

        res.status(201).json({
            message: `สร้างใบโอน ${newTransferNumber} สำเร็จ จำนวน ${allScannedAssets.length} รายการ`,
            transfer_number: newTransferNumber
        });
    } catch (innerError) {
        await dbconnection.rollback();
        throw innerError;
    }

  } catch (err) {
    console.error("Error creating multiple transfers:", err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในฝั่งเซิร์ฟเวอร์' });
  }
});




router.get('/all_transfers', ifNotLoggedIn, async (req, res) => {
  try {
    const role = req.session.role;
    const userId = req.session.userID;

    // ดึงค่าจากฟอร์มค้นหาทั้งหมด
    const { search, type, status, startDate, endDate, assetNumber, assetCategory } = req.query;

    let params = [];
    let whereConditions = [];

    // --- ส่วนของ User ---
    if (role !== 'admin') {
      whereConditions.push(`((t.transfer_type = 'request' AND ar.req_user_id = ?) OR (t.transfer_type = 'return' AND t.created_by = ?))`);
      params.push(userId, userId);
    }

    // --- สร้างเงื่อนไขการกรองแบบไดนามิก ---
    if (search) {
      whereConditions.push(`(t.transfer_number LIKE ? OR t.req_asset_id LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`);
    }
    if (type) {
      whereConditions.push(`t.transfer_type = ?`);
      params.push(type);
    }
    if (status) {
      whereConditions.push(`t.at_status = ?`);
      params.push(status);
    }
    if (startDate) {
        whereConditions.push(`DATE(t.transfer_date) >= ?`);
        params.push(startDate);
    }
    if (endDate) {
        whereConditions.push(`DATE(t.transfer_date) <= ?`);
        params.push(endDate);
    }
    if (assetNumber) {
        whereConditions.push(`EXISTS (SELECT 1 FROM asset_transfers at_sub WHERE at_sub.transfer_number = t.transfer_number AND at_sub.as_asset_number LIKE ?)`);
        params.push(`%${assetNumber}%`);
    }
    if (assetCategory) {
        whereConditions.push(`EXISTS (SELECT 1 FROM asset_transfers at_sub JOIN assets a_sub ON at_sub.as_asset_number = a_sub.as_asset_number WHERE at_sub.transfer_number = t.transfer_number AND a_sub.as_category = ?)`);
        params.push(assetCategory);
    }

    // --- สร้าง SQL Query ---
    let sqlQuery = `
      SELECT 
        t.transfer_number, t.req_asset_id, t.at_status, t.transfer_type, t.transfer_date,
        ar.req_user_name AS requester_name, u.user_name AS creator_name, c.total_items
      FROM (
        SELECT transfer_number, MAX(transfer_id) AS max_id FROM asset_transfers GROUP BY transfer_number
      ) AS latest_transfer
      JOIN asset_transfers t ON t.transfer_number = latest_transfer.transfer_number AND t.transfer_id = latest_transfer.max_id
      JOIN (
        SELECT transfer_number, COUNT(as_asset_number) AS total_items FROM asset_transfers GROUP BY transfer_number
      ) AS c ON c.transfer_number = latest_transfer.transfer_number
      LEFT JOIN asset_requests ar ON t.req_asset_id = ar.req_asset_id
      LEFT JOIN users u ON t.created_by = u.user_id
    `;
    
    if (whereConditions.length > 0) {
      sqlQuery += ` WHERE ${whereConditions.join(' AND ')}`;
    }
    
    sqlQuery += ` ORDER BY latest_transfer.max_id DESC`;

    const [transfers] = await dbconnection.execute(sqlQuery, params);

    // *** ส่วนที่เพิ่มเข้ามา: ดึงรายการประเภททรัพย์สินทั้งหมดมาสร้าง Dropdown ***
    const [assetCategories] = await dbconnection.execute(
        "SELECT DISTINCT as_category FROM assets WHERE as_category IS NOT NULL AND as_category != '' ORDER BY as_category ASC"
    );

    res.render('all_transfers', {
      transfers: transfers,
      assetCategories: assetCategories, // ส่งรายการประเภทไปให้หน้าเว็บ
      user_name: req.session.user_name,
      role: req.session.role,
      filters: { search, type, status, startDate, endDate, assetNumber, assetCategory } 
    });

  } catch (err) {
    console.error("Error fetching all transfers:", err);
    res.status(500).send("Database error");
  }
});



  




router.get('/transfer_detail/:transfer_number', ifNotLoggedIn, async (req, res) => {
  try {
    const { transfer_number } = req.params;

    // *** จุดที่แก้ไข: เพิ่ม t.transfer_type, ar.req_user_name, และ u.user_name เข้าไปใน SELECT ***
    const [rows] = await dbconnection.execute(`
      SELECT 
        t.transfer_number,
        t.req_asset_id,
        t.as_asset_number,
        t.at_status,
        t.transfer_date,
        t.transfer_type,          -- ดึงข้อมูลประเภทใบโอนมาด้วย
        a.as_name,
        a.as_category,
        a.as_serial_number,
        ar.req_user_name,         -- ดึงชื่อผู้ขอเบิกมาด้วย
        u.user_name AS creator_name -- ดึงชื่อผู้สร้างใบโอน (สำหรับใบคืน)
      FROM asset_transfers t
      JOIN assets a ON t.as_asset_number = a.as_asset_number
      LEFT JOIN asset_requests ar ON t.req_asset_id = ar.req_asset_id
      LEFT JOIN users u ON t.created_by = u.user_id
      WHERE t.transfer_number = ?
    `, [transfer_number]);

    if (rows.length === 0) {
      return res.status(404).send("Transfer not found");
    }

    res.render('transfer_detail', {
      transferItems: rows,
      user_name: req.session.user_name,
      role: req.session.role
    });
  } catch (err) {
    console.error("Error fetching transfer detail:", err);
    res.status(500).send("Database error");
  }
});




  

// ==========================================================
//     API สำหรับ "User" ยืนยันการรับของทั้งหมด
// ==========================================================
router.post('/api/asset_transfers/receive_all', ifNotLoggedIn, async (req, res) => {
    const { transfer_number } = req.body;
    const recipientUserId = req.session.userID;
    const recipientUserName = req.session.user_name;

    if (!transfer_number) {
        return res.status(400).json({ error: 'ไม่พบหมายเลขใบโอน' });
    }

    await dbconnection.beginTransaction();
    try {
        const [transfers] = await dbconnection.execute(
            `SELECT t.as_asset_number, t.req_asset_id, r.req_user_id 
             FROM asset_transfers t
             JOIN asset_requests r ON t.req_asset_id = r.req_asset_id
             WHERE t.transfer_number = ? AND t.at_status = 'Pending'`,
            [transfer_number]
        );

        if (transfers.length === 0) {
            await dbconnection.rollback();
            return res.status(404).json({ error: 'ไม่พบรายการที่รอการรับของ' });
        }

        const originalRequesterId = transfers[0].req_user_id;
        if (originalRequesterId !== recipientUserId) {
            await dbconnection.rollback();
            return res.status(403).json({ error: 'คุณไม่มีสิทธิ์รับของสำหรับใบโอนนี้' });
        }
        
        const req_asset_id = transfers[0].req_asset_id;
        const assetNumbersToUpdate = transfers.map(t => t.as_asset_number);
        const placeholders = assetNumbersToUpdate.map(() => '?').join(',');

        await dbconnection.execute(
            `UPDATE asset_transfers SET at_status = 'Completed' WHERE transfer_number = ? AND at_status = 'Pending'`,
            [transfer_number]
        );

        await dbconnection.execute(
            `UPDATE assets SET as_location = ? WHERE as_asset_number IN (${placeholders})`,
            [recipientUserName, ...assetNumbersToUpdate]
        );
        
        const [[{ total_approved }]] = await dbconnection.execute(
            `SELECT SUM(item_quantity_approved) as total_approved FROM asset_request_items WHERE req_asset_id = ?`,
            [req_asset_id]
        );
        const [[{ total_completed }]] = await dbconnection.execute(
            `SELECT COUNT(*) as total_completed FROM asset_transfers WHERE req_asset_id = ? AND at_status = 'Completed'`,
            [req_asset_id]
        );

        if (total_approved > 0 && total_approved == total_completed) {
            await dbconnection.execute(
                "UPDATE asset_requests SET req_status = 'Completed' WHERE req_asset_id = ?",
                [req_asset_id]
            );
        }

        await dbconnection.commit();
        res.status(200).json({ success: true, message: 'ยืนยันการรับของทั้งหมดเรียบร้อยแล้ว' });

    } catch (err) {
        await dbconnection.rollback();
        console.error("Error receiving all assets:", err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
    }
});


// ==========================================================
//     API สำหรับ "Admin" ยืนยันการรับของคืน
// ==========================================================
router.post('/api/asset_transfers/confirm_return', ifNotLoggedIn, isAdmin, async (req, res) => {
    const { transfer_number } = req.body;

    if (!transfer_number) {
        return res.status(400).json({ success: false, message: 'ไม่พบหมายเลขใบโอน' });
    }
    
    try {
        await dbconnection.beginTransaction();
        
        const [assetsToReturn] = await dbconnection.execute(
            "SELECT as_asset_number FROM asset_transfers WHERE transfer_number = ? AND at_status = 'Pending' AND transfer_type = 'return'",
            [transfer_number]
        );

        if (assetsToReturn.length === 0) {
            await dbconnection.rollback();
            return res.status(404).json({ success: false, message: 'ไม่พบรายการที่รอการรับคืนสำหรับใบโอนนี้' });
        }
        
        const assetNumbers = assetsToReturn.map(a => a.as_asset_number);
        const placeholders = assetNumbers.map(() => '?').join(',');

        await dbconnection.execute(
            `UPDATE asset_transfers SET at_status = 'Completed' WHERE transfer_number = ? AND transfer_type = 'return' AND at_status = 'Pending'`,
            [transfer_number]
        );

        await dbconnection.execute(
            `UPDATE assets SET as_location = NULL WHERE as_asset_number IN (${placeholders})`,
            assetNumbers
        );

        await dbconnection.commit();
        res.status(200).json({ success: true, message: `ยืนยันการรับคืนสำหรับใบโอน ${transfer_number} สำเร็จ` });

    } catch (err) {
        await dbconnection.rollback();
        console.error("Error confirming return:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
    }
});




  router.get('/asset_transfers_return/return', async (req, res) => {

    const [assets] = await dbconnection.execute(
      "SELECT * FROM assets WHERE as_location = ?", [req.session.user_name]
    );
    // … load any data you need …
    res.render('asset_transfers_return', {
      /* current locals */
      user_name: req.session.user_name,
      role: req.session.role,
      user_id: req.session.userID,
      assets
      // ← but no role/user_name here
    });
  });
  


// routes/assetRoutes.js (หรือไฟล์ router ของคุณ)
router.get('/asset_transfers_return/assigned', async (req, res) => {
  const user_name = req.session.user_name;     // หรือ req.session.user_name
  try {
    const [rows] = await dbconnection.execute(
      `SELECT 
         as_asset_number,
         as_name,
         as_category,
         as_serial_number,
         as_status
       FROM assets
       WHERE as_location = ?`,
      [user_name]     // ถ้า as_location เก็บ user_name ให้ใส่ req.session.user_name
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});



router.post('/api/asset_transfers/returns', async (req, res) => {

  console.log('✅ รับข้อมูลจากฟอร์ม:', req.body);
  const { user_id, reason, transfer_type, as_asset_numbers } = req.body;

  // 1. ตรวจสอบว่า field สำคัญมีค่าครบไหม
  if (!user_id || !reason || !transfer_type || !Array.isArray(as_asset_numbers)) {
    return res.status(400).json({
      error: 'ข้อมูลไม่ครบ หรือประเภทข้อมูลไม่ถูกต้อง'
    });
  }

  // 2. ตรวจสอบว่า array ว่างไหม
  if (as_asset_numbers.length === 0) {
    return res.status(400).json({
      error: 'กรุณาระบุเลขทรัพย์สินอย่างน้อย 1 รายการ'
    });
  }

  // 3. ตรวจสอบว่าเลข AS ซ้ำกันหรือไม่
  const uniqueAS = new Set(as_asset_numbers);
  if (uniqueAS.size !== as_asset_numbers.length) {
    return res.status(400).json({
      error: 'มีเลขทรัพย์สินที่ซ้ำกันในรายการที่เลือก'
    });
  }

  // ✅ ถ้าผ่านทั้งหมด ให้ดำเนินการต่อ...
  try {
    // ตรวจสอบว่าไม่มี AS ใดอยู่ระหว่างการคืนที่ยังไม่ completed
    const placeholders = as_asset_numbers.map(() => '?').join(',');
    const [inProgress] = await dbconnection.execute(
      `SELECT as_asset_number FROM asset_transfers 
       WHERE as_asset_number IN (${placeholders})
       AND transfer_type = 'return'
       AND at_status = 'Pending'`,
      as_asset_numbers
    );
    console.log('🔎 ทรัพย์สินที่เจอในฐานข้อมูล:', inProgress);

    if (inProgress.length > 0) {
      const dup = inProgress.map(x => x.as_asset_number);
      return res.status(400).json({ error: `มีรายการคืนที่ยังไม่เสร็จสำหรับ AS: ${dup.join(', ')}` });
    }

    // สร้างหมายเลข AT ใหม่
    const [rows] = await dbconnection.execute(
      "SELECT transfer_number FROM asset_transfers ORDER BY transfer_number DESC LIMIT 1"
    );
    let lastNumber = 0;
    if (rows.length > 0) {
      lastNumber = parseInt(rows[0].transfer_number.replace('AT', ''), 10);
    }
    lastNumber++;
    const transferNumber = `AT${String(lastNumber).padStart(5, '0')}`;

    const values = as_asset_numbers.map(asn => [
      transferNumber,
      null,
      asn,
      reason,
      transfer_type,
      'Pending',
      user_id
    ]);
    console.log('📦 กำลังจะ insert values:', values);


    await dbconnection.query(
      `INSERT INTO asset_transfers 
       (transfer_number, req_asset_id, as_asset_number, transfer_reason, transfer_type, at_status, created_by)
       VALUES ?`,
      [values]
    );

    return res.status(201).json({
      message: `สร้างใบโอนคืน ${transferNumber} สำเร็จ`,
      transfer_number: transferNumber
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในฝั่งเซิร์ฟเวอร์' });
  }
});


router.post('/delete/transfer/:id', (req, res) => {
  const transfer_number = req.params.id;
  dbconnection.execute("DELETE FROM asset_transfers WHERE transfer_number = ?", [transfer_number])
    .then(() => res.redirect('/all_transfers'))
    .catch(err => res.status(500).send('Database error'));
});







  module.exports = router;
