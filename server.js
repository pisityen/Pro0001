const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const dbconnection = require('./database');
const { body, validationResult } = require('express-validator');
const QRCode = require('qrcode');


const app = express();
const port = 5000;


app.use(express.json());
app.use(express.urlencoded({ extended: false }));


app.set('views',path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// app.set('views', './views');



// ตั้งค่า session
app.use(session({
  secret: 'mysecret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3 * 60 * 60 * 1000 } // 1 ชม.
}));

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



app.use((req, res, next) => {
  console.log('Session data:', req.session);
  next();
});




app.get('/', ifNotLoggedIn, (req, res, next) => {
    if (!req.session.userID) {
      return res.redirect('login'); // หากไม่มี Session ให้ Redirect ไปหน้า Login
    }
    dbconnection.execute("SELECT user_name FROM users WHERE user_id = ?", [req.session.userID])
      .then(([rows]) => {
        if (rows.length === 0) {
          return res.render('dashboard', { name: 'User not found' });
        }
        res.render('dashboard', { name: rows[0].user_name });
      })
      .catch(err => {
        console.error('Database Error:', err);
        res.status(500).send('Something went wrong with the database.');
      });
  });
  


app.post('/login', async (req, res) => {
  try {
    const { user_email, password } = req.body;

    // 1. ดึงข้อมูล user
    const [rows] = await dbconnection.execute(
      "SELECT * FROM users WHERE user_email = ?",
      [user_email]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Email not found' });
    }
    const user = rows[0];

    // 2. เปรียบเทียบรหัสผ่าน
    const match = await bcrypt.compare(password, user.user_password);
    if (!match) {
      return res.status(400).json({ error: 'Incorrect password' });
    }

    // 3. สร้าง session
    req.session.userID = user.user_id;
    req.session.user_name = user.user_name;
    req.session.role = user.role;

    // 4. อัปเดต last_login (ถ้ามี)
    await dbconnection.execute(
      "UPDATE users SET last_login = NOW() WHERE user_id = ?",
      [user.user_id]
    );

    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/qrcode/:as_number', async (req, res) => {
  try {
    const asNumber = req.params.as_number;
    const qr = await QRCode.toDataURL(asNumber);  // สร้าง base64

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


// Register User พร้อม Role
app.post('/register', ifLoggedin,
  [
    body('data_email', 'Invalid email address!').isEmail().custom((value) => {
      return dbconnection.execute('SELECT `user_email` FROM `users` WHERE `user_email`= ?', [value])
        .then(([rows]) => {
          if (rows.length > 0) {
            return Promise.reject('This E-mail already in use!');
          }
          return true;
        });
    }),
    body('data_name', 'Username is Empty!').trim().not().isEmpty(),
    body('data_pass', 'The password must be of minimum length 6 characters').trim().isLength({ min: 6 }),
  ],
  (req, res, next) => {
    const validation_result = validationResult(req);
    const { data_name, data_pass, data_email } = req.body;

    if (validation_result.isEmpty()) {
      bcrypt.hash(data_pass, 12).then((hash_pass) => {
        dbconnection.execute(
          "INSERT INTO `users`(`user_name`, `user_email`, `user_password`, `role`) VALUES(?, ?, ?, ?)",
          [data_name, data_email, hash_pass, 'user']
        )
          .then(result => {
            res.send(`Your account has been created successfully. Now you can <a href="/">Login</a>.`);
          }).catch(err => { throw err; });
      }).catch(err => { throw err; });
    } else {
      let allErrors = validation_result.errors.map((error) => error.msg);
      res.render('register', { register_error: allErrors, old_data: req.body });
    }
  });
//   END OF REGISTER PAGE






// api
const assetRoutes = require('./routes/assets'); // เส้นทางไฟล์ asset API
app.use('/assets', assetRoutes); // เส้นทางเริ่มต้นสำหรับ asset API
const userRoutes = require('./routes/userRoutes'); // เส้นทางไฟล์ asset API
app.use('/', userRoutes); 
const transferRoutes = require('./routes/transferRoutes'); // สมมติแยก
const { Admin } = require('mongodb');
app.use('/', transferRoutes); 







// LOGOUT
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Logout error' });
    }
    res.clearCookie('connect.sid'); // หรือแล้วแต่การตั้งค่าคุกกี้
    res.redirect('/login');        // หรือส่ง JSON กลับ
  });
});

