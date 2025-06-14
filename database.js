const mysql = require('mysql2');
// ตั้งค่าการเชื่อมต่อ MySQL connection
const dbconnection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '12345', // ใช้รหัสที่ตั้งไว้ตอนติดตั้ง
    database: 'it_project'
  }).promise();

module.exports = dbconnection;
