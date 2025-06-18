// server.js - Enhanced FCM Server with User Management
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// utils/Logger.js - Logging utility (defined first)
class Logger {
    constructor(context = 'App') {
        this.context = context;
        this.colors = {
            info: '\x1b[36m',    // Cyan
            warn: '\x1b[33m',    // Yellow
            error: '\x1b[31m',   // Red
            debug: '\x1b[37m',   // White
            reset: '\x1b[0m'     // Reset
        };
    }

    formatMessage(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const color = this.colors[level] || this.colors.info;
        const formattedMessage = args.length > 0 ? `${message} ${JSON.stringify(args)}` : message;
        
        return `${color}[${timestamp}] [${this.context}] ${level.toUpperCase()}: ${formattedMessage}${this.colors.reset}`;
    }

    info(message, ...args) {
        console.log(this.formatMessage('info', message, ...args));
    }

    warn(message, ...args) {
        console.warn(this.formatMessage('warn', message, ...args));
    }

    error(message, ...args) {
        console.error(this.formatMessage('error', message, ...args));
    }

    debug(message, ...args) {
        if (process.env.NODE_ENV === 'development') {
            console.log(this.formatMessage('debug', message, ...args));
        }
    }
}

// services/FirebaseService.js - Firebase integration service
class FirebaseService {
    constructor() {
        this.admin = require('firebase-admin');
        this.logger = new Logger('FirebaseService');
        this.initialize();
    }

    initialize() {
        try {
            // Initialize Firebase Admin SDK
            const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
            
            if (!fs.existsSync(serviceAccountPath)) {
                throw new Error('serviceAccountKey.json not found. Please add your Firebase service account key.');
            }

            const serviceAccount = require(serviceAccountPath);
            
            if (!this.admin.apps.length) {
                this.admin.initializeApp({
                    credential: this.admin.credential.cert(serviceAccount)
                });
                this.logger.info('🔥 Firebase Admin SDK initialized successfully');
            }
        } catch (error) {
            this.logger.error('Firebase initialization error:', error.message);
            // Don't throw error - allow server to run for demo mode
            this.logger.warn('⚠️  Running in DEMO MODE - Add serviceAccountKey.json for real FCM functionality');
        }
    }

    async sendMessage(token, title, body, data = {}) {
        try {
            if (!this.admin.apps.length) {
                // Demo mode - simulate success
                this.logger.info(`📱 DEMO: Would send message to ${token.substring(0, 20)}...`);
                return {
                    success: true,
                    response: 'demo-message-id-' + Date.now(),
                    token
                };
            }

            const message = {
                notification: {
                    title,
                    body
                },
                data: {
                    timestamp: new Date().toISOString(),
                    ...data
                },
                token
            };

            const response = await this.admin.messaging().send(message);
            this.logger.info(`📱 Message sent successfully to ${token.substring(0, 20)}...`);
            
            return {
                success: true,
                response,
                token
            };
        } catch (error) {
            this.logger.error(`❌ Failed to send message to ${token.substring(0, 20)}...:`, error.message);
            
            return {
                success: false,
                error: error.message,
                token,
                errorCode: error.code
            };
        }
    }

    async sendMulticast(tokens, title, body, data = {}) {
        try {
            if (!this.admin.apps.length) {
                // Demo mode - simulate batch success
                this.logger.info(`📱 DEMO: Would send multicast to ${tokens.length} users`);
                const responses = tokens.map((token, index) => ({
                    success: Math.random() > 0.1, // 90% success rate in demo
                    messageId: 'demo-msg-' + Date.now() + '-' + index
                }));

                return {
                    responses,
                    successCount: responses.filter(r => r.success).length,
                    failureCount: responses.filter(r => !r.success).length
                };
            }

            // Construct the MulticastMessage object
            const message = {
                notification: {
                    title,
                    body
                },
                data: {
                    timestamp: new Date().toISOString(),
                    ...data
                },
                tokens: tokens
            };
            
            const response = await this.admin.messaging().sendEachForMulticast(message);
            this.logger.info(`📱 Multicast message sent: ${response.successCount}/${tokens.length} successful`);

            return response;
        } catch (error) {
            this.logger.error('❌ Multicast send error:', error.message);
            throw error;
        }
    }

