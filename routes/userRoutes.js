const express = require('express');
const router = express.Router();
const dbconnection = require('../database');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');

// Middleware to check if user is an Admin
function isAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  res.status(403).send('Access denied. Admins only.');
}

// Middleware to check if user is logged in
function ifNotLoggedIn(req, res, next) {
  if (req.session && req.session.userID) {
    return next();
  }
  res.redirect('/login');
}

// Route to display user management page with filters and flash messages
router.get('/account', ifNotLoggedIn, isAdmin, async (req, res) => {
    try {
        const { search, role, status } = req.query;
        let params = [];
        let whereConditions = [];

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
        
        // Retrieve and then clear flash messages from session
        const successMessage = req.session.successMessage;
        const errorMessage = req.session.errorMessage;
        delete req.session.successMessage;
        delete req.session.errorMessage;
        
        res.render('account', { 
            account: rows,
            user_name: req.session.user_name,
            role: req.session.role,
            filters: { search, role, status },
            successMessage: successMessage,
            errorMessage: errorMessage
        });
    } catch (err) {
      console.error("Error fetching user accounts:", err);
      res.status(500).send("Database error");
    }
});

// Route to display the create user form
router.get('/account/create', ifNotLoggedIn, isAdmin, (req, res) => {
  const errorMessage = req.session.errorMessage;
  const oldInput = req.session.oldInput;
  delete req.session.errorMessage;
  delete req.session.oldInput;

  res.render('create_account', {
    user_name: req.session.user_name,
    role: req.session.role,
    errorMessage: errorMessage,
    oldInput: oldInput || {} // Ensure oldInput is always an object
  });
});

// Route to handle new user creation with validation
router.post('/account/create', ifNotLoggedIn, isAdmin, 
  [
    body('first_name', 'กรุณากรอกชื่อจริง').not().isEmpty().trim(),
    body('last_name', 'กรุณากรอกนามสกุล').not().isEmpty().trim(),
    body('user_name', 'กรุณากรอกชื่อผู้ใช้').not().isEmpty().trim(),
    body('user_email', 'รูปแบบอีเมลไม่ถูกต้อง').isEmail().normalizeEmail(),
    body('user_password', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร').isLength({ min: 6 }),
    body('confirm_password').custom((value, { req }) => {
      if (value !== req.body.user_password) {
        throw new Error('การยืนยันรหัสผ่านไม่ตรงกัน');
      }
      return true;
    }),
    body('user_name').custom(async (value) => {
      const [rows] = await dbconnection.execute('SELECT user_id FROM users WHERE user_name = ?', [value]);
      if (rows.length > 0) {
        return Promise.reject('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
      }
    }),
    body('user_email').custom(async (value) => {
      const [rows] = await dbconnection.execute('SELECT user_id FROM users WHERE user_email = ?', [value]);
      if (rows.length > 0) {
        return Promise.reject('อีเมลนี้ถูกใช้งานแล้ว');
      }
    })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.errorMessage = errors.array().map(e => e.msg).join('<br>');
      req.session.oldInput = req.body;
      return res.redirect('/account/create');
    }

    try {
        const { first_name, last_name, user_department, user_name, user_email, user_password, role } = req.body;
        const hashedPassword = await bcrypt.hash(user_password, 10);
        await dbconnection.execute(
            `INSERT INTO users (first_name, last_name, user_department, user_name, user_email, user_password, role, user_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [first_name, last_name, user_department, user_name, user_email, hashedPassword, role || 'user', 'active']
        );

        req.session.successMessage = `เพิ่มผู้ใช้ "${user_name}" สำเร็จ`;
        res.redirect('/account');

    } catch (err) {
        console.error(err);
        req.session.errorMessage = 'เกิดข้อผิดพลาดในการบันทึกข้อมูลลงฐานข้อมูล';
        req.session.oldInput = req.body;
        res.redirect('/account/create');
    }
});

// GET route for editing a user (Updated to handle flash messages)
router.get('/account/edit/:id', ifNotLoggedIn, isAdmin, async (req, res) => {
    try {
        const [rows] = await dbconnection.execute("SELECT * FROM users WHERE user_id = ?", [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).send("User not found");
        }
        
        const errorMessage = req.session.errorMessage;
        delete req.session.errorMessage;

        res.render('edit_account', { 
            user: rows[0], 
            user_name: req.session.user_name, 
            role: req.session.role,
            errorMessage: errorMessage // Pass error message to view
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// POST route for updating a user (Updated with validation)
router.post('/account/edit/:id', ifNotLoggedIn, isAdmin, 
  [
    // Validation rules
    body('first_name', 'กรุณากรอกชื่อจริง').not().isEmpty().trim(),
    body('last_name', 'กรุณากรอกนามสกุล').not().isEmpty().trim(),
    body('user_name', 'กรุณากรอกชื่อผู้ใช้').not().isEmpty().trim(),
    body('user_email', 'รูปแบบอีเมลไม่ถูกต้อง').isEmail().normalizeEmail(),

    // Custom validator for unique username (ignoring the current user)
    body('user_name').custom(async (value, { req }) => {
      const [rows] = await dbconnection.execute('SELECT user_id FROM users WHERE user_name = ? AND user_id != ?', [value, req.params.id]);
      if (rows.length > 0) {
        return Promise.reject('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
      }
    }),

    // Custom validator for unique email (ignoring the current user)
    body('user_email').custom(async (value, { req }) => {
      const [rows] = await dbconnection.execute('SELECT user_id FROM users WHERE user_email = ? AND user_id != ?', [value, req.params.id]);
      if (rows.length > 0) {
        return Promise.reject('อีเมลนี้ถูกใช้งานแล้ว');
      }
    }),
    
    // Optional password validation
    body('user_password').if(body('user_password').notEmpty()).isLength({ min: 6 }).withMessage('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.errorMessage = errors.array().map(e => e.msg).join('<br>');
      return res.redirect(`/account/edit/${req.params.id}`);
    }

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
        req.session.successMessage = `อัปเดตข้อมูลผู้ใช้ "${user_name}" สำเร็จ`;
        res.redirect('/account');
    } catch (err) {
        console.error(err);
        req.session.errorMessage = 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล';
        // Handle potential duplicate entry race condition, although validator should prevent this
        if (err.code === 'ER_DUP_ENTRY') {
            req.session.errorMessage = 'ชื่อผู้ใช้หรืออีเมลนี้มีอยู่ในระบบแล้ว';
        }
        res.redirect(`/account/edit/${req.params.id}`);
    }
});

// POST route for deleting a user
router.post('/account/delete/:id', ifNotLoggedIn, isAdmin, async (req, res) => {
    try {
        await dbconnection.execute("DELETE FROM users WHERE user_id = ?", [req.params.id]);
        req.session.successMessage = 'ลบผู้ใช้สำเร็จแล้ว';
        res.redirect('/account');
    } catch (err) {
        console.error(err);
        req.session.errorMessage = 'เกิดข้อผิดพลาดในการลบผู้ใช้';
        res.redirect('/account');
    }
});

module.exports = router;
