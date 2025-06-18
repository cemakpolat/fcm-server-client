# main.py - Enhanced Python FCM Server
import os
import logging
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
from contextlib import contextmanager

from flask import Flask, request, jsonify, g
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, messaging

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('fcm_server.log')
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class FCMToken:
    """Data class for FCM token management"""
    token: str
    registered_at: str
    last_active: str
    successful_sends: int = 0
    failed_sends: int = 0
    is_active: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

class FCMService:
    """Firebase Cloud Messaging service wrapper"""
    
    def __init__(self):
        self.app = None
        self._initialize_firebase()
    
    def _initialize_firebase(self) -> None:
        """Initialize Firebase Admin SDK with error handling"""
        try:
            service_account_path = os.getenv('SERVICE_ACCOUNT_PATH', 'serviceAccountKey.json')
            
            if not os.path.exists(service_account_path):
                raise FileNotFoundError(f"Service account file not found: {service_account_path}")
            
            if not firebase_admin._apps:  # Check if already initialized
                cred = credentials.Certificate(service_account_path)
                self.app = firebase_admin.initialize_app(cred)
                logger.info("✅ Firebase Admin SDK initialized successfully")
            else:
                self.app = firebase_admin.get_app()
                logger.info("✅ Using existing Firebase Admin SDK instance")
                
        except Exception as e:
            logger.error(f"❌ Firebase initialization error: {e}")
            raise
    
    def send_message(self, token: str, title: str, body: str, data: Optional[Dict] = None) -> Dict[str, Any]:
        """Send FCM message to a single token"""
        try:
            message_data = data or {}
            message_data.update({
                'timestamp': datetime.now().isoformat(),
                'server': 'python-fcm'
            })
            
            message = messaging.Message(
                notification=messaging.Notification(
                    title=title,
                    body=body
                ),
                data=message_data,
                token=token
            )
            
            response = messaging.send(message)
            logger.info(f"📱 Message sent successfully to {token[:20]}...")
            
            return {
                'success': True,
                'response': response,
                'token': token
            }
            
        except messaging.InvalidArgumentError as e:
            logger.error(f"❌ Invalid argument for token {token[:20]}...: {e}")
            return {
                'success': False,
                'error': 'Invalid message format',
                'token': token,
                'error_code': 'INVALID_ARGUMENT'
            }
            
        except messaging.UnregisteredError as e:
            logger.error(f"❌ Unregistered token {token[:20]}...: {e}")
            return {
                'success': False,
                'error': 'Token not registered',
                'token': token,
                'error_code': 'UNREGISTERED'
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to send message to {token[:20]}...: {e}")
            return {
                'success': False,
                'error': str(e),
                'token': token,
                'error_code': 'UNKNOWN'
            }

class TokenManager:
    """Manages FCM token storage and operations"""
    
    def __init__(self):
        logger.info("🔧 Initializing token manager")
        self.tokens: Dict[str, FCMToken] = {}
        self.max_tokens = int(os.getenv('MAX_TOKENS', '10000'))
    
    def register_token(self, token: str) -> Dict[str, Any]:
        """Register a new FCM token or update existing"""
        if not token or not isinstance(token, str):
            raise ValueError("Invalid token provided")
        
        current_time = datetime.now().isoformat()
        
        if token in self.tokens:
            # Update existing token
            self.tokens[token].last_active = current_time
            self.tokens[token].is_active = True
            logger.info(f"👤 Updated existing token: {token[:20]}...")
            return {'is_new': False, 'token_count': len(self.tokens)}
        else:
            # Check token limit
            if len(self.tokens) >= self.max_tokens:
                self._cleanup_inactive_tokens()
            
            # Register new token
            self.tokens[token] = FCMToken(
                token=token,
                registered_at=current_time,
                last_active=current_time
            )
            logger.info(f"👤 Registered new token: {token[:20]}...")
            return {'is_new': True, 'token_count': len(self.tokens)}
    
    def get_active_tokens(self) -> List[str]:
        """Get list of active tokens"""
        return [token.token for token in self.tokens.values() if token.is_active]
    
    def update_token_stats(self, results: List[Dict[str, Any]]) -> None:
        """Update token statistics based on send results"""
        for result in results:
            token_str = result.get('token')
            logger.info(f"result:", result)
            if token_str in self.tokens:
                token_obj = self.tokens[token_str]
                
                if result.get('success'):
                    token_obj.successful_sends += 1
                    token_obj.last_active = datetime.now().isoformat()
                else:
                    token_obj.failed_sends += 1
                    # Mark as inactive if token is invalid
                    error_code = result.get('error_code', '')
                    if error_code in ['UNREGISTERED', 'INVALID_ARGUMENT']:
                        token_obj.is_active = False
                        logger.warning(f"⚠️ Marked token as inactive: {token_str[:20]}...")
    
    def _cleanup_inactive_tokens(self) -> None:
        """Remove inactive tokens to free up space"""
        inactive_tokens = [
            token_str for token_str, token_obj in self.tokens.items()
            if not token_obj.is_active
        ]
        logger.info(f"result:", inactive_tokens)
        for token_str in inactive_tokens:
            del self.tokens[token_str]
        
        logger.info(f"🧹 Cleaned up {len(inactive_tokens)} inactive tokens")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get token statistics"""
        active_count = sum(1 for token in self.tokens.values() if token.is_active)
        total_successful = sum(token.successful_sends for token in self.tokens.values())
        total_failed = sum(token.failed_sends for token in self.tokens.values())
        
        return {
            'total_tokens': len(self.tokens),
            'active_tokens': active_count,
            'inactive_tokens': len(self.tokens) - active_count,
            'total_successful_sends': total_successful,
            'total_failed_sends': total_failed
        }
    def remove_token(self, token: str) -> bool:
        """Remove a token from the manager"""
        if token in self.tokens:
            del self.tokens[token]
            logger.info(f"👤 Removed token: {token[:20]}...")
            return True
        else:
            logger.info(f"👤 Attempted to remove non-existent token: {token[:20]}...")
            return False

# Initialize services
fcm_service = FCMService()
token_manager = TokenManager()

# Flask app setup
app = Flask(__name__)

# CORS configuration
cors_origins = [
    "http://localhost:3000",
    "http://localhost:8000", 
    "http://127.0.0.1:5500",
    "http://10.129.52.107:3000"
]

# Add environment variable for additional origins
additional_origins = os.getenv('CORS_ORIGINS', '').split(',')
cors_origins.extend([origin.strip() for origin in additional_origins if origin.strip()])

CORS(app, 
     resources={r"/*": {"origins": cors_origins}}, 
     supports_credentials=True)

# Request logging middleware
@app.before_request
def log_request_info():
    """Log incoming requests"""
    g.start_time = datetime.now()
    logger.info(f"🌐 {request.method} {request.path} - {request.remote_addr}")

@app.after_request
def log_response_info(response):
    """Log response information"""
    if hasattr(g, 'start_time'):
        duration = (datetime.now() - g.start_time).total_seconds()
        logger.info(f"✅ Response: {response.status_code} - {duration:.3f}s")
    return response

# Error handlers
@app.errorhandler(400)
def bad_request(error):
    logger.error(f"❌ Bad request: {error}")
    return jsonify({
        'success': False,
        'error': 'Bad request',
        'message': str(error)
    }), 400

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"❌ Internal server error: {error}")
    return jsonify({
        'success': False,
        'error': 'Internal server error'
    }), 500

# API Routes
@app.route("/", methods=["GET"])
def health_check():
    """Health check endpoint with server stats"""
    stats = token_manager.get_stats()
    return jsonify({
        "status": "🐍 Python FCM server running",
        "timestamp": datetime.now().isoformat(),
        "version": "2.0.0",
        "registered_tokens": stats['total_tokens'],
        "active_tokens": stats['active_tokens']
    }), 200

@app.route("/register", methods=["POST"])
def register_token():
    """Register FCM token endpoint"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                "success": False, 
                "error": "No JSON data provided"
            }), 400
        
        token = data.get("token")
        if not token:
            return jsonify({
                "success": False, 
                "error": "No token provided"
            }), 400
        
        result = token_manager.register_token(token)
        
        return jsonify({
            "success": True,
            "message": "New token registered" if result['is_new'] else "Token updated",
            "total_tokens": result['token_count']
        }), 200
        
    except ValueError as e:
        logger.error(f"❌ Token registration error: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 400
        
    except Exception as e:
        logger.error(f"❌ Unexpected error in token registration: {e}")
        return jsonify({
            "success": False,
            "error": "Internal server error"
        }), 500

@app.route("/unregister", methods=["POST"])
def unregister_token():
    """Unregister FCM token endpoint"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                "success": False, 
                "error": "No JSON data provided"
            }), 400
        
        token = data.get("token")
        if not token:
            return jsonify({
                "success": False, 
                "error": "No token provided"
            }), 400
        
        # Try to remove the token
        removed = token_manager.remove_token(token)
        
        if removed:
            return jsonify({
                "success": True,
                "message": "Token unregistered successfully",
                "total_tokens": len(token_manager.tokens)
            }), 200
        else:
            # Token not found - return 404 but still indicate the operation succeeded
            return jsonify({
                "success": False,
                "error": "User not found or already unregistered",
                "message": "Token not found in database"
            }), 404
        
    except Exception as e:
        logger.error(f"❌ Token unregistration error: {e}")
        return jsonify({
            "success": False,
            "error": "Internal server error during unregistration"
        }), 500
    
@app.route("/send", methods=["POST"])
def send_push():
    """Send push notification to all registered tokens"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                "success": False,
                "error": "No JSON data provided"
            }), 400
        
        body = data.get("body", "This is a test message from Python FCM server.")
        title = data.get("title", "Python Server Notification")
        
        active_tokens = token_manager.get_active_tokens()
        logger.info(f"📢 Broadcasting to {len(active_tokens)} active tokens")
        
        if not active_tokens:
            return jsonify({
                "success": False,
                "error": "No active tokens to send to"
            }), 400
        
        logger.info(f"📢 Broadcasting to {len(active_tokens)} active tokens: '{body}'")
        
        # Send messages to all tokens
        results = []
        for token in active_tokens:
            result = fcm_service.send_message(token, title, body)
            logger.info(f"result:", result)
            results.append(result)
        
        # Update token statistics
        #token_manager.update_token_stats(results)
        
        # Separate successes and failures
        successes = [r for r in results if r.get('success')]
        failures = [r for r in results if not r.get('success')]
        
        logger.info(f"✅ Broadcast completed: {len(successes)} successful, {len(failures)} failed")
        
        return jsonify({
            "success": True,
            "sent": len(successes),
            "failed": len(failures),
            "message": f"Broadcast sent to {len(successes)} devices",
            "details": {
                "successes": successes,
                "failures": failures
            }
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Error in send_push: {e}")
        return jsonify({
            "success": False,
            "error": "Internal server error while sending notifications"
        }), 500

@app.route("/tokens", methods=["GET"])
def get_tokens():
    """Get token information (without exposing actual tokens)"""
    try:
        stats = token_manager.get_stats()
        tokens_info = [
            {
                'id': f"token_{i+1}",
                'registered_at': token.registered_at,
                'last_active': token.last_active,
                'successful_sends': token.successful_sends,
                'failed_sends': token.failed_sends,
                'is_active': token.is_active
            }
            for i, token in enumerate(token_manager.tokens.values())
        ]
        
        return jsonify({
            "success": True,
            "stats": stats,
            "tokens": tokens_info
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Error getting tokens: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch token information"
        }), 500

@app.route("/stats", methods=["GET"])
def get_stats():
    """Get server statistics"""
    try:
        stats = token_manager.get_stats()
        return jsonify({
            "success": True,
            "stats": stats
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Error getting stats: {e}")
        return jsonify({
            "success": False,
            "error": "Failed to fetch statistics"
        }), 500

if __name__ == "__main__":
    # Configuration from environment variables
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', '5001'))
    debug = os.getenv('DEBUG', 'True').lower() == 'true'
    
    logger.info(f"🚀 Starting Python FCM Server on http://{host}:{port}")
    logger.info(f"🔧 Debug mode: {debug}")
    logger.info(f"🌐 CORS origins: {cors_origins}")
    
    try:
        app.run(host=host, port=port, debug=debug)
    except KeyboardInterrupt:
        logger.info("👋 Server shutdown requested")
    except Exception as e:
        logger.error(f"❌ Server startup error: {e}")
        raise