    validateToken(token) {
        // Basic token validation
        return token && typeof token === 'string' && token.length > 10;
    }
}

// services/UserService.js - Enhanced User management service
class UserService {
    constructor() {
        this.users = new Map();
        this.logger = new Logger('UserService');
        this.maxUsers = 10000;
        this.tokenValidityPeriod = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    registerUser(registrationData) {
        const { token, userId, username, email, platform, userAgent, timestamp } = registrationData;
        
        if (!token || typeof token !== 'string') {
            throw new Error('Invalid token provided');
        }

        if (!userId || typeof userId !== 'string') {
            throw new Error('Invalid user ID provided');
        }

        const now = new Date();
        const userDisplayName = username || 'Anonymous';
        
        if (this.users.has(token)) {
            // Update existing user
            const user = this.users.get(token);
            user.lastActive = now;
            user.registrationCount += 1;
            user.username = userDisplayName;
            user.email = email || user.email || '';
            user.isActive = true;
            
            this.logger.info(`👤 Updated existing user: ${userDisplayName} (${userId})`);
            return { isNew: false, user };
        } else {
            // Check if we've reached the maximum number of users
            if (this.users.size >= this.maxUsers) {
                this.cleanupInactiveUsers();
            }

            // Register new user
            const user = {
                id: userId,
                username: userDisplayName,
                email: email || '',
                token,
                platform: platform || 'web',
                userAgent: userAgent || '',
                registeredAt: timestamp || now.toISOString(),
                lastActive: now,
                registrationCount: 1,
                successfulNotifications: 0,
                failedNotifications: 0,
                isActive: true,
                isSelected: false // For targeting specific users
            };

            this.users.set(token, user);
            this.logger.info(`👤 Registered new user: ${userDisplayName} (${userId})`);
            
            return { isNew: true, user };
        }
    }

    removeUser(token) {
        const user = this.users.get(token);
        const removed = this.users.delete(token);
        if (removed && user) {
            this.logger.info(`👤 Removed user: ${user.username} (${user.id})`);
        }
        return removed;
    }

    getAllTokens() {
        return Array.from(this.users.keys());
    }

    getSelectedTokens() {
        return Array.from(this.users.values())
            .filter(user => user.isSelected && user.isActive)
            .map(user => user.token);
    }

    getActiveUsers() {
        const users = Array.from(this.users.values())
            .filter(user => user.isActive)
            .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
            .map(user => ({
                id: user.id,
                username: user.username,
                email: user.email,
                platform: user.platform,
                registeredAt: user.registeredAt,
                lastActive: user.lastActive.toISOString(),
                successfulNotifications: user.successfulNotifications,
                failedNotifications: user.failedNotifications,
                registrationCount: user.registrationCount,
                isSelected: user.isSelected || false
            }));

        return users;
    }

    getUserCount() {
        return this.users.size;
    }

    getActiveUserCount() {
        return Array.from(this.users.values()).filter(user => user.isActive).length;
    }

    updateUserSelection(userIds, isSelected) {
        let updatedCount = 0;
        
        for (const [token, user] of this.users.entries()) {
            if (userIds.includes(user.id)) {
                user.isSelected = isSelected;
                updatedCount++;
            }
        }
        
        this.logger.info(`📝 Updated selection for ${updatedCount} users (selected: ${isSelected})`);
        return updatedCount;
    }

    selectAllUsers(isSelected) {
        let updatedCount = 0;
        
        for (const [token, user] of this.users.entries()) {
            if (user.isActive) {
                user.isSelected = isSelected;
                updatedCount++;
            }
        }
        
        this.logger.info(`📝 ${isSelected ? 'Selected' : 'Deselected'} all ${updatedCount} active users`);
        return updatedCount;
    }

    updateUserActivity(successes, failures) {
        // Update successful notifications
        successes.forEach(success => {
            const user = this.users.get(success.token);
            if (user) {
                user.successfulNotifications += 1;
                user.lastActive = new Date();
                user.isActive = true;
            }
        });

        // Update failed notifications and mark inactive if necessary
        failures.forEach(failure => {
            const user = this.users.get(failure.token);
            if (user) {
                user.failedNotifications += 1;
                
                // Mark as inactive if token is invalid
                if (failure.errorCode === 'messaging/invalid-registration-token' ||
                    failure.errorCode === 'messaging/registration-token-not-registered') {
                    user.isActive = false;
                    this.logger.warn(`⚠️  Marked user as inactive: ${user.username} (${user.id})`);
                }
            }
        });
    }

    cleanupInactiveUsers() {
        const cutoffDate = new Date(Date.now() - this.tokenValidityPeriod);
        let removedCount = 0;

        for (const [token, user] of this.users.entries()) {
            if (!user.isActive || user.lastActive < cutoffDate) {
                this.users.delete(token);
                removedCount++;
            }
        }

        this.logger.info(`🧹 Cleaned up ${removedCount} inactive users`);
    }

    getUserByToken(token) {
        return this.users.get(token);
    }

    getUserById(userId) {
        return Array.from(this.users.values()).find(user => user.id === userId);
    }

    searchUsers(query) {
        const lowercaseQuery = query.toLowerCase();
        return Array.from(this.users.values())
            .filter(user => 
                user.isActive && (
                    user.username.toLowerCase().includes(lowercaseQuery) ||
                    user.email.toLowerCase().includes(lowercaseQuery) ||
                    user.id.toLowerCase().includes(lowercaseQuery)
                )
            );
    }

    getStats() {
        const users = Array.from(this.users.values());
        const activeUsers = users.filter(u => u.isActive);
        const selectedUsers = activeUsers.filter(u => u.isSelected);
        
        return {
            totalUsers: users.length,
            activeUsers: activeUsers.length,
            inactiveUsers: users.filter(u => !u.isActive).length,
            selectedUsers: selectedUsers.length,
            totalSuccessfulNotifications: users.reduce((sum, u) => sum + u.successfulNotifications, 0),
            totalFailedNotifications: users.reduce((sum, u) => sum + u.failedNotifications, 0),
            platforms: this.getPlatformStats(users),
            recentRegistrations: activeUsers.filter(u => 
                new Date() - new Date(u.registeredAt) < 24 * 60 * 60 * 1000 // Last 24 hours
            ).length
        };
    }

    getPlatformStats(users) {
        const platforms = {};
        users.forEach(user => {
            platforms[user.platform] = (platforms[user.platform] || 0) + 1;
        });
        return platforms;
    }
}

// services/NotificationService.js - Enhanced Notification handling service
class NotificationService {
    constructor(firebaseService) {
        this.firebaseService = firebaseService;
        this.logger = new Logger('NotificationService');
        this.batchSize = 500; // FCM multicast limit
        this.messageHistory = [];
    }

