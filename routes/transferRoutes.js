const express = require('express');
const router = express.Router();
const dbconnection = require('../database');


function isAdmin(req, res, next) {
  if (!req.session || req.session.role !== 'admin') {
    return res.status(403).send('Access denied. Admins only.');
  }
  next();
}


const isUser = (req, res, next) => {
  if (!req.session.isLoggedIn || req.session.role !== 'user') {
    return res.status(403).send('Access denied.');
  }
  next();
};

function ifNotLoggedIn(req, res, next) {
  // ถ้าไม่มี session userID → ยังไม่ล็อกอิน
  if (!req.session || !req.session.userID) {
    // ให้ไปหน้า /login
    return res.redirect('/login');
  }
  next();
}

function ifLoggedin(req, res, next) {
  // ถ้ามี session userID → ล็อกอินแล้ว
  if (req.session && req.session.userID) {
    // ให้ไปหน้า /dashboard
    return res.redirect('/dashboard');
  }
  next();
}

// GET /asset_transfers
router.get('/all_transfers', ifNotLoggedIn, async (req, res) => {
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





  


  router.post('/asset_transfers/receive', ifNotLoggedIn, async (req, res) => {
    try {
      const { transfer_number, as_asset_number } = req.body;
      // ดึงชื่อ/ID ของผู้รับ
      const userName = req.session.user_name; // หรือ req.session.user_id
  
      // 1) อัปเดตตาราง assets -> เปลี่ยน location/responsible
      await dbconnection.execute(`
        UPDATE assets
        SET as_location = ?
        WHERE as_asset_number = ?
      `, [userName, as_asset_number]);
  
      // 2) อัปเดต asset_transfers -> เปลี่ยน at_status เป็น 'Completed' เฉพาะแถวนี้
      await dbconnection.execute(`
        UPDATE asset_transfers
        SET at_status = 'Completed'
        WHERE transfer_number = ?
          AND as_asset_number = ?
      `, [transfer_number, as_asset_number]);
  
      // 3) (Optional) เช็คว่ามีรายการ Pending เหลือในใบโอนนี้ไหม
      const [pending] = await dbconnection.execute(`
        SELECT as_asset_number
        FROM asset_transfers
        WHERE transfer_number = ?
          AND at_status = 'Pending'
      `, [transfer_number]);
      if (pending.length === 0) {
        // ไม่มี pending => ใบโอนทั้งหมดเสร็จ
        // ถ้าคุณเก็บสถานะระดับใบโอน (transfer_number) อีกคอลัมน์ เช่น at_master_status 
        // ก็อัปเดตเป็น 'Completed' ได้
      }
  
      // 4) Redirect กลับไปหน้า detail
      res.redirect(`/transfer_detail/${transfer_number}`);
    } catch (err) {
      console.error(err);
      res.status(500).send("Database error");
    }
  });
  




  router.get('/asset_transfers/return', ifNotLoggedIn, async (req, res) => {

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
router.get('/asset_transfers_return/assigned', ifNotLoggedIn, async (req, res) => {
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
      "SELECT transfer_number FROM asset_transfers ORDER BY transfer_id DESC LIMIT 1"
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


router.post('/delete/transfer/:id', ifNotLoggedIn, (req, res) => {
  const transfer_number = req.params.id;
  dbconnection.execute("DELETE FROM asset_transfers WHERE transfer_number = ?", [transfer_number])
    .then(() => res.redirect('/all_transfers'))
    .catch(err => res.status(500).send('Database error'));
});







  module.exports = router;
