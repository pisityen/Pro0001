const express = require('express');
const router = express.Router();
const dbconnection = require('../database');
const app = express();
const QRCode = require('qrcode');




// จากนั้นค่อยประกาศ route ต่าง ๆ

// Middleware
const isAdmin = (req, res, next) => {
  if (!req.session.isLoggedIn || req.session.role !== 'admin') {
    return res.status(403).send('Access denied. Admins only.');
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

// ดึงข้อมูลทรัพย์สินทั้งหมด (Admin เท่านั้น)
router.get('/asset_management', isAdmin, (req, res) => {
  dbconnection.execute("SELECT * FROM assets")
    .then(([rows]) => res.json(rows))
    .catch(err => res.status(500).json({ error: err.message }));
});


router.get('/create_requests', (req, res) => {
  if (!req.session || !req.session.user_name) {
    // ถ้ายังไม่มี session หรือไม่มี user_name
    return res.redirect('/login');
  }
  // ส่งตัวแปร user_name ไปยัง EJS
  
  res.render('create_requests', { user_name: req.session.user_name,user_id: req.session.userID,role: req.session.role });
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


// Route สำหรับ Create
router.get('/create', ifNotLoggedIn, (req, res) => {
  res.render('create_asset', {
    role: req.session.role,
    user_name: req.session.user_name,
    successMsg: ''
  });
});



router.post('/create', ifNotLoggedIn, async (req, res) => {
  const { name, category, serial_number } = req.body;

  try {
    
    // ดึง asset_number ล่าสุด
    const [rows] = await dbconnection.execute(
      "SELECT as_asset_number FROM assets ORDER BY as_id DESC LIMIT 1"
    );

    let newAssetNumber;

    if (rows.length > 0) {
      // แยกเลขที่อยู่ท้ายสุดของ asset_number เช่น AS00001 -> 1
      const lastNumber = parseInt(rows[0].as_asset_number.replace('AS', ''), 10);
      newAssetNumber = `AS${String(lastNumber + 1).padStart(5, '0')}`; // เพิ่มเลข และเติม 0 ให้ครบ 5 ตัว
    } else {
      // ถ้าไม่มี record ในฐานข้อมูล ให้เริ่มที่ AS00001
      newAssetNumber = 'AS00001';
    }

    

    // เพิ่ม Asset ลงในฐานข้อมูล
    await dbconnection.execute(
      "INSERT INTO assets (as_name, as_category, as_serial_number, as_asset_number) VALUES (?, ?, ?, ?)",
      [name, category, serial_number, newAssetNumber]
    );

    
    return res.render('create_asset', {
      successicon: 'success',
      successtitle: 'สำเร็จ!',
      successMsg: 'เพิ่มทรัพย์สินเรียบร้อยแล้ว!',
      successButton: 'ตกลง!',
      // ถ้าต้องการส่ง role, user_name, หรือค่าอื่นด้วย
      role: req.session.role,
      user_name: req.session.user_name
    });
    
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      // ส่งค่า errorMsg หรือ errorFlag กลับไป
      return res.render('create_asset', {
        successicon: 'warning',
        successtitle: 'ไม่สำเร็จ!',
        successMsg: 'Serial number ซ้ำ!',
        successButton: 'ตกลง!',
        role: req.session.role,
        user_name: req.session.user_name
        // อื่น ๆ
      });
    }
    res.status(500).send('Database error');
  }
});


// router.get('/print_qr/:as_number', async (req, res) => {
//   const { as_number } = req.params;

//   try {
//     const [rows] = await dbconnection.execute(
//       "SELECT * FROM assets WHERE as_asset_number = ?", 
//       [as_number]
//     );

//     if (rows.length === 0) return res.status(404).send("Asset not found");

//     const asset = rows[0];
//     const qrDataURL = await QRCode.toDataURL(as_number); // สร้าง QR จากเลขทรัพย์สิน

//     res.render('print_qr', { asset, qrDataURL });

//   } catch (err) {
//     console.error(err);
//     res.status(500).send('Server error');
//   }
// });


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





// แสดงหน้าแก้ไขข้อมูล
router.get('/edit/:id', ifNotLoggedIn, async (req, res) => {
  const assetId = req.params.id;

  try {
    // ดึงข้อมูลทรัพย์สินตาม ID
    const [rows] = await dbconnection.execute(
      "SELECT * FROM assets WHERE as_id = ?",
      [assetId]
    );

    if (rows.length === 0) {
      return res.status(404).send('Asset not found!');
    }

    res.render('edit_asset', { title: 'Edit Asset', 
      asset: rows[0], 
      user_name: req.session.user_name,
      role: req.session.role});
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error');
  }
});

// อัปเดตข้อมูลทรัพย์สิน
router.post('/edit/:id', ifNotLoggedIn, async (req, res) => {
  const assetId = req.params.id;
  const { name, category, serial_number } = req.body;

  try {
    await dbconnection.execute(
      "UPDATE assets SET as_name = ?, as_category = ?, as_serial_number = ? WHERE as_id = ?",
      [name, category, serial_number, assetId]
    );

    res.redirect('/asset_management');
  } catch (err) {
    console.error(err);
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


router.get('/create_requests', ifNotLoggedIn, (req, res) => {
  res.render('asset_transfers', {
    user_name: req.session.user_name,
    role: req.session.role
  });
  res.render('create_requests', { title: 'Add New Asset' });
});



// ตรวจสอบให้แน่ใจว่าคุณ import/require dbconnection ตรงตามที่ตั้งค่าไว้
// และมี middleware ifNotLoggedIn (หรือใช้ isUser/isAdmin ตามต้องการ)

app.post("/api/asset_requests", /* ifNotLoggedIn, */ async (req, res) => {
  try {

    function ifNotLoggedInAPI(req, res, next) {
      if (!req.session.isLoggedIn) {
        return res.status(401).json({ error: 'Please login first' });
      }
      next();
    }
    

    // ดึงข้อมูลจาก body
    // (หากฝั่ง client ส่งมาเป็น user_id หรือ reason และ items/request_items ให้ปรับตามจริง)
    const { user_id, user_name, reason, request_items } = req.body;

    // ตรวจสอบความถูกต้องของข้อมูล
    if (!user_id || !user_name || !reason || !Array.isArray(request_items) || request_items.length === 0) {
      console.error("Invalid input data:", req.body);
      return res.status(400).json({ error: "Invalid input data" });
    }

    // สร้าง req_asset_id ใหม่จากรายการล่าสุด
    const [rows] = await dbconnection.execute(
      "SELECT req_asset_id FROM asset_requests ORDER BY req_id DESC LIMIT 1"
    );
    let newReqId;
    if (rows.length > 0) {
      const lastNumber = parseInt(rows[0].req_asset_id.replace('AR', ''), 10);
      newReqId = `AR${String(lastNumber + 1).padStart(5, '0')}`;
    } else {
      newReqId = 'AR00001';
    }

    // วันที่ปัจจุบัน
    const now = new Date();

    // INSERT ลงในตาราง asset_requests
    await dbconnection.execute(
      `INSERT INTO asset_requests 
        (req_asset_id, req_user_name, req_user_id, req_request_date, req_status, req_reason, req_admin_comment, req_updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newReqId,         // req_asset_id
        user_name,        // req_user_name
        user_id,          // req_user_id
        now,              // req_request_date
        'Pending',        // req_status
        reason,           // req_reason
        null,             // req_admin_comment (ใส่ null ไว้ก่อน หรือจะส่งจาก client ก็ได้)
        now               // req_updated_at
      ]
    );

    // INSERT ลงในตาราง asset_request_items (ถ้ามี)
    // สมมติคอลัมน์: item_id (PK), req_asset_id, item_name, item_quantity, item_status, item_updated_at
    for (const item of request_items) {
      if (!item.item_name || !item.item_quantity) {
        console.warn("Skipping invalid item:", item);
        continue;
      }

      await dbconnection.execute(
        `INSERT INTO asset_request_items 
          (req_asset_id, item_name, item_quantity, item_status, item_updated_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          newReqId,           // ผูกกับ req_asset_id เดียวกัน
          item.item_name,
          item.item_quantity,
          'Pending',          // เริ่มต้นเป็น Pending
          now
        ]
      );
    }

    return res.status(201).json({
      message: "Request submitted successfully",
      req_asset_id: newReqId
    });

  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).json({ error: "Database error" });
  }
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
