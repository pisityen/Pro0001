const express = require('express');
const router = express.Router();
const dbconnection = require('../database');
const app = express();
const QRCode = require('qrcode');




// จากนั้นค่อยประกาศ route ต่าง ๆ

// Middleware
function isAdmin(req, res, next) {
    if (req.session && req.session.role === 'admin') {
        return next();
    }
    res.status(403).render('error', { message: 'Access Denied' }); // หรือ redirect
}

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

// เพิ่มตรงนี้
app.use(express.json());

// ถ้าต้องการ parse form แบบเก่า (urlencoded) ก็ควรมีด้วย
app.use(express.urlencoded({ extended: true }));



// เพิ่มทรัพย์สิน (เฉพาะ Admin)
router.post('/asset_management', isAdmin, (req, res) => {
  const { name, category, serial_number, asset_number, purchase_date, location, responsible_person } = req.body;

  dbconnection.execute(
    "INSERT INTO assets (name, category, serial_number, asset_number, purchase_date, location, responsible_person) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [name, category, serial_number, asset_number, purchase_date, location, responsible_person]
  )
    .then(() => res.status(201).json({ message: 'Asset created successfully.' }))
    .catch(err => res.status(500).json({ error: err.message }));

    
});

// ==========================================================
//     Route สำหรับแสดงหน้า "จัดการทรัพย์สิน" (พร้อมระบบกรองและ DEBUG)
// ==========================================================
router.get('/asset_management', isAdmin, async (req, res) => {
    try {
        // --- DEBUG: แสดงค่าทั้งหมดที่ได้รับจาก Query String ---
        console.log("\n--- DEBUG: Received query parameters ---");
        console.log(req.query);
        console.log("------------------------------------");

        // ดึงค่าจากฟอร์มค้นหา (query parameters)
        const { assetNumber, assetName, assetCategory, serialNumber, location, status } = req.query;

        let params = [];
        let whereConditions = [];

        // สร้างเงื่อนไขการกรองแบบไดนามิก
        if (assetNumber) {
            whereConditions.push(`as_asset_number LIKE ?`);
            params.push(`%${assetNumber}%`);
        }
        if (assetName) {
            whereConditions.push(`as_name LIKE ?`);
            params.push(`%${assetName}%`);
        }
        if (assetCategory) {
            whereConditions.push(`as_category LIKE ?`);
            params.push(`%${assetCategory}%`);
        }
        if (serialNumber) {
            whereConditions.push(`as_serial_number LIKE ?`);
            params.push(`%${serialNumber}%`);
        }
        if (location) {
            if (location.toLowerCase() === 'in_stock') {
                whereConditions.push(`as_location IS NULL`);
            } else {
                whereConditions.push(`as_location LIKE ?`);
                params.push(`%${location}%`);
            }
        }
        if (status) {
            whereConditions.push(`as_status = ?`);
            params.push(status);
        }

        // --- สร้าง SQL Query ---
        let sqlQuery = `SELECT * FROM assets`;
        
        if (whereConditions.length > 0) {
            sqlQuery += ` WHERE ${whereConditions.join(' AND ')}`;
        }
        
        sqlQuery += ` ORDER BY as_id DESC`;

        // --- DEBUG: แสดงคำสั่ง SQL และ Parameters สุดท้ายก่อนรัน ---
        console.log("\n--- DEBUG: Final SQL Query ---");
        console.log("SQL:", sqlQuery);
        console.log("Params:", params);
        console.log("----------------------------\n");

        const [assets] = await dbconnection.execute(sqlQuery, params);

        res.render('asset_management', { // ตรวจสอบว่ามีไฟล์ asset_management.ejs
            assets: assets,
            user_name: req.session.user_name,
            role: req.session.role,
            filters: { assetNumber, assetName, assetCategory, serialNumber, location, status }
        });

    } catch (err) {
        console.error("Error fetching assets:", err);
        res.status(500).send("Database error");
    }
});



