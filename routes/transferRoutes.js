const express = require('express');
const router = express.Router();
const dbconnection = require('../database');

function ifNotLoggedIn(req, res, next) {
  if (!req.session || !req.session.userID) {
    return res.redirect('/login');
  }
  next();
}


router.get('/asset_transfers/:req_asset_id', async (req, res) => {
  try {
    const { req_asset_id } = req.params;

    // 1. ดึงข้อมูลใบเบิกหลักเพื่อแสดงรายละเอียด
    const [requestRows] = await dbconnection.execute(
      "SELECT req_asset_id, req_user_name, req_reason, req_status FROM asset_requests WHERE req_asset_id = ?",
      [req_asset_id]
    );

    if (requestRows.length === 0) {
      return res.status(404).send("ไม่พบใบเบิก");
    }

    // 2. *** จุดสำคัญ: ดึงข้อมูลเฉพาะรายการที่ "อนุมัติแล้ว" และมีจำนวนที่ต้องโอน > 0 ***
    const [approvedItems] = await dbconnection.execute(
      `SELECT item_id, item_name, item_quantity_approved 
       FROM asset_request_items 
       WHERE req_asset_id = ? AND item_status IN ('Approved', 'Partially Approved') AND item_quantity_approved > 0`,
      [req_asset_id]
    );

    // 3. ส่งข้อมูลทั้งหมดไปที่ EJS
    res.render('asset_transfers', { // ตรวจสอบว่าชื่อไฟล์ EJS ของคุณคือ 'asset_transfers.ejs'
      request: requestRows[0],
      items: approvedItems, // ส่งรายการที่อนุมัติแล้วไปในชื่อ 'items'
      user_name: req.session.user_name,
      role: req.session.role,
      // ส่ง req_asset_id ไปด้วยอีกครั้งเพื่อให้ EJS ใช้งานง่าย
      req_asset_id: req_asset_id
    });

  } catch (err) {
    console.error("Error fetching transfer page data:", err);
    res.status(500).send("Database error on transfer page");
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
        `SELECT as_asset_number, as_location FROM assets WHERE as_asset_number IN (${placeholders})`,
        allScannedAssets
    );

    const unavailableAssets = assetsFromDB.filter(asset => asset.as_location !== null);

    if (unavailableAssets.length > 0) {
        const unavailableList = unavailableAssets.map(a => `${a.as_asset_number} (ปัจจุบันอยู่ที่: ${a.as_location})`).join(', ');
        return res.status(400).json({ error: `ทรัพย์สินบางรายการถูกใช้งานแล้วและไม่สามารถโอนได้: ${unavailableList}` });
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




// GET /asset_transfers
router.get('/all_transfers', async (req, res) => {
  try {
    const role = req.session.role;
    const userId = req.session.userID;

    let sql = '';
    let params = [];

    if (role === 'admin') {
      // Admin เห็นทุกอย่าง
      sql = `
        SELECT 
          t.transfer_number,
          t.req_asset_id,
          t.at_status,
          t.transfer_type,
          t.transfer_date,
          c.total_items
        FROM (
          SELECT transfer_number, MAX(transfer_id) AS max_id
          FROM asset_transfers
          GROUP BY transfer_number
        ) AS s
        JOIN asset_transfers t ON t.transfer_number = s.transfer_number AND t.transfer_id = s.max_id
        JOIN (
          SELECT transfer_number, COUNT(as_asset_number) AS total_items
          FROM asset_transfers
          GROUP BY transfer_number
        ) AS c ON c.transfer_number = s.transfer_number
        ORDER BY s.max_id DESC
      `;
    } else {
      // User: ดูได้ทั้งใบเบิกที่ตัวเองขอ และใบคืนที่ตัวเองเป็นคนคืน
      sql = `
        SELECT 
          t.transfer_number,
          t.req_asset_id,
          t.at_status,
          t.transfer_type,
          t.transfer_date,
          c.total_items
        FROM (
          SELECT transfer_number, MAX(transfer_id) AS max_id
          FROM asset_transfers
          GROUP BY transfer_number
        ) AS s
        JOIN asset_transfers t ON t.transfer_number = s.transfer_number AND t.transfer_id = s.max_id
        JOIN (
          SELECT transfer_number, COUNT(as_asset_number) AS total_items
          FROM asset_transfers
          GROUP BY transfer_number
        ) AS c ON c.transfer_number = s.transfer_number
        LEFT JOIN asset_requests ar ON t.req_asset_id = ar.req_asset_id
        WHERE 
          (t.transfer_type = 'request' AND ar.req_user_id = ?)
          OR
          (t.transfer_type = 'return' AND t.created_by = ?)
        ORDER BY s.max_id DESC
      `;
      params = [userId, userId];
    }

    const [rows] = await dbconnection.execute(sql, params);

    res.render('all_transfers', {
      transfers: rows,
      user_name: req.session.user_name,
      role: req.session.role
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});



  




  // ตัวอย่างใน routes/transferRoutes.js
router.get('/transfer_detail/:transfer_number', async (req, res) => {
  try {
    const { transfer_number } = req.params;
    // JOIN asset_transfers กับ assets
    const [rows] = await dbconnection.execute(`
      SELECT 
        t.transfer_number,
        t.req_asset_id,
        t.as_asset_number,
        t.at_status,
        t.transfer_reason,
        t.transfer_date,
        t.admin_comment,
        a.as_name,
        a.as_category,
        a.as_serial_number
      FROM asset_transfers t
      JOIN assets a 
        ON t.as_asset_number = a.as_asset_number
      WHERE t.transfer_number = ?
    `, [transfer_number]);

    if (rows.length === 0) {
      return res.status(404).send("Transfer not found");
    }

    // Render หน้า EJS
    res.render('transfer_detail', {
      transfer_number,
      transferItems: rows,
      user_name: req.session.user_name,
      role: req.session.role
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});





  


// --- API สำหรับ "ยืนยันการรับของทั้งหมด" (ฉบับปรับปรุง) ---
router.post('/api/asset_transfers/receive_all', ifNotLoggedIn, async (req, res) => {
    const { transfer_number } = req.body;
    const recipientUserId = req.session.userID;
    const recipientUserName = req.session.user_name;

    if (!transfer_number) {
        return res.status(400).json({ error: 'ไม่พบหมายเลขใบโอน' });
    }

    // เริ่มต้น Transaction
    await dbconnection.beginTransaction();

    try {
        // 1. ดึงข้อมูลใบโอนและใบเบิกที่เกี่ยวข้อง
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

        // 2. ตรวจสอบสิทธิ์ว่าผู้กดคือคนเดียวกับผู้ขอ
        const originalRequesterId = transfers[0].req_user_id;
        if (originalRequesterId !== recipientUserId) {
            await dbconnection.rollback();
            return res.status(403).json({ error: 'คุณไม่มีสิทธิ์รับของสำหรับใบโอนนี้' });
        }
        
        const req_asset_id = transfers[0].req_asset_id;
        const assetNumbersToUpdate = transfers.map(t => t.as_asset_number);
        const placeholders = assetNumbersToUpdate.map(() => '?').join(',');

        // 3. อัปเดต asset_transfers เป็น 'Completed'
        await dbconnection.execute(
            `UPDATE asset_transfers SET at_status = 'Completed' WHERE transfer_number = ? AND at_status = 'Pending'`,
            [transfer_number]
        );

        // 4. อัปเดต assets ให้มี as_location เป็นชื่อผู้รับ
        await dbconnection.execute(
            `UPDATE assets SET as_location = ? WHERE as_asset_number IN (${placeholders})`,
            [recipientUserName, ...assetNumbersToUpdate]
        );
        
        // *** 5. ส่วนที่เพิ่มเข้ามา: ตรวจสอบและอัปเดตสถานะใบเบิกหลัก (AR) ***
        // นับจำนวนรายการทั้งหมดที่ "อนุมัติ" ในใบเบิกนี้
        const [[{ total_approved }]] = await dbconnection.execute(
            `SELECT SUM(item_quantity_approved) as total_approved 
             FROM asset_request_items 
             WHERE req_asset_id = ? AND item_status IN ('Approved', 'Partially Approved')`,
            [req_asset_id]
        );

        // นับจำนวนรายการทั้งหมดที่ "โอนสำเร็จแล้ว" ในใบเบิกนี้
        const [[{ total_completed }]] = await dbconnection.execute(
            `SELECT COUNT(*) as total_completed 
             FROM asset_transfers 
             WHERE req_asset_id = ? AND at_status = 'Completed'`,
            [req_asset_id]
        );

        // *** จุดที่แก้ไข: เพิ่ม LOG เพื่อตรวจสอบค่า ***
        console.log(`\n--- DEBUGGING AR STATUS UPDATE ---`);
        console.log(`- AR Number: ${req_asset_id}`);
        console.log(`- Total Approved Quantity (จาก asset_request_items): ${total_approved}`);
        console.log(`- Total Completed Transfers (จาก asset_transfers): ${total_completed}`);
        console.log(`- Condition Check: (${total_approved} > 0 && ${total_approved} == ${total_completed}) -> ${total_approved > 0 && total_approved == total_completed}`);
        console.log(`---------------------------------\n`);

        // ถ้าจำนวนที่อนุมัติ เท่ากับ จำนวนที่โอนสำเร็จแล้ว -> ใบเบิกนี้เสร็จสมบูรณ์
        if (total_approved > 0 && total_approved == total_completed) { // ใช้ == เพื่อความยืดหยุ่น
            await dbconnection.execute(
                "UPDATE asset_requests SET req_status = 'Completed' WHERE req_asset_id = ?",
                [req_asset_id]
            );
            console.log(`SUCCESS: สถานะของ AR# ${req_asset_id} ถูกอัปเดตเป็น 'Completed' เรียบร้อยแล้ว`);
        } else {
            console.log(`INFO: สถานะของ AR# ${req_asset_id} จะยังไม่อัปเดตเนื่องจากเงื่อนไขไม่เป็นจริง`);
        }

        // ถ้าทุกอย่างสำเร็จ ให้ Commit
        await dbconnection.commit();

        res.status(200).json({ success: true, message: 'ยืนยันการรับของทั้งหมดเรียบร้อยแล้ว' });

    } catch (err) {
        // ถ้าเกิดข้อผิดพลาด ให้ Rollback
        await dbconnection.rollback();
        console.error("Error receiving all assets:", err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในฝั่งเซิร์ฟเวอร์' });
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