// END OF LOGOUT

// app.use('/', (req,res) => {
//     res.status(404).send('<h1>404 Page Not Found!</h1>');
// });



// // ตั้งค่า EJS เป็น Template Engine
// app.set('view engine', 'ejs');
// app.set('views', './views'); // ระบุโฟลเดอร์ views

// ทำให้ไฟล์ใน public สามารถเข้าถึงได้
app.use(express.static('public'));

// Routes (แต่ละ Route จะเชื่อมโยงกับหน้า HTML)

app.get('/dashboard', async (req, res) => {
  try {
    const [latestTransfers] = await dbconnection.execute(`
      SELECT 
        t.transfer_number,
        t.transfer_type,
        t.transfer_date,
        t.at_status,
        u.user_name AS created_by_name
      FROM asset_transfers t
      JOIN (
        SELECT transfer_number, MAX(transfer_id) AS max_id
        FROM asset_transfers
        GROUP BY transfer_number
      ) AS latest ON latest.transfer_number = t.transfer_number AND latest.max_id = t.transfer_id
      LEFT JOIN users u ON t.created_by = u.user_id
      WHERE t.transfer_type = 'request'
      ORDER BY t.transfer_date DESC
      LIMIT 10
    `);

    const [latestReturns] = await dbconnection.execute(`
      SELECT 
        t.transfer_number,
        t.transfer_type,
        t.transfer_date,
        t.at_status,
        u.user_name AS created_by_name
      FROM asset_transfers t
      JOIN (
        SELECT transfer_number, MAX(transfer_id) AS max_id
        FROM asset_transfers
        WHERE transfer_type = 'return'
        GROUP BY transfer_number
      ) AS latest 
        ON t.transfer_number = latest.transfer_number 
        AND t.transfer_id = latest.max_id
      LEFT JOIN users u 
        ON t.created_by = u.user_id
      ORDER BY t.transfer_date DESC
      LIMIT 10;
    `);

    const [pendingTransfers] = await dbconnection.execute(`
      SELECT 
        t.transfer_number,
        t.transfer_type,
        t.transfer_date,
        t.at_status,
        u.user_name AS created_by_name
      FROM asset_transfers t
      JOIN (
        SELECT transfer_number, MAX(transfer_id) AS max_id
        FROM asset_transfers
        WHERE at_status = 'Pending'
        GROUP BY transfer_number
      ) AS latest 
        ON t.transfer_number = latest.transfer_number 
        AND t.transfer_id = latest.max_id
      LEFT JOIN users u 
        ON t.created_by = u.user_id
      ORDER BY t.transfer_date DESC
      LIMIT 10;
    `);

    const [[{ requestCount }]] = await dbconnection.execute(`
      SELECT COUNT(DISTINCT transfer_number) AS requestCount
      FROM asset_transfers WHERE transfer_type = 'request'
    `);

    const [[{ returnCount }]] = await dbconnection.execute(`
      SELECT COUNT(DISTINCT transfer_number) AS returnCount
      FROM asset_transfers WHERE transfer_type = 'return'
    `);

    const [[{ pendingCount }]] = await dbconnection.execute(`
      SELECT COUNT(DISTINCT transfer_number) AS pendingCount
      FROM asset_transfers WHERE at_status = 'Pending'
    `);

    const [[{ assetCount }]] = await dbconnection.execute(`
      SELECT COUNT(*) AS assetCount FROM assets
    `);


    // Monthly Chart Data (Bar)
    const [monthlyData] = await dbconnection.execute(`
      SELECT 
        DATE_FORMAT(transfer_date, '%Y-%m') AS month,
        SUM(CASE WHEN transfer_type = 'request' THEN 1 ELSE 0 END) AS requestCount,
        SUM(CASE WHEN transfer_type = 'return' THEN 1 ELSE 0 END) AS returnCount
      FROM asset_transfers
      GROUP BY month
      ORDER BY month ASC
    `);

    const monthLabels = monthlyData.map(row => row.month);
    const monthRequestCounts = monthlyData.map(row => row.requestCount);
    const monthReturnCounts = monthlyData.map(row => row.returnCount);



    res.render('dashboard', {
      user_name: req.session.user_name,
      role: req.session.role,
      stats: {
        requestCount: requestCount,      // จำนวนการเบิก
        returnCount: returnCount,    // จำนวนการคืน
        pendingCount: pendingCount,    // จำนวนที่ยัง Pending
        assetCount: assetCount, // จำนวนทรัพย์สินทั้งหมด
        monthLabels,
        monthRequestCounts,
        monthReturnCounts
      },
      latestTransfers: latestTransfers,
      latestReturns: latestReturns,
      pendingTransfers: pendingTransfers
    });
  }
  
  catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
  
});