// ดึงข้อมูลทรัพย์สินทั้งหมด (Admin เท่านั้น)
router.get('/asset_requests', isAdmin, (req, res) => {
  dbconnection.execute("SELECT * FROM asset_requests")
    .then(([rows]) => res.json(rows))
    .catch(err => res.status(500).json({ error: err.message }));
});

// ดึงข้อมูลทรัพย์สินตาม ID (ผู้ใช้ทุกคน)
router.get('/asset_management/:id', (req, res) => {
  const { id } = req.params;

  dbconnection.execute("SELECT * FROM assets WHERE id = ?", [id])
    .then(([rows]) => {
      if (rows.length === 0) return res.status(404).json({ message: 'Asset not found.' });
      res.json(rows[0]);
    })
    .catch(err => res.status(500).json({ error: err.message }));
});

// แก้ไขข้อมูลทรัพย์สิน (เฉพาะ Admin)
router.put('/asset_management/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  const { name, category, serial_number, asset_number, location, responsible_person } = req.body;

  dbconnection.execute(
    "UPDATE assets SET as_name = ?, as_category = ?, as_serial_number = ?, as_asset_number = ?, as_location = ?, as_responsible_person = ? WHERE as_id = ?",
    [name, category, serial_number, asset_number, location, responsible_person, id]
  )
    .then(() => res.json({ message: 'Asset updated successfully.' }))
    .catch(err => res.status(500).json({ error: err.message }));
});

// ลบทรัพย์สิน (เฉพาะ Admin)
router.delete('/asset_management/:id', isAdmin, (req, res) => {
  const { id } = req.params;

  dbconnection.execute("DELETE FROM assets WHERE id = ?", [id])
    .then(() => res.json({ message: 'Asset deleted successfully.' }))
    .catch(err => res.status(500).json({ error: err.message }));
});

router.get('/asset_management/admin', isAdmin, (req, res) => {
  dbconnection.execute("SELECT * FROM assets")
    .then(([rows]) => res.json(rows))
    .catch(err => res.status(500).json({ error: err.message }));
});


// ==========================================================
//     Route สำหรับแสดงหน้าฟอร์ม "เพิ่มทรัพย์สิน"
// ==========================================================
router.get('/create', ifNotLoggedIn, isAdmin, async (req, res) => {
  try {
    // ดึงรายการประเภททรัพย์สินทั้งหมดที่มีอยู่ เพื่อใช้สร้าง Datalist
    const [categories] = await dbconnection.execute(
        "SELECT DISTINCT as_category FROM assets WHERE as_category IS NOT NULL AND as_category != '' ORDER BY as_category ASC"
    );

    res.render('create_asset', { // ตรวจสอบว่าชื่อไฟล์ EJS ของคุณคือ create_asset.ejs
        categories: categories, 
        user_name: req.session.user_name,
        role: req.session.role
    });
  } catch (err) {
    console.error("Error fetching categories for create asset page:", err);
    res.status(500).send("Database Error");
  }
});


