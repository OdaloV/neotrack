const vitalsRoutes = require('./routes/vitals');

// Add after other routes
app.use('/', vitalsRoutes);