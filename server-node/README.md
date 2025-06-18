# Istanbul FCM Messaging Server

A professional Firebase Cloud Messaging (FCM) server built with Node.js and Express, featuring a beautiful Istanbul-themed responsive web interface built with Tailwind CSS.

## Features

- 🚀 **Modern Architecture**: Built with SOLID principles and modular design
- 🎨 **Beautiful UI**: Istanbul-themed responsive interface with Tailwind CSS
- 📱 **Real-time Messaging**: Firebase Cloud Messaging integration
- 👥 **User Management**: Registration, tracking, and cleanup
- 📊 **Analytics**: Success/failure tracking and user statistics
- 🔒 **Security**: CORS protection, input validation, and error handling
- 🐳 **Docker Ready**: Containerization support
- 📝 **Comprehensive Logging**: Structured logging with different levels

## Quick Start

### Prerequisites

- Node.js 16+
- Firebase project with FCM enabled
- Firebase service account key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-org/istanbul-fcm-server.git
cd istanbul-fcm-server
```

2. Install dependencies:
```bash
npm install
```

3. Configure Firebase:
   - Download your Firebase service account key
   - Save it as `serviceAccountKey.json` in the project root
   - Update Firebase config in the HTML file

4. Set up environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

5. Start the server:
```bash
npm start
# or for development with auto-reload
npm run dev
```

## API Endpoints

### Health Check
```http
GET /health
```

### Register User
```http
POST /register
Content-Type: application/json

{
  "token": "fcm-registration-token"
}
```

### Send Notification
```http
POST /send
Content-Type: application/json

{
  "title": "Notification Title",
  "body": "Notification message"
}
```

### Get Active Users
```http
GET /users
```

### Send to Specific User
```http
POST /send-to-user
Content-Type: application/json

{
  "token": "specific-user-token",
  "title": "Personal Message",
  "body": "Message content"
}
```

## Architecture

The application follows SOLID principles with a modular architecture:

- **FCMServer**: Main server class handling Express setup
- **FirebaseService**: Firebase Admin SDK integration
- **UserService**: User registration and management
- **NotificationService**: Message sending and batch processing
- **Logger**: Structured logging utility

## Configuration

Environment variables:

- `NODE_ENV`: Application environment
- `PORT`: Server port (default: 3001)
- `HOST`: Server host (default: 0.0.0.0)
- `MAX_USERS`: Maximum users to store
- `CORS_ORIGINS`: Allowed CORS origins
- `FIREBASE_SERVICE_ACCOUNT_PATH`: Path to service account key

## Development

### Running Tests
```bash
npm test
```

### Linting
```bash
npm run lint
```

### Formatting
```bash
npm run format
```

## Docker Deployment

Build and run with Docker:

```bash
npm run docker:build
npm run docker:run
```

Or use docker-compose:

```yaml
version: '3.8'
services:
  fcm-server:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
    volumes:
      - ./serviceAccountKey.json:/app/serviceAccountKey.json:ro
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Use a process manager like PM2
3. Set up proper logging
4. Configure reverse proxy (nginx)
5. Enable HTTPS
6. Set up monitoring

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details