// ==========================================================
//     Route สำหรับ "บันทึก" ทรัพย์สินใหม่ (ฉบับอัปเกรด)
// ==========================================================
router.post('/api/assets/create', ifNotLoggedIn, isAdmin, async (req, res) => {
  // รับข้อมูลทั้งหมดจากฟอร์ม
  const { 
    name, category, serial_number, 
    purchase_date, purchase_price, supplier, warranty_expiry, notes 
  } = req.body;

  // --- Validation (ส่วนที่จำเป็น) ---
  if (!name || !category || !serial_number) {
    return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูล ชื่อ, ประเภท, และ Serial Number' });
  }

  try {
    // 1. สร้างเลขที่ทรัพย์สินใหม่ (ASxxxxx)
    const [rows] = await dbconnection.execute(
      "SELECT as_asset_number FROM assets ORDER BY as_id DESC LIMIT 1"
    );
    let newAssetNumber;
    if (rows.length > 0) {
      const lastNumber = parseInt(rows[0].as_asset_number.replace('AS', ''), 10);
      newAssetNumber = `AS${String(lastNumber + 1).padStart(5, '0')}`;
    } else {
      newAssetNumber = 'AS00001';
    }

    // 2. เตรียมข้อมูลทั้งหมดสำหรับ INSERT (จัดการกับค่าที่อาจเป็น NULL)
    const params = [
        name,
        category.toLowerCase(), // บันทึกเป็นตัวพิมพ์เล็กเสมอ
        serial_number,
        newAssetNumber,
        'active', // สถานะเริ่มต้น
        purchase_date || null,
        purchase_price || null,
        supplier || null,
        warranty_expiry || null,
        notes || null
    ];

    // 3. เพิ่ม Asset ลงในฐานข้อมูล
    await dbconnection.execute(
      `INSERT INTO assets 
       (as_name, as_category, as_serial_number, as_asset_number, as_status, 
        as_purchase_date, as_purchase_price, as_supplier, as_warranty_expiry, as_notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );

    res.status(201).json({ 
        success: true, 
        message: `เพิ่มทรัพย์สินหมายเลข ${newAssetNumber} สำเร็จ!` 
    });
    
  } catch (err) {
    // จัดการกรณี Serial Number ซ้ำ
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Serial Number นี้มีอยู่ในระบบแล้ว' });
    }
    console.error("Error creating asset:", err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
  }
});


// ==========================================================
//     Route สำหรับแสดงหน้าฟอร์ม "เพิ่มทรัพย์สินเป็นชุด"
// ==========================================================
router.get('/assets/create_bulk', ifNotLoggedIn, isAdmin, async (req, res) => {
    try {
        const [categories] = await dbconnection.execute(
            "SELECT DISTINCT as_category FROM assets WHERE as_category IS NOT NULL AND as_category != '' ORDER BY as_category ASC"
        );
        res.render('create_asset_bulk', { // ใช้ไฟล์ ejs ใหม่ที่เราสร้าง
            categories: categories,
            user_name: req.session.user_name,
            role: req.session.role
        });
    } catch (err) {
        console.error("Error fetching categories:", err);
        res.status(500).send("Database Error");
    }
});


// ==========================================================
//     Route สำหรับ "บันทึก" ทรัพย์สินเป็นชุด (Bulk)
// ==========================================================
router.post('/api/assets/create_bulk', ifNotLoggedIn, isAdmin, async (req, res) => {
    const { 
        name, category, serial_numbers,
        purchase_date, purchase_price, supplier, warranty_expiry
    } = req.body;

    // --- Validation ---
    if (!name || !category || !serial_numbers) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลหลัก (ชื่อ, ประเภท, Serial Number) ให้ครบ' });
    }

    // แปลง Textarea เป็น Array ของ Serial Number ที่ไม่ซ้ำและไม่ว่าง
    const serials = [...new Set(serial_numbers.split('\n').map(s => s.trim()).filter(Boolean))];

    if (serials.length === 0) {
        return res.status(400).json({ success: false, message: 'ไม่พบ Serial Number ที่ถูกต้องในรายการ' });
    }

    try {
        // ตรวจสอบว่ามี Serial Number ใดซ้ำกับในฐานข้อมูลหรือไม่
        const placeholders = serials.map(() => '?').join(',');
        const [existingSerials] = await dbconnection.execute(
            `SELECT as_serial_number FROM assets WHERE as_serial_number IN (${placeholders})`,
            serials
        );

        if (existingSerials.length > 0) {
            const duplicates = existingSerials.map(s => s.as_serial_number).join(', ');
            return res.status(400).json({ success: false, message: `Serial Number เหล่านี้มีอยู่ในระบบแล้ว: ${duplicates}` });
        }
        
        await dbconnection.beginTransaction();
        
        const [lastAsset] = await dbconnection.execute("SELECT as_asset_number FROM assets ORDER BY as_id DESC LIMIT 1");
        let nextAssetNum = 1;
        if (lastAsset.length > 0) {
            nextAssetNum = parseInt(lastAsset[0].as_asset_number.replace('AS', '')) + 1;
        }

        const assetsToInsert = serials.map((serial, index) => {
            const newAssetNumber = `AS${String(nextAssetNum + index).padStart(5, '0')}`;
            return [
                name, category.toLowerCase(), serial, newAssetNumber, 'active',
                purchase_date || null, purchase_price || null, supplier || null, warranty_expiry || null
            ];
        });

        await dbconnection.query(
            `INSERT INTO assets 
             (as_name, as_category, as_serial_number, as_asset_number, as_status, 
              as_purchase_date, as_purchase_price, as_supplier, as_warranty_expiry) 
             VALUES ?`,
            [assetsToInsert]
        );

        await dbconnection.commit();

        res.status(201).json({ 
            success: true, 
            message: `เพิ่มทรัพย์สินใหม่จำนวน <strong>${serials.length}</strong> รายการสำเร็จ!` 
        });

    } catch (err) {
        await dbconnection.rollback();
        console.error("Error during bulk asset creation:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในฝั่งเซิร์ฟเวอร์' });
    }
});




router.get('/print_qr', async (req, res) => {
  try {
    const ids = req.query.ids?.split(',') || [];

    if (ids.length === 0) {
      return res.status(400).send('กรุณาระบุพารามิเตอร์ ids');
    }

    // สร้าง placeholder (?, ?, ?, ...)
    const placeholders = ids.map(() => '?').join(',');
    const [assets] = await dbconnection.execute(
      `SELECT * FROM assets WHERE as_asset_number IN (${placeholders})`,
      ids
    );

    // สร้าง QR แต่ละรายการ
    const assetWithQR = await Promise.all(assets.map(async (asset) => {
      const qrDataURL = await QRCode.toDataURL(asset.as_asset_number);
      return {
        ...asset,
        qrDataURL
      };
    }));

    res.render('print_qr_multiple', { assets: assetWithQR });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});


router.get('/assets/print_qr_select', async (req, res) => {
  const [assets] = await dbconnection.execute(
    "SELECT as_asset_number, as_name, as_serial_number FROM assets"
  );
  res.render('print_qr_select', { assets, 
    user_name: req.session.user_name,
    role: req.session.role 
  });
});





// ==========================================================
//     Route สำหรับ "แสดง" หน้าฟอร์มแก้ไขข้อมูล
// ==========================================================
router.get('/assets/edit/:id', ifNotLoggedIn, isAdmin, async (req, res) => {
    try {
        const assetId = req.params.id;

        // 1. ดึงข้อมูลทรัพย์สินตาม ID ที่ต้องการแก้ไข
        const [assetRows] = await dbconnection.execute(
            "SELECT * FROM assets WHERE as_id = ?",
            [assetId]
        );

        if (assetRows.length === 0) {
            return res.status(404).send('Asset not found!');
        }
        const asset = assetRows[0];

        // 2. ดึงรายการประเภททรัพย์สินทั้งหมดเพื่อสร้าง Dropdown
        const [categories] = await dbconnection.execute(
            "SELECT DISTINCT as_category FROM assets WHERE as_category IS NOT NULL AND as_category != '' ORDER BY as_category ASC"
        );
        
        // 3. จัดรูปแบบวันที่ให้อยู่ในฟอร์แมต YYYY-MM-DD เพื่อให้ input type="date" แสดงผลถูกต้อง
        if (asset.as_purchase_date) {
            asset.as_purchase_date = new Date(asset.as_purchase_date).toISOString().split('T')[0];
        }
        if (asset.as_warranty_expiry) {
            asset.as_warranty_expiry = new Date(asset.as_warranty_expiry).toISOString().split('T')[0];
        }

        res.render('edit_asset', {
            asset: asset,
            categories: categories,
            user_name: req.session.user_name,
            role: req.session.role
        });
    } catch (err) {
        console.error("Error fetching asset for edit:", err);
        res.status(500).send('Database error');
    }
});


// ==========================================================
//     Route สำหรับ "บันทึก" การแก้ไขข้อมูล
// ==========================================================
router.post('/assets/edit/:id', ifNotLoggedIn, isAdmin, async (req, res) => {
    try {
        const assetId = req.params.id;
        // รับข้อมูลทั้งหมดจากฟอร์ม
        const {
            name, category, serial_number, status, location,
            purchase_date, purchase_price, supplier, warranty_expiry, notes
        } = req.body;

        // --- Validation (ส่วนที่จำเป็น) ---
        if (!name || !category || !serial_number || !status) {
            // ควรมีการส่งข้อความแจ้งเตือนกลับไปที่หน้าฟอร์ม
            return res.status(400).send('กรุณากรอกข้อมูลที่จำเป็นให้ครบ');
        }

        // เตรียมข้อมูลสำหรับอัปเดต (จัดการค่าว่างให้เป็น NULL)
        const params = [
            name,
            category.toLowerCase(),
            serial_number,
            status,
            location.trim() === '' ? null : location.trim(), // ถ้า location เป็นค่าว่างให้เก็บเป็น NULL
            purchase_date || null,
            purchase_price || null,
            supplier || null,
            warranty_expiry || null,
            notes || null,
            assetId // as_id สำหรับ WHERE clause
        ];

        await dbconnection.execute(
            `UPDATE assets SET 
                as_name = ?, as_category = ?, as_serial_number = ?, as_status = ?, as_location = ?,
                as_purchase_date = ?, as_purchase_price = ?, as_supplier = ?, as_warranty_expiry = ?, as_notes = ?
             WHERE as_id = ?`,
            params
        );

        // เมื่อสำเร็จ ให้กลับไปที่หน้าจัดการทรัพย์สิน
        res.redirect('/asset_management');

    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            // ควรมีการส่งข้อความแจ้งเตือนกลับไป
            return res.status(400).send('Serial Number นี้มีอยู่ในระบบแล้ว');
        }
        console.error("Error updating asset:", err);
        res.status(500).send('Database error');
    }
});


// Route สำหรับ Read
router.get('/', ifNotLoggedIn, (req, res) => {
  dbconnection.execute("SELECT * FROM assets")
    .then(([rows]) => res.render('asset', { assets: rows }))
    .catch(err => res.status(500).send('Database error'));
});


// Route สำหรับ Delete
router.post('/delete/:id', ifNotLoggedIn, (req, res) => {
  const assetId = req.params.id;
  dbconnection.execute("DELETE FROM assets WHERE as_id = ?", [assetId])
    .then(() => res.redirect('/asset_management'))
    .catch(err => res.status(500).send('Database error'));
});

router.post('/delete/asset_requests/:id', ifNotLoggedIn, (req, res) => {
  const assetId = req.params.id;
  dbconnection.execute("DELETE FROM asset_requests WHERE req_id = ?", [assetId])
    .then(() => res.redirect('/asset_requests'))
    .catch(err => res.status(500).send('Database error'));
});

// GET /api/assets/:as_number
router.get('/api/assets/:as_number', async (req, res) => {
  try {
    const { as_number } = req.params;
    const [rows] = await dbconnection.execute(
      "SELECT * FROM assets WHERE as_asset_number = ?",
      [as_number]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});


// --- API สำหรับสร้าง QR Code (GET) ---
router.get('/api/qrcode/:as_number', async (req, res) => {
  try {
    const asNumber = req.params.as_number;
    const qr = await QRCode.toDataURL(asNumber, { errorCorrectionLevel: 'H' });
    const img = Buffer.from(qr.split(',')[1], 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length
    });
    res.end(img);
  } catch (err) {
    console.error('QR Code Error:', err);
    res.status(500).send('Error generating QR');
  }
});



router.get('/my-requests', ifNotLoggedIn, async (req, res) => {
  const user_id = req.session.user_id; // ดึง User ID จาก session

  try {
    const [rows] = await dbconnection.execute(
      "SELECT r.*, a.as_name FROM asset_requests r JOIN assets a ON r.asset_id = a.as_id WHERE r.user_id = ? ORDER BY r.request_date DESC",
      [user_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});








module.exports = router;
