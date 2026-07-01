const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { query } = require('../db/postgres');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');

// POST /auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            });
        }

        // Query user from database
        const result = await query(
            `SELECT id, email, password_hash, role, first_name, last_name, facility_id, is_active 
             FROM users 
             WHERE email = $1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        const user = result.rows[0];

        // Check if account is active
        if (!user.is_active) {
            return res.status(401).json({
                success: false,
                message: 'Account is deactivated. Please contact administrator.'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role,
                facility_id: user.facility_id,
                name: `${user.first_name} ${user.last_name}`
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        // Update last login timestamp
        await query(
            'UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1',
            [user.id]
        );

        // Return token and user info (without password)
        const { password_hash, ...userWithoutPassword } = user;
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: userWithoutPassword,
                expires_in: process.env.JWT_EXPIRES_IN || '24h'
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during login.'
        });
    }
});

// POST /auth/logout (optional - client just discards token)
router.post('/logout', (req, res) => {
    res.json({
        success: true,
        message: 'Logout successful. Please discard your token on client side.'
    });
});

// POST /auth/refresh (optional - refresh expired token)
router.post('/refresh', async (req, res) => {
    try {
        const oldToken = req.headers.authorization?.split(' ')[1];
        
        if (!oldToken) {
            return res.status(401).json({
                success: false,
                message: 'No token provided.'
            });
        }

        // Verify old token (ignore expiration)
        let decoded;
        try {
            decoded = jwt.verify(oldToken, process.env.JWT_SECRET, { ignoreExpiration: true });
        } catch (error) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token.'
            });
        }

        // Check if user still exists and is active
        const result = await query(
            'SELECT is_active FROM users WHERE id = $1',
            [decoded.id]
        );

        if (result.rows.length === 0 || !result.rows[0].is_active) {
            return res.status(401).json({
                success: false,
                message: 'Account not found or deactivated.'
            });
        }

        // Generate new token
        const newToken = jwt.sign(
            {
                id: decoded.id,
                email: decoded.email,
                role: decoded.role,
                facility_id: decoded.facility_id,
                name: decoded.name
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        res.json({
            success: true,
            data: {
                token: newToken,
                expires_in: process.env.JWT_EXPIRES_IN || '24h'
            }
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during token refresh.'
        });
    }
});

// GET /auth/me - Get current user info
router.get('/me', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, email, role, first_name, last_name, facility_id, is_active, created_at, last_login
             FROM users 
             WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }

        res.json({
            success: true,
            data: { user: result.rows[0] }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error.'
        });
    }
});

module.exports = router;