const express = require('express');
const router = express.Router();
const dbconnection = require('../database');
const bcrypt = require('bcrypt');

// Middleware ตรวจสอบว่าเป็น Admin หรือไม่
function isAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  res.status(403).send('Access denied. Admins only.');
}

function ifNotLoggedIn(req, res, next) {
  if (req.session && req.session.userID) {
    return next();
  }
  res.redirect('/login');
}

// ==========================================================
//     Route สำหรับแสดงหน้า "จัดการบัญชีผู้ใช้" (พร้อมระบบกรอง)
// ==========================================================
router.get('/account', ifNotLoggedIn, isAdmin, async (req, res) => {
    try {
        const { search, role, status } = req.query;
        let params = [];
        let whereConditions = [];

        // สร้างเงื่อนไขการกรองแบบไดนามิก
        if (search) {
            whereConditions.push(`(first_name LIKE ? OR last_name LIKE ? OR user_name LIKE ? OR user_email LIKE ?)`);
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (role) {
            whereConditions.push(`role = ?`);
            params.push(role);
        }
        if (status) {
            whereConditions.push(`user_status = ?`);
            params.push(status);
        }

        let sqlQuery = "SELECT * FROM users";
        if (whereConditions.length > 0) {
            sqlQuery += ` WHERE ${whereConditions.join(' AND ')}`;
        }
        sqlQuery += ` ORDER BY user_id DESC`;
        
        const [rows] = await dbconnection.execute(sqlQuery, params);
        
        res.render('account', { 
            account: rows,
            user_name: req.session.user_name,
            role: req.session.role,
            filters: { search, role, status } // ส่งค่า filter กลับไป
        });
    } catch (err) {
      console.error("Error fetching user accounts:", err);
      res.status(500).send("Database error");
    }
});

// --- (โค้ดสำหรับ Create, Edit, Delete ของคุณยังคงเหมือนเดิมและทำงานได้ดี) ---

// 2) แสดงฟอร์มสร้างผู้ใช้ (GET /account/create)
router.get('/account/create', ifNotLoggedIn, isAdmin, (req, res) => {
  res.render('create_account', {
    user_name: req.session.user_name,
    role: req.session.role
  });
});

// 2.1) รับข้อมูลจากฟอร์มสร้างผู้ใช้ (POST /account/create)
router.post('/account/create', ifNotLoggedIn, isAdmin, async (req, res) => {
    // ... โค้ดส่วนนี้ของคุณทำงานได้ดีอยู่แล้ว ...
    try {
        const { first_name, last_name, user_department, user_name, user_email, user_password, role, user_status } = req.body;
        const hashedPassword = await bcrypt.hash(user_password, 10);
        await dbconnection.execute(
            `INSERT INTO users (first_name, last_name, user_department, user_name, user_email, user_password, role, user_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [first_name, last_name, user_department, user_name, user_email, hashedPassword, role || 'user', user_status || 'active']
        );
        res.redirect('/account');
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// 3) แสดงฟอร์มแก้ไขผู้ใช้ (GET /account/edit/:id)
router.get('/account/edit/:id', ifNotLoggedIn, isAdmin, async (req, res) => {
    // ... โค้ดส่วนนี้ของคุณทำงานได้ดีอยู่แล้ว ...
    try {
        const [rows] = await dbconnection.execute("SELECT * FROM users WHERE user_id = ?", [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).send("User not found");
        }
        res.render('edit_account', { user: rows[0], user_name: req.session.user_name, role: req.session.role });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// 3.1) รับข้อมูลจากฟอร์มแก้ไขผู้ใช้ (POST /account/edit/:id)
router.post('/account/edit/:id', ifNotLoggedIn, isAdmin, async (req, res) => {
    // ... โค้ดส่วนนี้ของคุณทำงานได้ดีอยู่แล้ว ...
    try {
        const { first_name, last_name, user_department, user_name, user_email, user_password, role, user_status } = req.body;
        let updateSql = "";
        let params = [];
        if (user_password) {
            const hashed = await bcrypt.hash(user_password, 10);
            updateSql = "UPDATE users SET first_name = ?, last_name = ?, user_department = ?, user_name = ?, user_email = ?, user_password = ?, role = ?, user_status = ? WHERE user_id = ?";
            params = [first_name, last_name, user_department, user_name, user_email, hashed, role, user_status, req.params.id];
        } else {
            updateSql = "UPDATE users SET first_name = ?, last_name = ?, user_department = ?, user_name = ?, user_email = ?, role = ?, user_status = ? WHERE user_id = ?";
            params = [first_name, last_name, user_department, user_name, user_email, role, user_status, req.params.id];
        }
        await dbconnection.execute(updateSql, params);
        res.redirect('/account');
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// 4) ลบผู้ใช้ (POST /account/delete/:id)
router.post('/account/delete/:id', ifNotLoggedIn, isAdmin, async (req, res) => {
    // ... โค้ดส่วนนี้ของคุณทำงานได้ดีอยู่แล้ว ...
    try {
        await dbconnection.execute("DELETE FROM users WHERE user_id = ?", [req.params.id]);
        res.redirect('/account');
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

module.exports = router;
