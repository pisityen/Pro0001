const express = require('express');
const router = express.Router();
const dbconnection = require('../database');
const bcrypt = require('bcrypt');

// Middleware ตรวจสอบว่าเป็น Admin หรือไม่
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

router.get('/account',isAdmin, ifNotLoggedIn, async (req, res) => {
    try {
      const [rows] = await dbconnection.execute("SELECT * FROM users");
      res.render('account', { account: rows ,
        user_name: req.session.user_name,
        role: req.session.role});
    } catch (err) {
      console.error(err);
      res.status(500).send("Database error");
    }
  });

  

// 2) แสดงฟอร์มสร้างผู้ใช้ (GET /users/create)
router.get('/account/create', isAdmin,ifNotLoggedIn, (req, res) => {
  res.render('create_account', {
    user_name: req.session.user_name,
    role: req.session.role});
});

// 2.1) รับข้อมูลจากฟอร์มสร้างผู้ใช้ (POST /users/create)
router.post('/account/create', isAdmin,ifNotLoggedIn, async (req, res) => {
  try {

    res.render('create_account', {
      user_name: req.session.user_name,
      role: req.session.role});

    const { first_name, last_name, user_department, user_name, user_email, user_password, role } = req.body;
    // Hash password
    const hashedPassword = await bcrypt.hash(user_password, 10);
    // Insert DB
    await dbconnection.execute(
      `INSERT INTO users (first_name, last_name, user_department, user_name, user_email, user_password, role)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [first_name, last_name, user_department, user_name, user_email, hashedPassword, role || 'user']
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});

// 3) แสดงฟอร์มแก้ไขผู้ใช้ (GET /users/edit/:id)
router.get('/account/edit/:id',ifNotLoggedIn, isAdmin, async (req, res) => {
  try {
    const [rows] = await dbconnection.execute(
      "SELECT * FROM users WHERE user_id = ?",
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).send("User not found");
    }
    res.render('edit_account', { user: rows[0] , 
      user_name: req.session.user_name,
      role: req.session.role});
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});

// 3.1) รับข้อมูลจากฟอร์มแก้ไขผู้ใช้ (POST /users/edit/:id)
router.post('/account/edit/:id', isAdmin, async (req, res) => {
  try {
    const { first_name, last_name, user_department, user_name, user_email, user_password, role } = req.body;
    // ถ้าต้องการเปลี่ยน password ให้ hash ใหม่
    let updateSql = "";
    let params = [];
    if (user_password) {
      const hashed = await bcrypt.hash(user_password, 10);
      updateSql = "UPDATE users SET first_name = ?, last_name = ?, user_department = ?, user_name = ?, user_email = ?, user_password = ?, role = ? WHERE user_id = ?";
      params = [first_name, last_name, user_department, user_name, user_email, hashed, role, req.params.id];
    } else {
      updateSql = "UPDATE users SET first_name = ?, last_name = ?, user_department = ?, user_name = ?, user_email = ?, role = ? WHERE user_id = ?";
      params = [first_name, last_name, user_department, user_name, user_email, role, req.params.id];
    }
    await dbconnection.execute(updateSql, params);
    res.redirect('/account');
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});

// 4) ลบผู้ใช้ (POST /users/delete/:id)
router.post('/account/delete/:id', isAdmin, async (req, res) => {
  try {
    await dbconnection.execute(
      "DELETE FROM users WHERE user_id = ?",
      [req.params.id]
    );
    res.redirect('/account');
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});

module.exports = router;
