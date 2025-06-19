const express = require('express');
const router = express.Router();
const dbconnection = require('../database'); // ตรวจสอบว่า path นี้ถูกต้อง
const bcrypt = require('bcrypt'); // ตรวจสอบว่ามีการติดตั้ง bcrypt

// Middleware (ควรมีอยู่แล้ว)
function ifLoggedin(req, res, next) {
  if (req.session && req.session.userID) {
    return res.redirect('/dashboard');
  }
  next();
}

// ==========================================================
//     Route สำหรับแสดงหน้า Login
// ==========================================================
router.get('/login', ifLoggedin, (req, res) => {
    // ส่ง error_msg เป็นค่าว่าง เพื่อป้องกัน error ใน EJS
    res.render('login', { error_msg: null });
});


// ==========================================================
//     Route สำหรับจัดการการ Login (ฉบับอัปเกรด)
// ==========================================================
router.post('/login', ifLoggedin, async (req, res) => {
    try {
        const { user_email, password } = req.body;

        // 1. ดึงข้อมูล user จากฐานข้อมูล
        const [rows] = await dbconnection.execute(
            "SELECT * FROM users WHERE user_email = ?",
            [user_email]
        );
        
        // --- ตรวจสอบ User ---
        if (rows.length === 0) {
            // ส่งข้อความ error กลับไป render ที่หน้า login
            return res.render('login', { error_msg: 'ไม่พบอีเมลนี้ในระบบ' });
        }
        const user = rows[0];

        // --- (ส่วนที่เพิ่มเข้ามา) ตรวจสอบสถานะผู้ใช้งาน ---
        if (user.user_status !== 'active') {
            return res.render('login', { error_msg: 'บัญชีของคุณถูกระงับการใช้งาน' });
        }

        // 2. เปรียบเทียบรหัสผ่านที่ถูกเข้ารหัส
        const match = await bcrypt.compare(password, user.user_password);
        if (!match) {
            return res.render('login', { error_msg: 'รหัสผ่านไม่ถูกต้อง' });
        }

        // 3. สร้าง Session เมื่อ Login สำเร็จ
        req.session.userID = user.user_id;
        req.session.user_name = user.user_name;
        req.session.role = user.role;

        // 4. อัปเดต last_login
        await dbconnection.execute(
            "UPDATE users SET last_login = NOW() WHERE user_id = ?",
            [user.user_id]
        );
        
        // 5. Redirect ไปยัง Dashboard
        res.redirect('/dashboard');

    } catch (err) {
        console.error("Login Error:", err);
        res.render('login', { error_msg: 'เกิดข้อผิดพลาดในระบบ โปรดลองอีกครั้ง' });
    }
});


// (โค้ดสำหรับ Logout)
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/dashboard');
        }
        res.clearCookie('connect.sid'); // ชื่อ cookie ของ express-session
        res.redirect('/login');
    });
});


module.exports = router;
