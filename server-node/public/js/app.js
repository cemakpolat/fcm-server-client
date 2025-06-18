'use strict';

        /**
         * Istanbul FCM Admin Console Application
         * Enhanced user management and broadcasting
         */

        class FCMAdminConsole {
            constructor() {
                this.config = {
                    apiBaseUrl: window.env?.API_BASE_URL || "http://localhost:3001",
                    refreshInterval: 15000,
                    maxRetries: 3,
                    retryDelay: 1000
                };
                
                this.state = {
                    isConnected: false,
                    users: [],
                    selectedUsers: new Set(),
                    serverStats: null,
                    searchQuery: ''
                };
                
                this.elements = this.initializeElements();
                this.init();
            }

            initializeElements() {
                return {
                    // Form elements
                    messageForm: document.getElementById('messageForm'),
                    messageTitle: document.getElementById('messageTitle'),
                    messageBody: document.getElementById('messageBody'),
                    sendBtn: document.getElementById('sendBtn'),
                    sendBtnText: document.getElementById('sendBtnText'),
                    charCount: document.getElementById('charCount'),
                    
                    // User management elements
                    usersList: document.getElementById('usersList'),
                    userSearch: document.getElementById('userSearch'),
                    selectAllBtn: document.getElementById('selectAllBtn'),
                    deselectAllBtn: document.getElementById('deselectAllBtn'),
                    refreshUsersBtn: document.getElementById('refreshUsersBtn'),
                    
                    // Display elements
                    connectionStatus: document.getElementById('connectionStatus'),
                    statusIndicator: document.getElementById('statusIndicator'),
                    statusText: document.getElementById('statusText'),
                    userCount: document.getElementById('userCount'),
                    selectedCount: document.getElementById('selectedCount'),
                    messageHistory: document.getElementById('messageHistory'),
                    notificationContainer: document.getElementById('notificationContainer'),
                    loadingOverlay: document.getElementById('loadingOverlay'),
                    
                    // Stats elements
                    totalUsersCount: document.getElementById('totalUsersCount'),
                    activeUsersCount: document.getElementById('activeUsersCount'),
                    selectedUsersCount: document.getElementById('selectedUsersCount'),
                    messagesSentCount: document.getElementById('messagesSentCount'),
                    serverMode: document.getElementById('serverMode'),
                    serverUptime: document.getElementById('serverUptime'),
                    platformStats: document.getElementById('platformStats')
                };
            }

            async init() {
                try {
                    await this.initializeIcons();
                    this.setupEventListeners();
                    this.setupCharacterCounter();
                    await this.checkServerConnection();
                    await this.loadUsers();
                    this.startPeriodicUpdates();
                } catch (error) {
                    console.error('Failed to initialize application:', error);
                    this.showNotification('Error', 'Failed to initialize application', 'error');
                }
            }

            async initializeIcons() {
                return new Promise((resolve) => {
                    if (typeof lucide !== 'undefined') {
                        lucide.createIcons();
                        console.log('✅ Lucide icons initialized');
                        resolve();
                    } else {
                        console.warn('❌ Lucide library not loaded, using fallbacks');
                        this.replaceLucideWithFallbacks();
                        resolve();
                    }
                });
            }

            replaceLucideWithFallbacks() {
                const iconMap = {
                    'shield': '🛡️', 'users': '👥', 'activity': '📊', 'history': '📜',
                    'message-square': '💬', 'inbox': '📥', 'check-circle': '✅',
                    'x-circle': '❌', 'x': '✕', 'search': '🔍', 'refresh-cw': '🔄',
                    'send': '📤', 'pie-chart': '📊', 'bar-chart': '📊'
                };

                document.querySelectorAll('[data-lucide]').forEach(element => {
                    const iconName = element.getAttribute('data-lucide');
                    const fallbackText = iconMap[iconName] || '●';
                    element.textContent = fallbackText;
                    element.removeAttribute('data-lucide');
                });
            }

            setupEventListeners() {
                // Form submission
                this.elements.messageForm.addEventListener('submit', (e) => this.handleMessageSubmit(e));
                
                // Character counter
                this.elements.messageBody.addEventListener('input', () => this.updateCharacterCounter());
                
                // User management buttons
                this.elements.selectAllBtn.addEventListener('click', () => this.selectAllUsers(true));
                this.elements.deselectAllBtn.addEventListener('click', () => this.selectAllUsers(false));
                this.elements.refreshUsersBtn.addEventListener('click', () => this.loadUsers());
                
                // Search functionality
                this.elements.userSearch.addEventListener('input', (e) => {
                    this.state.searchQuery = e.target.value.trim();
                    this.filterAndDisplayUsers();
                });
                
                // Keyboard shortcuts
                document.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        this.handleMessageSubmit(new Event('submit'));
                    }
                });

                // Visibility change handling
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) {
                        this.checkServerConnection();
                        this.loadUsers();
                    }
                });
            }

            setupCharacterCounter() {
                this.updateCharacterCounter();
            }

            updateCharacterCounter() {
                const text = this.elements.messageBody.value;
                const count = text.length;
                const maxLength = 500;
                
                this.elements.charCount.textContent = `${count}/${maxLength}`;
                this.elements.charCount.className = count > maxLength * 0.8 
                    ? 'text-xs text-amber-500 font-medium' 
                    : 'text-xs text-gray-400';
            }

            async handleMessageSubmit(e) {
                e.preventDefault();
                
                const title = this.elements.messageTitle.value.trim();
                const body = this.elements.messageBody.value.trim();
                const targetType = document.querySelector('input[name="targetType"]:checked').value;
                
                if (!this.validateMessage(body, targetType)) return;

                await this.sendMessage(title, body, targetType);
            }

            validateMessage(body, targetType) {
                if (!body) {
                    this.showNotification('Validation Error', 'Please enter a message', 'error');
                    this.elements.messageBody.focus();
                    return false;
                }
                
                if (body.length > 500) {
                    this.showNotification('Validation Error', 'Message too long (max 500 characters)', 'error');
                    this.elements.messageBody.focus();
                    return false;
                }

                if (targetType === 'selected' && this.state.selectedUsers.size === 0) {
                    this.showNotification('Validation Error', 'Please select at least one user for targeted messaging', 'error');
                    return false;
                }
                
                return true;
            }

            async sendMessage(title, body, targetType) {
                if (!this.state.isConnected) {
                    this.showNotification('Connection Error', 'Not connected to server', 'error');
                    return;
                }

                // Debug logging
                console.log('🚀 Sending message:', { title, body, targetType });
                console.log('📊 Selected users count:', this.state.selectedUsers.size);
                console.log('👥 Total users count:', this.state.users.length);

                this.setLoadingState(true);
                
                try {
                    const response = await this.apiRequest('/send', {
                        method: 'POST',
                        body: JSON.stringify({ title, body, targetType })
                    });

                    if (response.success) {
                        const targetDesc = targetType === 'selected' ? 'selected users' : 'all users';
                        this.showNotification('Success!', `Broadcast sent to ${response.sent} ${targetDesc}`, 'success');
                        this.addMessageToHistory(title, body, response.sent, response.failed || 0, targetType);
                        this.elements.messageBody.value = '';
                        this.updateCharacterCounter();
                        await this.loadUsers(); // Refresh user stats
                        await this.loadServerStats();
                    } else {
                        throw new Error(response.error || 'Failed to send message');
                    }
                } catch (error) {
                    console.error('Send error:', error);
                    
                    // Enhanced error handling
                    let errorMessage = error.message;
                    if (error.message.includes('400')) {
                        errorMessage = 'Bad request - check if users are selected for targeted messaging';
                    }
                    
                    this.showNotification('Error', errorMessage, 'error');
                } finally {
                    this.setLoadingState(false);
                }
            }

            async loadUsers() {
                try {
                    const response = await this.apiRequest('/users');
                    
                    if (response.success) {
                        this.state.users = response.users;
                        
                        // Update local selection state based on server data
                        this.state.selectedUsers.clear();
                        response.users.forEach(user => {
                            if (user.isSelected) {
                                this.state.selectedUsers.add(user.id);
                            }
                        });
                        
                        this.filterAndDisplayUsers();
                        this.updateUserCounts();
                    }
                } catch (error) {
                    console.error('Error loading users:', error);
                    this.elements.usersList.innerHTML = `
                        <div class="text-center text-red-500 py-4">
                            <i data-lucide="alert-circle" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                            <p>Failed to load users</p>
                        </div>
                    `;
                }
            }

            filterAndDisplayUsers() {
                let filteredUsers = this.state.users;
                
                if (this.state.searchQuery) {
                    const query = this.state.searchQuery.toLowerCase();
                    filteredUsers = this.state.users.filter(user => 
                        user.username.toLowerCase().includes(query) ||
                        user.email.toLowerCase().includes(query) ||
                        user.id.toLowerCase().includes(query)
                    );
                }

                this.displayUsers(filteredUsers);
            }

            displayUsers(users) {
                if (users.length === 0) {
                    this.elements.usersList.innerHTML = `
                        <div class="text-center text-gray-500 py-8">
                            <i data-lucide="user-x" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
                            <p>${this.state.searchQuery ? 'No users match your search' : 'No active users'}</p>
                        </div>
                    `;
                } else {
                    this.elements.usersList.innerHTML = users.map(user => this.createUserCard(user)).join('');
                }
                
                // Reinitialize icons after DOM update
                this.initializeIcons();
            }

            createUserCard(user) {
                const isSelected = this.state.selectedUsers.has(user.id);
                const lastActive = new Date(user.lastActive).toLocaleString();
                const registeredAt = new Date(user.registeredAt).toLocaleDateString();
                
                return `
                    <div class="user-card p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
                        isSelected ? 'selected-user' : 'border-gray-200 hover:border-blue-300'
                    }" data-user-id="${user.id}">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center space-x-3">
                                <div class="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                                    <span class="text-white text-sm font-medium">${user.username.charAt(0).toUpperCase()}</span>
                                </div>
                                <div class="flex-1">
                                    <div class="flex items-center space-x-2">
                                        <h4 class="font-medium text-gray-800">${this.escapeHtml(user.username)}</h4>
                                        <span class="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">${user.platform}</span>
                                        ${isSelected ? '<span class="px-2 py-1 bg-blue-100 text-blue-600 text-xs rounded">Selected</span>' : ''}
                                    </div>
                                    <p class="text-sm text-gray-500">${this.escapeHtml(user.email) || 'No email'}</p>
                                    <div class="flex items-center space-x-4 text-xs text-gray-400 mt-1">
                                        <span>ID: ${user.id}</span>
                                        <span>Joined: ${registeredAt}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="text-right">
                                <div class="flex items-center space-x-3 text-sm">
                                    <div class="text-green-600">
                                        <i data-lucide="check-circle" class="w-4 h-4 inline mr-1"></i>
                                        ${user.successfulNotifications}
                                    </div>
                                    <div class="text-red-600">
                                        <i data-lucide="x-circle" class="w-4 h-4 inline mr-1"></i>
                                        ${user.failedNotifications}
                                    </div>
                                </div>
                                <p class="text-xs text-gray-400 mt-1">Last: ${lastActive}</p>
                                <div class="mt-2">
                                    <input type="checkbox" ${isSelected ? 'checked' : ''} 
                                           class="user-checkbox w-4 h-4 text-blue-600 rounded focus:ring-blue-500" 
                                           data-user-id="${user.id}">
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }

            async selectAllUsers(isSelected) {
                try {
                    const response = await this.apiRequest('/users/select-all', {
                        method: 'POST',
                        body: JSON.stringify({ isSelected })
                    });

                    if (response.success) {
                        if (isSelected) {
                            this.state.selectedUsers = new Set(this.state.users.map(u => u.id));
                        } else {
                            this.state.selectedUsers.clear();
                        }
                        
                        this.filterAndDisplayUsers();
                        this.updateUserCounts();
                        this.showNotification('Success', response.message, 'success');
                    }
                } catch (error) {
                    console.error('Error selecting users:', error);
                    this.showNotification('Error', 'Failed to update user selection', 'error');
                }
            }

            async updateServerUserSelection(userIds, isSelected) {
                try {
                    const response = await this.apiRequest('/users/select', {
                        method: 'POST',
                        body: JSON.stringify({ userIds, isSelected })
                    });

                    if (response.success) {
                        console.log('Server selection updated:', response.message);
                    }
                } catch (error) {
                    console.error('Error updating server selection:', error);
                }
            }

            async toggleUserSelection(userId, isSelected) {
                if (isSelected) {
                    this.state.selectedUsers.add(userId);
                } else {
                    this.state.selectedUsers.delete(userId);
                }
                
                // Update server selection
                await this.updateServerUserSelection([userId], isSelected);
                this.updateUserCounts();
            }

            updateUserCounts() {
                const activeCount = this.state.users.length;
                const selectedCount = this.state.selectedUsers.size;
                
                this.elements.userCount.textContent = `${activeCount} Users Online`;
                this.elements.selectedCount.textContent = `${selectedCount} Selected`;
                this.elements.selectedUsersCount.textContent = selectedCount;
                this.elements.activeUsersCount.textContent = activeCount;
            }

            async apiRequest(endpoint, options = {}) {
                const url = `${this.config.apiBaseUrl}${endpoint}`;
                const defaultOptions = {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'same-origin'
                };

                let lastError;
                
                for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
                    try {
                        const response = await fetch(url, { ...defaultOptions, ...options });
                        
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }
                        
                        return await response.json();
                    } catch (error) {
                        lastError = error;
                        
                        if (attempt < this.config.maxRetries) {
                            await this.delay(this.config.retryDelay * attempt);
                            continue;
                        }
                    }
                }
                
                throw lastError;
            }

            setLoadingState(isLoading) {
                this.elements.sendBtn.disabled = isLoading;
                
                if (isLoading) {
                    this.elements.sendBtnText.innerHTML = '<span class="loading-dots">Sending</span>';
                    this.elements.loadingOverlay.classList.remove('hidden');
                    this.elements.loadingOverlay.classList.add('flex');
                } else {
                    this.elements.sendBtnText.textContent = 'Broadcast Message';
                    this.elements.loadingOverlay.classList.add('hidden');
                    this.elements.loadingOverlay.classList.remove('flex');
                }
            }

            async checkServerConnection() {
                try {
                    const response = await fetch('/health');
                    
                    if (response.ok) {
                        const data = await response.json();
                        this.updateConnectionStatus(true, 'Connected to server');
                        this.updateServerStats(data);
                        this.state.isConnected = true;
                    } else {
                        throw new Error('Server responded with error');
                    }
                } catch (error) {
                    this.updateConnectionStatus(false, 'Server unavailable');
                    this.state.isConnected = false;
                    console.error('Server connection error:', error);
                }
            }

            async loadServerStats() {
                try {
                    const response = await this.apiRequest('/stats');
                    if (response.success) {
                        this.updateDetailedStats(response.stats);
                    }
                } catch (error) {
                    console.error('Error loading server stats:', error);
                }
            }

            updateConnectionStatus(isConnected, message) {
                this.elements.statusIndicator.className = `w-3 h-3 rounded-full ${
                    isConnected ? 'bg-green-500 pulse-ring' : 'bg-red-500'
                }`;
                this.elements.statusText.textContent = message;
                this.state.isConnected = isConnected;
            }

            updateServerStats(data) {
                if (data.activeUsers !== undefined) {
                    this.elements.activeUsersCount.textContent = data.activeUsers;
                    this.elements.userCount.textContent = `${data.activeUsers} Users Online`;
                }
                
                if (data.selectedUsers !== undefined) {
                    this.elements.selectedUsersCount.textContent = data.selectedUsers;
                    this.elements.selectedCount.textContent = `${data.selectedUsers} Selected`;
                }
                
                if (data.mode !== undefined) {
                    const mode = data.mode === 'demo' ? 'Demo Mode' : 'Production';
                    this.elements.serverMode.textContent = mode;
                    this.elements.serverMode.className = `font-medium ${
                        data.mode === 'demo' ? 'text-amber-600' : 'text-green-600'
                    }`;
                }
                
                if (data.uptime !== undefined) {
                    this.elements.serverUptime.textContent = this.formatUptime(data.uptime);
                }
            }

            updateDetailedStats(stats) {
                this.elements.totalUsersCount.textContent = stats.totalUsers || 0;
                this.elements.messagesSentCount.textContent = stats.totalSuccessfulNotifications || 0;
                
                // Update platform stats
                if (stats.platforms && Object.keys(stats.platforms).length > 0) {
                    const platformHtml = Object.entries(stats.platforms)
                        .map(([platform, count]) => `
                            <div class="flex justify-between">
                                <span class="text-gray-600 capitalize">${platform}:</span>
                                <span class="font-medium text-blue-600">${count}</span>
                            </div>
                        `).join('');
                    
                    this.elements.platformStats.innerHTML = platformHtml;
                } else {
                    this.elements.platformStats.innerHTML = `
                        <div class="text-center text-gray-500 py-4">
                            <p class="text-sm">No platform data available</p>
                        </div>
                    `;
                }
            }

            formatUptime(seconds) {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = seconds % 60;
                return `${hours}h ${minutes}m ${secs}s`;
            }

            addMessageToHistory(title, body, sent, failed, targetType) {
                const timestamp = new Date().toLocaleString();
                const messageElement = document.createElement('div');
                messageElement.className = 'p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500 animate-pulse';
                messageElement.innerHTML = `
                    <div class="flex items-start justify-between mb-2">
                        <h4 class="font-medium text-gray-800">${this.escapeHtml(title)}</h4>
                        <span class="text-xs text-gray-500">${timestamp}</span>
                    </div>
                    <p class="text-gray-600 mb-3">${this.escapeHtml(body)}</p>
                    <div class="flex items-center space-x-4 text-sm">
                        <div class="flex items-center text-blue-600">
                            <span class="mr-1">🎯</span>
                            <span>${targetType === 'selected' ? 'Selected' : 'All'} users</span>
                        </div>
                        <div class="flex items-center text-green-600">
                            <span class="mr-1">✅</span>
                            <span>${sent} sent</span>
                        </div>
                        <div class="flex items-center text-red-600">
                            <span class="mr-1">❌</span>
                            <span>${failed} failed</span>
                        </div>
                    </div>
                `;

                // Remove placeholder if exists
                const placeholder = this.elements.messageHistory.querySelector('.text-center');
                if (placeholder) {
                    placeholder.remove();
                }

                this.elements.messageHistory.insertBefore(messageElement, this.elements.messageHistory.firstChild);
                
                // Remove animation after a brief moment
                setTimeout(() => {
                    messageElement.classList.remove('animate-pulse');
                }, 1000);
                
                // Limit history to 10 messages
                const messages = this.elements.messageHistory.children;
                if (messages.length > 10) {
                    this.elements.messageHistory.removeChild(messages[messages.length - 1]);
                }
            }

            showNotification(title, message, type = 'info') {
                const notification = document.createElement('div');
                const colors = {
                    success: 'bg-green-500',
                    error: 'bg-red-500',
                    info: 'bg-blue-500',
                    warning: 'bg-yellow-500'
                };

                notification.className = `notification-enter p-4 rounded-lg shadow-lg text-white ${colors[type]} max-w-sm`;
                notification.setAttribute('role', 'alert');
                notification.innerHTML = `
                    <div class="flex items-start">
                        <div class="flex-1">
                            <h4 class="font-medium">${this.escapeHtml(title)}</h4>
                            <p class="text-sm opacity-90">${this.escapeHtml(message)}</p>
                        </div>
                        <button class="ml-2 text-white hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50 rounded" 
                                onclick="this.parentElement.parentElement.remove()"
                                aria-label="Close notification">
                            ✕
                        </button>
                    </div>
                `;

                this.elements.notificationContainer.appendChild(notification);

                // Auto remove after 5 seconds
                setTimeout(() => {
                    if (notification.parentElement) {
                        notification.remove();
                    }
                }, 5000);
            }

            startPeriodicUpdates() {
                // Check connection and load data every 15 seconds
                setInterval(() => {
                    if (document.visibilityState === 'visible') {
                        this.checkServerConnection();
                        this.loadUsers();
                        this.loadServerStats();
                    }
                }, this.config.refreshInterval);
            }

            escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            delay(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }
        }

        // Event delegation for user selection
        document.addEventListener('click', async (e) => {
            if (e.target.classList.contains('user-card') || e.target.closest('.user-card')) {
                const userCard = e.target.classList.contains('user-card') ? e.target : e.target.closest('.user-card');
                const userId = userCard.dataset.userId;
                const checkbox = userCard.querySelector('.user-checkbox');
                
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                }
                
                if (window.fcmAdmin) {
                    await window.fcmAdmin.toggleUserSelection(userId, checkbox.checked);
                    userCard.classList.toggle('selected-user', checkbox.checked);
                    
                    // Update visual indicator
                    const selectedSpan = userCard.querySelector('.bg-blue-100');
                    if (checkbox.checked && !selectedSpan) {
                        const platformSpan = userCard.querySelector('.bg-gray-100');
                        if (platformSpan) {
                            platformSpan.insertAdjacentHTML('afterend', '<span class="px-2 py-1 bg-blue-100 text-blue-600 text-xs rounded ml-1">Selected</span>');
                        }
                    } else if (!checkbox.checked && selectedSpan) {
                        selectedSpan.remove();
                    }
                }
            }
        });

        // Initialize application when DOM is loaded
        document.addEventListener('DOMContentLoaded', () => {
            try {
                window.fcmAdmin = new FCMAdminConsole();
                console.log('✅ FCM Admin Console initialized successfully');
            } catch (error) {
                console.error('❌ Failed to initialize FCM Admin Console:', error);
            }
        });