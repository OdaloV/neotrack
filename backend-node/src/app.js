const express = require('express');
const dotenv = require('dotenv');
const { query } = require('./db/postgres');
const authRoutes = require('./routes/auth');
const neonateRoutes = require('./routes/neonates'); 
const { verifyToken, requireRole } = require('./middleware/auth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth routes (public)
app.use('/auth', authRoutes);
app.use('/', neonateRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const result = await query('SELECT NOW() as time');
        res.json({
            status: 'healthy',
            timestamp: result.rows[0].time,
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(503).json({
            status: 'degraded',
            error: error.message
        });
    }
});

// Example protected routes
app.get('/api/protected', verifyToken, (req, res) => {
    res.json({
        success: true,
        message: `Hello ${req.user.full_name || req.user.name}, you have access!`,
        user: req.user
    });
});

// Admin-only route
app.delete('/api/users/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
    try {
        await query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting user' });
    }
});

// Manager+ route
app.get('/api/reports', verifyToken, requireRole('MANAGER'), (req, res) => {
    res.json({ success: true, message: 'Reports data accessible to managers and admins' });
});

// Nurse+ route
app.post('/api/patients', verifyToken, requireRole('NURSE'), (req, res) => {
    res.json({ success: true, message: 'Patient created by nurse or higher role' });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Neonatal Early Warning System (NEWS) API',
        version: '1.0.0',
        endpoints: {
            health: 'GET /health',
            login: 'POST /auth/login',
            protected: 'GET /api/protected',
            patients: 'POST /api/patients',
            reports: 'GET /api/reports'
        }
    });
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`NEWS API running on port ${PORT}`);
        console.log(`Health check: http://localhost:${PORT}/health`);
        console.log(`Login: POST http://localhost:${PORT}/auth/login`);
    });
}

module.exports = app;
