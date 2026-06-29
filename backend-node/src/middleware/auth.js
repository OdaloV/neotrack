const jwt = require('jsonwebtoken');

// Role hierarchy for permission checking
const roleHierarchy = {
    CHW: 1,      // Community Health Worker - limited access
    NURSE: 2,    // Nurse - standard access
    CLINICIAN: 3, // Clinician - elevated access
    MANAGER: 4,   // Manager - administrative access
    ADMIN: 5      // Admin - full system access
};

// Verify JWT token
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]; 
    
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Access denied. No token provided.'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; 
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired. Please login again.'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Invalid token.'
        });
    }
};

// Check if user has required role 
const requireRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required.'
            });
        }

        const userRoleLevel = roleHierarchy[req.user.role];
        const requiredRoleLevel = roleHierarchy[requiredRole];

        if (!userRoleLevel || userRoleLevel < requiredRoleLevel) {
            return res.status(403).json({
                success: false,
                message: `Access denied. ${requiredRole} role or higher required.`
            });
        }

        next();
    };
};

// Check if user has exact role
const requireExactRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required.'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Allowed roles: ${allowedRoles.join(', ')}`
            });
        }

        next();
    };
};

// Check if user owns the resource or has admin role
const requireOwnershipOrRole = (getResourceUserId) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required.'
            });
        }

        // Admin can access everything
        if (req.user.role === 'ADMIN') {
            return next();
        }

        try {
            const resourceUserId = await getResourceUserId(req);
            if (req.user.id !== resourceUserId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied. You can only access your own resources.'
                });
            }
            next();
        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Error checking resource ownership.'
            });
        }
    };
};

module.exports = {
    verifyToken,
    requireRole,
    requireExactRole,
    requireOwnershipOrRole,
    roleHierarchy
};