    async sendToMultiple(tokens, title, body, data = {}, targetType = 'all') {
        if (!tokens || tokens.length === 0) {
            throw new Error('No tokens provided');
        }

        const validTokens = tokens.filter(token => this.firebaseService.validateToken(token));
        
        if (validTokens.length === 0) {
            throw new Error('No valid tokens provided');
        }

        this.logger.info(`📢 Broadcasting notification to ${validTokens.length} users (${targetType}): "${body}"`);

        const successes = [];
        const failures = [];

        // Process tokens in batches to respect FCM limits
        for (let i = 0; i < validTokens.length; i += this.batchSize) {
            const batch = validTokens.slice(i, i + this.batchSize);
            
            try {
                const response = await this.firebaseService.sendMulticast(batch, title, body, data);
                
                // Process batch results
                batch.forEach((token, index) => {
                    if (response.responses[index].success) {
                        successes.push({
                            token,
                            response: response.responses[index].messageId
                        });
                    } else {
                        failures.push({
                            token,
                            error: response.responses[index].error?.message || 'Unknown error',
                            errorCode: response.responses[index].error?.code || 'UNKNOWN'
                        });
                    }
                });

            } catch (error) {
                // If batch fails entirely, mark all tokens as failed
                batch.forEach(token => {
                    failures.push({
                        token,
                        error: error.message,
                        errorCode: error.code || 'BATCH_FAILED'
                    });
                });
            }

            // Small delay between batches to avoid rate limiting
            if (i + this.batchSize < validTokens.length) {
                await this.delay(100);
            }
        }

        // Save to message history
        this.messageHistory.unshift({
            id: Date.now(),
            title,
            body,
            timestamp: new Date().toISOString(),
            targetType,
            totalSent: validTokens.length,
            successCount: successes.length,
            failureCount: failures.length
        });

        // Keep only last 50 messages
        if (this.messageHistory.length > 50) {
            this.messageHistory = this.messageHistory.slice(0, 50);
        }

        this.logger.info(`✅ Broadcast completed: ${successes.length} successful, ${failures.length} failed`);

        return {
            successes,
            failures,
            total: validTokens.length
        };
    }

