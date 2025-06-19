const express = require('express');
const router = express.Router();
const dbconnection = require('../database'); // ตรวจสอบว่า path นี้ถูกต้อง

// Middleware ตรวจสอบการล็อกอิน
function ifNotLoggedIn(req, res, next) {
  if (!req.session || !req.session.userID) {
    return res.redirect('/login');
  }
  next();
}

// ==========================================================
//     Route สำหรับแสดงหน้า Dashboard (ฉบับอัปเกรด)
// ==========================================================
router.get('/dashboard', ifNotLoggedIn, async (req, res) => {
    try {
        const role = req.session.role;
        const userId = req.session.userID;
        const userName = req.session.user_name;
        let dashboardData = {};

        if (role === 'admin') {
            // --- รวบรวมข้อมูลสำหรับ Admin ---

            // 1. การ์ดสรุปตัวเลข
            const [pendingRequests] = await dbconnection.execute("SELECT COUNT(*) as count FROM asset_requests WHERE req_status = 'Pending'");
            const [approvedRequests] = await dbconnection.execute("SELECT COUNT(*) as count FROM asset_requests WHERE req_status IN ('Approved', 'Partially Approved')");
            const [pendingTransfers] = await dbconnection.execute("SELECT COUNT(*) as count FROM asset_transfers WHERE at_status = 'Pending' AND transfer_type = 'request'");
            const [pendingReturns] = await dbconnection.execute("SELECT COUNT(*) as count FROM asset_transfers WHERE at_status = 'Pending' AND transfer_type = 'return'");
            
            // 2. ข้อมูลสำหรับกราฟ
            const [assetsByCategory] = await dbconnection.execute("SELECT as_category, COUNT(*) as count FROM assets GROUP BY as_category");
            const [assetsByStatus] = await dbconnection.execute("SELECT as_status, COUNT(*) as count FROM assets GROUP BY as_status");

            // 3. ข้อมูลเชิงลึกและการแจ้งเตือน
            const [nearingWarranty] = await dbconnection.execute(
                "SELECT as_asset_number, as_name, as_warranty_expiry FROM assets WHERE as_warranty_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) ORDER BY as_warranty_expiry ASC LIMIT 5"
            );
            const [mostRequested] = await dbconnection.execute(
                "SELECT item_name, COUNT(*) as count FROM asset_request_items GROUP BY item_name ORDER BY count DESC LIMIT 5"
            );

            dashboardData = {
                pendingRequests: pendingRequests[0].count,
                approvedRequests: approvedRequests[0].count,
                pendingTransfers: pendingTransfers[0].count,
                pendingReturns: pendingReturns[0].count,
                // Data for Charts
                assetsByCategory: assetsByCategory,
                assetsByStatus: assetsByStatus,
                // Data for Insight Lists
                nearingWarranty: nearingWarranty,
                mostRequested: mostRequested,
            };

        } else {
            // --- รวบรวมข้อมูลสำหรับ User ---
            const [myPendingRequests] = await dbconnection.execute("SELECT COUNT(*) as count FROM asset_requests WHERE req_user_id = ? AND req_status = 'Pending'", [userId]);
            const [myAssets] = await dbconnection.execute("SELECT COUNT(*) as count FROM assets WHERE as_location = ?", [userName]);
            const [itemsToReceive] = await dbconnection.execute(
                `SELECT COUNT(t.transfer_id) as count FROM asset_transfers t 
                 JOIN asset_requests ar ON t.req_asset_id = ar.req_asset_id 
                 WHERE ar.req_user_id = ? AND t.at_status = 'Pending' AND t.transfer_type = 'request'`,
                [userId]
            );
            const [myRecentRequests] = await dbconnection.execute("SELECT req_asset_id, req_request_date, req_status FROM asset_requests WHERE req_user_id = ? ORDER BY req_id DESC LIMIT 5", [userId]);
            
            dashboardData = {
                myPendingRequests: myPendingRequests[0].count,
                myAssets: myAssets[0].count,
                itemsToReceive: itemsToReceive[0].count,
                myRecentRequests: myRecentRequests
            };
        }

        res.render('dashboard', {
            data: dashboardData,
            user_name: req.session.user_name,
            role: req.session.role
        });

    } catch (err) {
        console.error("Error fetching dashboard data:", err);
        res.status(500).send("Database Error");
    }
});

module.exports = router;