// app.get('/dashboard', (req, res) => {
//   res.render('dashboard', { title: 'dashboard' });
// });

app.get('/asset_management',isAdmin, ifNotLoggedIn, (req, res) => {
  // ดึงข้อมูลทรัพย์สินจากฐานข้อมูล
  dbconnection.execute("SELECT * FROM assets")
    .then(([rows]) => {
      res.render('asset_management', { assets: rows, user_name: req.session.user_name,
        role: req.session.role}); // ส่งข้อมูล assets ไปยัง EJS
    })
    .catch(err => {
      console.error(err);
      res.status(500).send('Database error');
    });
});

app.get('/asset_requests', ifNotLoggedIn, (req, res) => {
  const role = req.session.role;       // ดึง role จาก session
  const userID = req.session.userID;  // ดึง user_id จาก session (ต้องมั่นใจว่ามีเก็บหลังล็อกอิน)

  let sql = "";
  let params = [];
  
  if (role === 'admin') {
    // admin เห็นทั้งหมด
    sql = "SELECT * FROM asset_requests";
  } else {
    // user เห็นเฉพาะของตัวเอง
    sql = "SELECT * FROM asset_requests WHERE req_user_id = ?";
    params = [userID]
  }
  
  dbconnection.execute(sql, params)  // <-- ตรงนี้ใช้ params ไม่ต้องใส่ [params]
    .then(([rows]) => {
      res.render('asset_requests.EJS', { 
        assets: rows,
        user_name: req.session.user_name,
        role: req.session.role
      });
    })
    .catch(err => {
      console.error(err);
      res.status(500).send('Database error');
    });
});