    getMessageHistory() {
        return this.messageHistory;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Main FCM Server class
class FCMServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3001;
        this.logger = new Logger('FCMServer');
        
        // Initialize services
        this.firebaseService = new FirebaseService();
        this.userService = new UserService();
        this.notificationService = new NotificationService(this.firebaseService);
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupMiddleware() {
        // CORS configuration - Allow all origins for the web app
        this.app.use(cors({
            origin: '*',
            credentials: true,
            optionsSuccessStatus: 200
        }));


        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
        
        // Request logging middleware
        this.app.use((req, res, next) => {
            this.logger.info(`🌐 ${req.method} ${req.path} - ${req.ip}`);
            next();
        });
    }

    setupRoutes() {
        // Serve the main HTML page
        this.app.get('/', (req, res) => {
            const indexPath = path.join(__dirname, 'public', 'index.html');
            
            if (fs.existsSync(indexPath)) {
                this.logger.info('📄 Serving Istanbul FCM interface');
                res.sendFile(indexPath);
            } else {
                this.logger.error('❌ index.html not found in public directory');
                res.status(404).json({ 
                    error: 'Frontend not found. Please create public/index.html',
                    hint: 'Copy the Istanbul FCM interface HTML to public/index.html'
                });
            }
        });

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            const stats = this.userService.getStats();
            res.json({
                status: '🌟 Istanbul FCM Server running',
                timestamp: new Date().toISOString(),
                uptime: Math.floor(process.uptime()),
                registeredUsers: stats.totalUsers,
                activeUsers: stats.activeUsers,
                selectedUsers: stats.selectedUsers,
                mode: fs.existsSync(path.join(__dirname, 'serviceAccountKey.json')) ? 'production' : 'demo'
            });
        });

        // Enhanced user registration endpoint
        this.app.post('/register', async (req, res) => {
            try {
                const { token, userId, username, email, platform, userAgent, timestamp } = req.body;
                
                if (!token) {
                    return res.status(400).json({
                        success: false,
                        error: 'No token provided'
                    });
                }

                if (!userId) {
                    return res.status(400).json({
                        success: false,
                        error: 'No user ID provided'
                    });
                }

                const result = await this.userService.registerUser({
                    token,
                    userId,
                    username: username || 'Anonymous',
                    email: email || '',
                    platform: platform || 'web',
                    userAgent: userAgent || '',
                    timestamp
                });
                
                this.logger.info(`👤 User registered: ${result.user.username} (${result.user.id}) - ${result.isNew ? 'new' : 'existing'}`);
                
                res.json({
                    success: true,
                    message: result.isNew ? 'New user registered' : 'User already registered',
                    totalUsers: this.userService.getUserCount(),
                    activeUsers: this.userService.getActiveUserCount(),
                    isNew: result.isNew,
                    user: {
                        id: result.user.id,
                        username: result.user.username,
                        email: result.user.email
                    }
                });

            } catch (error) {
                this.logger.error('❌ Registration error:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Internal server error during registration'
                });
            }
        });

        // Add this endpoint in the setupRoutes() method, after the /register endpoint:



// User unregistration endpoint
this.app.post('/unregister', async (req, res) => {
    try {
        const { token, userId } = req.body;
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'No token provided'
            });
        }

        // Try to remove user by token
        const removed = this.userService.removeUser(token);
        
        if (removed) {
            this.logger.info(`👤 User unregistered successfully: token ${token.substring(0, 20)}...`);
            res.json({
                success: true,
                message: 'User unregistered successfully',
                totalUsers: this.userService.getUserCount(),
                activeUsers: this.userService.getActiveUserCount()
            });
        } else {
            // Token not found - this is OK for disconnect operations
            this.logger.info(`👤 Unregister request for non-existent token: ${token.substring(0, 20)}...`);
            res.status(404).json({
                success: false,
                error: 'User not found or already unregistered',
                message: 'Token not found in database'
            });
        }

    } catch (error) {
        this.logger.error('❌ Unregistration error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error during unregistration'
        });
    }
});

        // Get active users endpoint
        this.app.get('/users', (req, res) => {
            try {
                const users = this.userService.getActiveUsers();
                res.json({
                    success: true,
                    users,
                    count: users.length
                });
            } catch (error) {
                this.logger.error('❌ Get users error:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Failed to fetch users'
                });
            }
        });

        // Search users endpoint
        this.app.get('/users/search', (req, res) => {
            try {
                const { query } = req.query;
                if (!query) {
                    return res.status(400).json({
                        success: false,
                        error: 'Search query is required'
                    });
                }

                const users = this.userService.searchUsers(query);
                res.json({
                    success: true,
                    users,
                    count: users.length,
                    query
                });
            } catch (error) {
                this.logger.error('❌ Search users error:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Failed to search users'
                });
            }
        });

        // Update user selection endpoint
        this.app.post('/users/select', (req, res) => {
            try {
                const { userIds, isSelected } = req.body;
                
                if (!Array.isArray(userIds)) {
                    return res.status(400).json({
                        success: false,
                        error: 'userIds must be an array'
                    });
                }

                const updatedCount = this.userService.updateUserSelection(userIds, Boolean(isSelected));
                
                res.json({
                    success: true,
                    message: `Updated selection for ${updatedCount} users`,
                    updatedCount,
                    isSelected: Boolean(isSelected)
                });
            } catch (error) {
                this.logger.error('❌ Update user selection error:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Failed to update user selection'
                });
            }
        });

        // Select/deselect all users endpoint
        this.app.post('/users/select-all', (req, res) => {
            try {
                const { isSelected } = req.body;
                
                const updatedCount = this.userService.selectAllUsers(Boolean(isSelected));
                
                res.json({
                    success: true,
                    message: `${isSelected ? 'Selected' : 'Deselected'} all ${updatedCount} active users`,
                    updatedCount,
                    isSelected: Boolean(isSelected)
                });
            } catch (error) {
                this.logger.error('❌ Select all users error:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Failed to update user selection'
                });
            }
        });

        // Enhanced send notification endpoint
        this.app.post('/send', async (req, res) => {
            try {
                const { title = 'Istanbul FCM Notification', body, targetType = 'all' } = req.body;
                
                if (!body) {
                    return res.status(400).json({
                        success: false,
                        error: 'Message body is required'
                    });
                }

                let tokens;
                let targetDescription;

                if (targetType === 'selected') {
                    tokens = this.userService.getSelectedTokens();
                    targetDescription = 'selected users';
                    
                    if (tokens.length === 0) {
                        return res.status(400).json({
                            success: false,
                            error: 'No users selected for targeted messaging'
                        });
                    }
                } else {
                    tokens = this.userService.getAllTokens();
                    targetDescription = 'all users';
                    
                    if (tokens.length === 0) {
                        return res.status(400).json({
                            success: false,
                            error: 'No registered users to send notifications to'
                        });
                    }
                }

                this.logger.info(`📢 Broadcasting to ${tokens.length} ${targetDescription}: "${body}"`);
                
                const result = await this.notificationService.sendToMultiple(tokens, title, body, {}, targetType);
                
                // Update user activity based on success/failure
                this.userService.updateUserActivity(result.successes, result.failures);
                
                res.json({
                    success: true,
                    sent: result.successes.length,
                    failed: result.failures.length,
                    targetType,
                    message: `Successfully broadcast to ${result.successes.length} ${targetDescription}`,
                    details: {
                        successes: result.successes,
                        failures: result.failures
                    }
                });

            } catch (error) {
                this.logger.error('❌ Send notification error:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Internal server error while sending notifications'
                });
            }
        });

        // Get message history endpoint
        this.app.get('/history', (req, res) => {
            try {
                const history = this.notificationService.getMessageHistory();
                res.json({
                    success: true,
                    history,
                    count: history.length
                });
            } catch (error) {
                this.logger.error('❌ Get history error:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Failed to fetch message history'
                });
            }
        });

        // Enhanced server statistics endpoint
        this.app.get('/stats', (req, res) => {
            try {
                const stats = this.userService.getStats();
                const messageHistory = this.notificationService.getMessageHistory();
                
                res.json({
                    success: true,
                    stats: {
                        ...stats,
                        totalMessages: messageHistory.length,
                        lastMessageTime: messageHistory[0]?.timestamp || null,
                        serverUptime: Math.floor(process.uptime()),
                        serverMode: fs.existsSync(path.join(__dirname, 'serviceAccountKey.json')) ? 'production' : 'demo'
                    }
                });
            } catch (error) {
                this.logger.error('❌ Get stats error:', error.message);
                res.status(500).json({
                    success: false,
                    error: 'Failed to fetch statistics'
                });
            }
        });

        // Serve static files AFTER API routes to prevent conflicts
        this.app.use(express.static(path.join(__dirname, 'public')));

        this.app.get('/env.js', (req, res) => {
            res.type('application/javascript');
            res.send(`window.env = ${JSON.stringify({
                API_BASE_URL: process.env.API_BASE_URL,
            })}`);
        });
    }

    setupErrorHandling() {
        // 404 handler
        this.app.use((req, res) => {
            this.logger.warn(`❌ 404 - Route not found: ${req.path}`);
            res.status(404).json({
                success: false,
                error: 'Endpoint not found',
                availableEndpoints: [
                    '/', '/health', '/register', '/send', '/users', '/users/search', 
                    '/users/select', '/users/select-all', '/history', '/stats'
                ]
            });
        });

        // Global error handler
        this.app.use((error, req, res, next) => {
            this.logger.error('❌ Unhandled error:', error.message);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        });
    }

    start() {
        this.app.listen(this.port, '0.0.0.0', () => {
            this.logger.info(`🚀 Istanbul FCM Server running on http://localhost:${this.port}`);
            this.logger.info('🌐 Web interface available at the above URL');
            this.logger.info('📱 Ready to accept FCM registrations and broadcast messages!');
            
            // Check if running in demo mode
            if (!fs.existsSync(path.join(__dirname, 'serviceAccountKey.json'))) {
                this.logger.warn('⚠️  DEMO MODE: Add serviceAccountKey.json for real FCM functionality');
            }
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            this.logger.info('👋 SIGTERM received, shutting down gracefully');
            process.exit(0);
        });

        process.on('SIGINT', () => {
            this.logger.info('👋 SIGINT received, shutting down gracefully');
            process.exit(0);
        });
    }
}

// Export services for modular use
module.exports = {
    FCMServer,
    FirebaseService,
    UserService,
    NotificationService,
    Logger
};

// Start server if this file is run directly
if (require.main === module) {
    const server = new FCMServer();
    server.start();
}