// Route สำหรับอนุมัติ/ปฏิเสธใบงาน
app.post('/api/asset_requests/:req_id/approve', isAdmin, async (req, res) => {
  try {
    const { req_id } = req.params;
    const { action, admin_comment } = req.body; 
    // action อาจเป็น 'Approved' หรือ 'Rejected'

    if (!['Approved', 'Rejected'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    await dbconnection.execute(
      `UPDATE asset_requests
       SET req_status = ?, req_admin_comment = ?
       WHERE req_id = ?`,
      [action, admin_comment || null, req_id]
    );

    return res.json({ message: `Request ${action} successfully.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error' });
  }
});


app.get('/asset_requests/:req_asset_id/items', async (req, res) => {
  try {
    const req_asset_id = req.params.req_asset_id;

    // 1) ดึงข้อมูลใบงาน (asset_requests) เฉพาะ req_asset_id นี้
    const [reqRows] = await dbconnection.execute(
      "SELECT * FROM asset_requests WHERE req_asset_id = ?",
      [req_asset_id]
    );
    if (reqRows.length === 0) {
      return res.status(404).send("Request not found");
    }
    const request = reqRows[0];

    // 2) ดึงข้อมูลรายการ (asset_request_items)
    const [itemRows] = await dbconnection.execute(
      "SELECT * FROM asset_request_items WHERE req_asset_id = ?",
      [req_asset_id]
    );

    // 3) Render หน้า asset_request_items.EJS
    res.render('asset_request_items', {
      request: request,
      items: itemRows,
      user_name: req.session.user_name,
      role: req.session.role
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});



// ฟังก์ชันเช็คสถานะรวม
async function updateRequestStatus(req_asset_id) {
  // ดึง item_status ทั้งหมดของ req_id
  const [rows] = await dbconnection.execute(
    `SELECT item_status FROM asset_request_items WHERE req_asset_id = ?`,
    [req_asset_id]
  );

  const statuses = rows.map(r => r.item_status);

  let newStatus = 'Pending';
  if (statuses.every(s => s === 'Rejected')) {
    newStatus = 'Rejected';
  } else if (statuses.every(s => s === 'Approved')) {
    newStatus = 'Approved';
  } else if (statuses.some(s => s === 'Approved')) {
    // บางส่วน approved, บางส่วน pending/rejected
    newStatus = 'Partially Approved';
  }

  await dbconnection.execute(
    `UPDATE asset_requests
     SET req_status = ?
     WHERE req_asset_id = ?`,
    [newStatus, req_asset_id]
  );
}

// เรียกใช้หลังอนุมัติ item
app.post('/api/asset_request_items/:item_id/approve', isAdmin, async (req, res) => {
  try {
    const { item_id } = req.params;
    const { action, admin_comment, req_asset_id  } = req.body;

    if (!['Approved','Rejected'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    await dbconnection.execute(
      `UPDATE asset_request_items
       SET item_status = ?, item_admin_comment = ?
       WHERE item_id = ?`,
      [action, admin_comment || null, item_id]
    );

    // อัปเดตสถานะใบงานรวม
    await updateRequestStatus(req_asset_id);

    res.json({ message: 'Item updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});




// **API: สร้างคำขอเบิกของ**
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






app.post('/api/asset_transfers', async (req, res) => {
  try {
    const { req_asset_id, as_asset_number, reason } = req.body;

    // 1) เช็คว่ามี AT ที่ค้างอยู่ไหม
    const [existing] = await dbconnection.execute(
      "SELECT * FROM asset_transfers WHERE req_asset_id = ? AND at_status = 'Pending'",
      [req_asset_id]
    );
    if (existing.length > 0) {
      return res.status(400).json({
        error: `Cannot create new AT for ${req_asset_id} because an existing transfer is still Pending.`
      });
    }

    // 2) สร้างเลข ATxxxxx ต่อจากตัวล่าสุด
    const [rows] = await dbconnection.execute(
      "SELECT transfer_number FROM asset_transfers ORDER BY transfer_id DESC LIMIT 1"
    );
    let newTransferNumber;
    if (rows.length > 0) {
      const lastNum = parseInt(rows[0].transfer_number.replace('AT',''),10);
      newTransferNumber = `AT${String(lastNum+1).padStart(5,'0')}`;
    } else {
      newTransferNumber = 'AT00001';
    }

    // 3) Insert ลงตาราง asset_transfers (at_status = 'Pending' เป็นค่าเริ่มต้น)
    await dbconnection.execute(
      `INSERT INTO asset_transfers 
         (transfer_number, req_asset_id, as_asset_number, transfer_reason, at_status)
       VALUES (?, ?, ?, ?, 'Pending')`,
      [newTransferNumber, req_asset_id, as_asset_number, reason || null]
    );

    res.status(201).json({
      message: `Asset transfer ${newTransferNumber} created for ${req_asset_id}.`,
      transfer_number: newTransferNumber
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'dr' });
  }
});


// POST /api/asset_transfers/:transfer_id/receive
app.post('/api/asset_transfers/:transfer_id/receive', async (req, res) => {
  try {
    const { transfer_id } = req.params;
    // อัปเดต at_status เป็น 'Received'
    await dbconnection.execute(
      "UPDATE asset_transfers SET at_status = 'Received' WHERE transfer_id = ?",
      [transfer_id]
    );
    res.json({ message: `Transfer ${transfer_id} is now Received.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/asset_transfers/:transfer_id/cancel
app.post('/api/asset_transfers/:transfer_id/cancel', async (req, res) => {
  try {
    const { transfer_id } = req.params;
    // อัปเดต at_status เป็น 'Cancelled'
    await dbconnection.execute(
      "UPDATE asset_transfers SET at_status = 'Cancelled' WHERE transfer_id = ?",
      [transfer_id]
    );
    res.json({ message: `Transfer ${transfer_id} is now Cancelled.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});




// ตัวอย่างใน router.js หรือ server.js
app.get('/asset_transfers/:req_asset_id', isAdmin, async (req, res) => {
  try {
    const { req_asset_id } = req.params;
    // ดึงรายการ items จาก DB เช่น asset_request_items
    const [rows] = await dbconnection.execute(
      "SELECT item_name, item_quantity FROM asset_request_items WHERE req_asset_id = ? AND item_status = 'Approved'",
      [req_asset_id]
    );
    // ส่ง rows ให้ EJS ในชื่อ items
    res.render('asset_transfers', {
      req_asset_id,
      items: rows,
      user_name: req.session.user_name,
      role: req.session.role
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Database errordada");
  }
});




app.post('/api/asset_transfers/multiple', isAdmin, async (req, res) => {
  try {
    const { req_asset_id, reason, items } = req.body;
    const allAS = Object.values(items).flat();

    // ตรวจสอบว่าไม่มี AS ซ้ำ
    const seen = new Set();
    const dup = allAS.find(as => {
      if (seen.has(as)) return true;
      seen.add(as);
      return false;
    });
    if (dup) {
      return res.status(400).json({ error: `เลขทรัพย์สินซ้ำ: ${dup}` });
    }

    // ดึงรายการที่ผู้ใช้ขอใน AR
    const [requestedItems] = await dbconnection.execute(`
      SELECT item_id, item_quantity, item_name 
      FROM asset_request_items 
      WHERE req_asset_id = ?`, [req_asset_id]);

    // Map item_id → item_name, quantity
    const itemIdToName = {};
    const itemNameMap = {};
    requestedItems.forEach(row => {
      itemIdToName[row.item_id] = row.item_name;
      itemNameMap[row.item_name] = {
        item_id: row.item_id,
        quantity: row.item_quantity,
        count: 0
      };
    });

    // ดึงข้อมูล AS จริง
    const placeholders = allAS.map(() => '?').join(',');
    const [assets] = await dbconnection.execute(
      `SELECT as_asset_number, as_category 
       FROM assets 
       WHERE as_asset_number IN (${placeholders})`, allAS);

    // ตรวจสอบแต่ละ item_id
    for (const [item_id, asList] of Object.entries(items)) {
      const expectedName = itemIdToName[item_id];
      if (!expectedName) {
        return res.status(400).json({ error: `ไม่พบ item_id ${item_id} ในใบ AR` });
      }

      for (const as_number of asList) {
        const asset = assets.find(a => a.as_asset_number === as_number);
        if (!asset) {
          return res.status(400).json({ error: `ไม่พบ AS ${as_number}` });
        }
        if (asset.as_category !== expectedName) {
          return res.status(400).json({ 
            error: `AS ${as_number} ประเภท ${asset.as_category} ไม่ตรงกับที่ขอ (${expectedName})` 
          });
        }
      }

      if (asList.length > itemNameMap[expectedName].quantity) {
        return res.status(400).json({
          error: `รายการ ${expectedName} เกินจำนวนที่ขอ (ขอ ${itemNameMap[expectedName].quantity}, ใส่ ${asList.length})`
        });
      }

      itemNameMap[expectedName].count += asList.length;
    }

    // ตรวจสอบว่า AS ถูกใช้ใน AT ที่ยังไม่เสร็จ
    const [inUse] = await dbconnection.execute(
      `SELECT as_asset_number 
       FROM asset_transfers 
       WHERE as_asset_number IN (${placeholders}) 
       AND at_status NOT IN ('Completed','Cancelled')`, allAS);

    if (inUse.length > 0) {
      const used = inUse.map(r => r.as_asset_number).join(', ');
      return res.status(400).json({ error: `AS ที่ถูกใช้งานแล้ว: ${used}` });
    }

    // สร้างเลข AT ใหม่
    const [[{ max }]] = await dbconnection.execute(
      'SELECT MAX(transfer_id) AS max FROM asset_transfers');
    const newTransferNumber = `AT${String((max || 0) + 1).padStart(5, '0')}`;
    const createdBy = req.session.userID;

    // เตรียม insert
    const insertValues = [];
    for (const [item_id, asList] of Object.entries(items)) {
      for (const as_number of asList) {
        insertValues.push([
          newTransferNumber,
          req_asset_id,
          as_number,
          reason || null,
          'Pending',
          createdBy
        ]);
      }
    }

    await dbconnection.query(`
      INSERT INTO asset_transfers 
        (transfer_number, req_asset_id, as_asset_number, transfer_reason, at_status, created_by) 
      VALUES ?`, [insertValues]);

    res.status(201).json({
      message: `สร้างใบโอน ${newTransferNumber} สำเร็จ จำนวน ${insertValues.length} รายการ`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในฝั่งเซิร์ฟเวอร์' });
  }
});










app.get("/api/asset_requests", async (req, res) => {
  try {
    const [requests] = await db.execute(
      "SELECT ar.id, ar.user_id, ar.reason, ar.status, ar.request_date, GROUP_CONCAT(ari.item_name, ' (', ari.item_quantity, ')') AS items FROM asset_requests ar JOIN asset_request_items ari ON ar.id = ari.request_id GROUP BY ar.id"
    );

    res.render('asset_transfers', {
      user_name: req.session.user_name,
      role: req.session.role
    });

    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// **แสดงหน้าเว็บฟอร์มเบิกของ**
app.get("/asset_requests", async (req, res) => {
  try {
    res.render("asset_requests");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading page");
  }
});

app.get('/create_requests', (req, res) => {
  // สมมติ req.session.user_name มีค่าจากตอนล็อกอิน
  const user_name = req.session.user_name; 
  const user_id = req.session.userID; 

  res.render('create_requests', {
    user_name: req.session.user_name,
    role: req.session.role
  });
  res.render('create_requests', { user_name, user_id });
});


app.get('/register', ifLoggedin, (req, res) => {
  res.render('register');
});
app.get('/login', ifLoggedin, (req, res) => {
  res.render('login');
});


// สมมติว่าประกาศตรง ๆ ใน server.js
app.get('/asset_requests/:req_asset_id/items', isAdmin, (req, res) => {
  // ...
  res.render('asset_request_items');
});

app.get('/asset_transfers', isAdmin, (req, res) => {
  // ...
  res.render('asset_transfers');
});
// app.get('/print_qr', isAdmin, (req, res) => {
//   // ...
//   res.render('print_qr');
// });

app.get('/account', isAdmin,(req, res) => {
  // ...
  res.render('account');
});


// Start Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
